import { WebSocketServer, type WebSocket } from "ws";
import {
  DEFAULT_TIMEOUT_MS,
  ErrorCode,
  PROTOCOL_VERSION,
  WS_SUBPROTOCOL,
  getCommand,
  type CommandResponse,
  type HelloMessage,
  type PluginToServerMessage,
  type ServerToPluginMessage,
} from "@roxy/ae-protocol";
import { createOperationId, type Logger } from "@roxy/shared";
import type { BridgeStatus } from "@roxy/ae-tools";

export interface BridgeOptions {
  host: string;
  port: number;
  logger: Logger;
  serverInfo: { name: string; version: string };
  /** If set, the plugin must send this token in its hello. */
  token?: string;
  defaultTimeoutMs?: number;
  /** Retry binding the port while it is in use (another Roxy MCP instance). */
  retryBindMs?: number;
}

interface Pending {
  command: string;
  started: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (res: CommandResponse) => void;
}

const HELLO_TIMEOUT_MS = 5000;

/**
 * WebSocket server the AE plugin connects to. One active plugin connection at a time
 * (the newest wins, e.g. after a plugin reload).
 *
 * `request()` never rejects: failures (not connected, timeout, connection lost) come back as
 * structured `CommandResponse`s so MCP tools can always return a clean error to the AI.
 */
export class WsBridge {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private hello: HelloMessage | null = null;
  private connectedAt: Date | null = null;
  private lastMessageAt: number | null = null;
  private readonly pending = new Map<string, Pending>();
  private listening = false;
  private bridgeError: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly opts: BridgeOptions) {}

  start(): void {
    this.closed = false;
    const wss = new WebSocketServer({
      host: this.opts.host,
      port: this.opts.port,
      handleProtocols: (protocols) => (protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false),
      maxPayload: 64 * 1024 * 1024,
    });
    wss.on("listening", () => {
      this.listening = true;
      this.bridgeError = null;
      this.opts.logger.info("WS", `bridge listening on ws://${this.opts.host}:${this.opts.port}`);
    });
    wss.on("error", (err: NodeJS.ErrnoException) => {
      this.listening = false;
      this.bridgeError = err.code === "EADDRINUSE" ? `port ${this.opts.port} is already in use` : err.message;
      this.opts.logger.error("WS", `bridge error: ${this.bridgeError}`);
      wss.close();
      this.wss = null;
      const retry = this.opts.retryBindMs ?? 10_000;
      if (!this.closed && retry > 0 && !this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (!this.closed) this.start();
        }, retry);
      }
    });
    wss.on("connection", (ws, req) => this.onConnection(ws, req.socket.remoteAddress ?? "?"));
    this.wss = wss;
  }

  async stop(): Promise<void> {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.failAllPending(ErrorCode.CONNECTION_LOST, "Bridge shutting down");
    this.socket?.close();
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()));
    this.wss = null;
    this.listening = false;
  }

  isConnected(): boolean {
    return !!this.socket && !!this.hello;
  }

  /** Resolves when a plugin completes the handshake (used by CLI tools). */
  waitForConnection(timeoutMs: number): Promise<boolean> {
    if (this.isConnected()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = Date.now();
      const t = setInterval(() => {
        if (this.isConnected()) {
          clearInterval(t);
          resolve(true);
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(t);
          resolve(false);
        }
      }, 100);
    });
  }

  status(): BridgeStatus {
    return {
      listening: this.listening,
      port: this.opts.port,
      bridgeError: this.bridgeError,
      connected: this.isConnected(),
      plugin: this.hello?.plugin ?? null,
      host: (this.hello?.host as Record<string, unknown>) ?? null,
      connectedAt: this.connectedAt?.toISOString() ?? null,
      lastMessageAgoMs: this.lastMessageAt ? Date.now() - this.lastMessageAt : null,
      pendingRequests: this.pending.size,
      pluginCommands: this.hello?.commands ?? [],
    };
  }

  request(command: string, args: unknown, opts: { timeoutMs?: number; source?: string } = {}): Promise<CommandResponse> {
    const id = createOperationId();
    const timeoutMs = opts.timeoutMs ?? getCommand(command)?.timeoutMs ?? this.opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const log = this.opts.logger;

    if (!this.isConnected() || !this.socket) {
      const error = this.listening
        ? {
            code: ErrorCode.AE_NOT_CONNECTED,
            message: "After Effects plugin is not connected",
            hint: "Start After Effects and open the Roxy AE Agent panel (AE 2024-2026: Window > Extensions > Roxy AE Agent). Check with ae_status.",
          }
        : {
            code: ErrorCode.BRIDGE_UNAVAILABLE,
            message: `WebSocket bridge is not listening: ${this.bridgeError ?? "not started"}`,
            hint: `Another Roxy MCP server may be holding port ${this.opts.port}. Close it or set ROXY_AE_PORT.`,
          };
      log.warn("MCP", `${command} rejected: ${error.code}`, { id });
      return Promise.resolve({ id, success: false, error });
    }

    const socket = this.socket;
    return new Promise<CommandResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        log.error("WS", `${command} timed out after ${timeoutMs}ms`, { id });
        resolve({
          id,
          success: false,
          error: {
            code: ErrorCode.TIMEOUT,
            message: `${command} did not answer within ${timeoutMs}ms`,
            hint: "After Effects may be busy (rendering / modal dialog). The operation might still complete; check state before retrying.",
          },
        });
      }, timeoutMs);
      this.pending.set(id, { command, started: Date.now(), timer, resolve });
      const msg: ServerToPluginMessage = { type: "request", id, command, args, meta: { timeoutMs, source: opts.source } };
      log.info("MCP", `-> ${command}`, { id });
      log.debug("WS", "send", msg);
      try {
        socket.send(JSON.stringify(msg));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ id, success: false, error: { code: ErrorCode.CONNECTION_LOST, message: `send failed: ${(e as Error).message}` } });
      }
    });
  }

  private onConnection(ws: WebSocket, remote: string): void {
    const log = this.opts.logger;
    log.info("WS", `plugin socket opened from ${remote}`);
    let helloDone = false;
    const helloTimer = setTimeout(() => {
      if (!helloDone) {
        log.warn("WS", "no hello received; closing socket");
        ws.close(4000, "hello timeout");
      }
    }, HELLO_TIMEOUT_MS);

    ws.on("message", (raw) => {
      this.lastMessageAt = Date.now();
      let msg: PluginToServerMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        log.warn("WS", "ignoring non-JSON message");
        return;
      }
      switch (msg.type) {
        case "hello": {
          helloDone = true;
          clearTimeout(helloTimer);
          this.onHello(ws, msg);
          return;
        }
        case "response":
          return this.onResponse(msg);
        case "ping":
          return this.sendTo(ws, { type: "pong", t: msg.t });
        case "log": {
          const level = msg.level === "error" ? "error" : msg.level === "warn" ? "warn" : msg.level === "info" ? "info" : "debug";
          log.log(level, "AE", msg.message, msg.data);
          return;
        }
        default:
          log.debug("WS", "unknown message type", msg);
      }
    });

    ws.on("close", (code, reason) => {
      clearTimeout(helloTimer);
      if (this.socket === ws) {
        log.warn("WS", `plugin disconnected (${code} ${String(reason)})`);
        this.socket = null;
        this.hello = null;
        this.connectedAt = null;
        this.failAllPending(ErrorCode.CONNECTION_LOST, "After Effects plugin disconnected during the request");
      }
    });
    ws.on("error", (err) => log.error("WS", `socket error: ${err.message}`));
  }

  private onHello(ws: WebSocket, hello: HelloMessage): void {
    const log = this.opts.logger;
    const reject = (reason: string) => {
      log.error("WS", `plugin rejected: ${reason}`);
      this.sendTo(ws, { type: "hello_ack", protocolVersion: PROTOCOL_VERSION, server: this.opts.serverInfo, accepted: false, reason });
      ws.close(4001, reason);
    };
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      return reject(`protocol version mismatch (plugin ${hello.protocolVersion}, server ${PROTOCOL_VERSION}); rebuild both`);
    }
    if (this.opts.token && hello.token !== this.opts.token) return reject("invalid token");

    if (this.socket && this.socket !== ws) {
      log.warn("WS", "replacing previous plugin connection");
      this.failAllPending(ErrorCode.CONNECTION_LOST, "Plugin connection replaced");
      this.socket.close(4002, "replaced by a newer connection");
    }
    this.socket = ws;
    this.hello = hello;
    this.connectedAt = new Date();
    this.sendTo(ws, { type: "hello_ack", protocolVersion: PROTOCOL_VERSION, server: this.opts.serverInfo, accepted: true });
    log.info("WS", `plugin connected: ${hello.plugin.name} ${hello.plugin.version} on ${hello.host.appName ?? "?"} ${hello.host.version ?? ""}`);
  }

  private onResponse(res: CommandResponse): void {
    const p = this.pending.get(res.id);
    if (!p) {
      this.opts.logger.warn("WS", `late or unknown response ignored`, { id: res.id });
      return;
    }
    clearTimeout(p.timer);
    this.pending.delete(res.id);
    const ms = Date.now() - p.started;
    if (res.success) this.opts.logger.info("AE", `<- ${p.command} ok (${ms}ms)`, { id: res.id });
    else this.opts.logger.warn("AE", `<- ${p.command} failed: ${res.error?.code} ${res.error?.message}`, { id: res.id });
    p.resolve(res);
  }

  private failAllPending(code: ErrorCode, message: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ id, success: false, error: { code, message } });
    }
    this.pending.clear();
  }

  private sendTo(ws: WebSocket, msg: ServerToPluginMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      this.opts.logger.error("WS", `send failed: ${(e as Error).message}`);
    }
  }
}

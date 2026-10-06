import {
  PROTOCOL_VERSION,
  WS_SUBPROTOCOL,
  type CommandRequest,
  type CommandResponse,
  type HelloMessage,
  type PluginToServerMessage,
  type ServerToPluginMessage,
} from "@roxy/ae-protocol";
import type { Logger } from "@roxy/shared";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "rejected";

export interface ConnectionOptions {
  url: string;
  token?: string;
  log: Logger;
  buildHello: () => Omit<HelloMessage, "type" | "protocolVersion" | "token">;
  onRequest: (req: CommandRequest) => Promise<CommandResponse>;
  onStateChange: (state: ConnectionState, detail?: string) => void;
  onDisconnect: () => void;
}

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10000;
const PING_INTERVAL_MS = 10000;

/**
 * WebSocket client (the panel dials the MCP server, which owns the port).
 * Reconnects with backoff so starting AE / the MCP server in any order works.
 */
export class Connection {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;

  constructor(private opts: ConnectionOptions) {}

  getState(): ConnectionState {
    return this.state;
  }

  setUrl(url: string): void {
    this.opts = { ...this.opts, url };
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.setState("disconnected");
  }

  /** Forward plugin-side warnings/errors to the server log. */
  sendLog(level: "error" | "warn" | "info" | "debug", message: string, data?: unknown): void {
    this.send({ type: "log", level, message, data });
  }

  private open(): void {
    if (this.stopped) return;
    this.setState("connecting", this.opts.url);
    let ws: WebSocket;
    try {
      // The server only accepts WS_SUBPROTOCOL.
      ws = new WebSocket(this.opts.url, WS_SUBPROTOCOL);
    } catch (e) {
      this.opts.log.error("WS", `WebSocket construction failed: ${(e as Error).message}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      const hello: HelloMessage = {
        type: "hello",
        protocolVersion: PROTOCOL_VERSION,
        ...this.opts.buildHello(),
        ...(this.opts.token ? { token: this.opts.token } : {}),
      };
      this.send(hello);
      this.pingTimer = setInterval(() => this.send({ type: "ping", t: Date.now() }), PING_INTERVAL_MS);
    };

    ws.onmessage = (ev: MessageEvent) => {
      void this.onMessage(String(ev.data));
    };

    ws.onerror = () => {
      this.opts.log.debug("WS", "socket error");
    };

    ws.onclose = () => {
      this.clearTimers();
      if (this.ws === ws) this.ws = null;
      const wasConnected = this.state === "connected";
      if (this.state !== "rejected") this.setState("disconnected");
      if (wasConnected) this.opts.onDisconnect();
      this.scheduleReconnect();
    };
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: ServerToPluginMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.opts.log.warn("WS", "Ignoring non-JSON message");
      return;
    }
    if (msg.type === "hello_ack") {
      if (msg.accepted) {
        this.setState("connected", `server ${msg.server.name} ${msg.server.version}`);
      } else {
        this.setState("rejected", msg.reason);
        this.opts.log.error("WS", `Server rejected connection: ${msg.reason ?? "unknown reason"}`);
      }
      return;
    }
    if (msg.type === "pong") return;
    if (msg.type === "request") {
      const res = await this.opts.onRequest(msg);
      this.send({ ...res, type: "response" });
    }
  }

  private send(msg: PluginToServerMessage): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (e) {
        this.opts.log.error("WS", `send failed: ${(e as Error).message}`);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setState(state: ConnectionState, detail?: string): void {
    const changed = state !== this.state;
    this.state = state;
    if (changed) this.opts.onStateChange(state, detail);
  }
}

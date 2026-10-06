/**
 * Panel UI shared by the UXP plugin (AE 27.0+) and the CEP extension (AE 2024-2026).
 * The host-specific part is the PanelExecutor that actually runs commands
 * (Dispatcher in apps/ae-plugin, CepExecutor in apps/ae-cep-plugin).
 */
import { DEFAULT_WS_PORT, type CommandRequest, type CommandResponse, type HelloMessage } from "@roxy/ae-protocol";
import { Logger, parseLogLevel } from "@roxy/shared";
import { Connection, type ConnectionState } from "./connection.js";

export interface PanelExecutor {
  commandNames(): string[];
  hostInfo(): HelloMessage["host"];
  handle(req: CommandRequest): Promise<CommandResponse>;
  /** Called when the server connection drops (close dangling undo groups, ...). */
  onDisconnect(): void;
}

export interface PanelOptions {
  pluginName: string;
  version: string;
  createExecutor(log: Logger): PanelExecutor | Promise<PanelExecutor>;
}

const STORAGE_KEYS = { port: "roxy.port", token: "roxy.token", level: "roxy.logLevel" };
const MAX_UI_LOG_LINES = 200;

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing in index.html`);
  return el;
}

function appendUiLog(line: string): void {
  const box = document.getElementById("log");
  if (!box) return;
  const div = document.createElement("div");
  div.textContent = line.replace(/^\S+ /, ""); // drop ISO timestamp for readability
  if (line.includes("[ERROR]")) div.className = "err";
  box.appendChild(div);
  while (box.childNodes.length > MAX_UI_LOG_LINES) box.removeChild(box.firstChild as ChildNode);
  box.scrollTop = box.scrollHeight;
}

export async function bootPanel(opts: PanelOptions): Promise<void> {
  let connection: Connection | null = null;
  const log = new Logger({
    level: parseLogLevel(storageGet(STORAGE_KEYS.level) ?? undefined, "info"),
    sink: (line) => {
      console.log(line);
      appendUiLog(line);
    },
  });
  // Forward warnings/errors to the MCP server log as well ([ROXY][AE] there).
  log.addSink((_line, rec) => {
    if ((rec.level === "error" || rec.level === "warn") && rec.tag !== "WS") connection?.sendLog(rec.level, rec.message, rec.data);
  });

  let executor: PanelExecutor;
  try {
    executor = await opts.createExecutor(log);
  } catch (e) {
    log.error("PLUGIN", `executor failed to start: ${(e as Error).message}`);
    $("host").textContent = `Startup failed: ${(e as Error).message}`;
    return;
  }

  const portInput = $("port") as HTMLInputElement;
  const tokenInput = $("token") as HTMLInputElement;
  const statusEl = $("status");
  const debugToggle = $("debug") as HTMLInputElement;
  portInput.value = storageGet(STORAGE_KEYS.port) ?? String(DEFAULT_WS_PORT);
  tokenInput.value = storageGet(STORAGE_KEYS.token) ?? "";
  debugToggle.checked = log.getLevel() === "debug";

  const urlFromUi = () => `ws://127.0.0.1:${Number(portInput.value) || DEFAULT_WS_PORT}`;

  // Reconnect attempts (connecting -> disconnected every few seconds while no MCP server runs) are logged
  // once at info level; the individual retries only at debug level.
  let retrying = false;
  let stoppedByUser = false;
  const setStatus = (state: ConnectionState, detail?: string) => {
    if (stoppedByUser) {
      statusEl.textContent = "stopped (press Connect)";
      statusEl.className = "status disconnected";
      return;
    }
    if (state === "disconnected" && !retrying) {
      retrying = true;
      log.info("WS", "MCP server not reachable or disconnected; retrying in the background");
    }
    // While retrying, keep one stable status instead of flickering connecting/disconnected.
    const waiting = retrying && state !== "connected" && state !== "rejected";
    statusEl.textContent = waiting ? "waiting for MCP server..." : state + (detail ? ` - ${detail}` : "");
    statusEl.className = `status ${waiting ? "waiting" : state}`;
    if (state === "connected") {
      retrying = false;
      log.info("WS", `connected${detail ? ` (${detail})` : ""}`);
    } else if (state === "rejected") {
      log.error("WS", `rejected by server${detail ? `: ${detail}` : ""}`);
    } else {
      log.debug("WS", `connection ${state}${detail ? ` (${detail})` : ""}`);
    }
  };

  const makeConnection = () =>
    new Connection({
      url: urlFromUi(),
      token: tokenInput.value || undefined,
      log,
      buildHello: () => ({
        plugin: { name: opts.pluginName, version: opts.version },
        host: executor.hostInfo(),
        commands: executor.commandNames(),
      }),
      onRequest: (req) => {
        log.debug("AE", `<- ${req.command}`, { id: req.id });
        return executor.handle(req);
      },
      onStateChange: setStatus,
      onDisconnect: () => executor.onDisconnect(),
    });

  $("connect").addEventListener("click", () => {
    storageSet(STORAGE_KEYS.port, portInput.value);
    storageSet(STORAGE_KEYS.token, tokenInput.value);
    stoppedByUser = true; // silence the status change caused by stopping the old connection
    connection?.stop();
    stoppedByUser = false;
    retrying = false;
    connection = makeConnection();
    connection.start();
  });
  $("disconnect").addEventListener("click", () => {
    stoppedByUser = true;
    retrying = false;
    connection?.stop();
    setStatus("disconnected");
    log.info("WS", "stopped by user");
  });
  debugToggle.addEventListener("change", () => {
    const level = debugToggle.checked ? "debug" : "info";
    log.setLevel(level);
    storageSet(STORAGE_KEYS.level, level);
  });

  const host = executor.hostInfo();
  $("host").textContent = host.appName ? `${host.appName} ${host.version ?? ""}` : "After Effects host API not available";
  log.info("PLUGIN", `${opts.pluginName} ${opts.version} loaded; ${executor.commandNames().length} commands`);
  connection = makeConnection();
  connection.start();
}

export function whenDomReady(fn: () => void): void {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
  else fn();
}

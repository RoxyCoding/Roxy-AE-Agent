import type { ErrorPayload } from "./errors.js";

/**
 * Wire protocol between the MCP server (WebSocket server) and the AE plugin (WebSocket client).
 * Every command uses the same Request / Response shape.
 */
export const PROTOCOL_VERSION = 1;
export const DEFAULT_WS_PORT = 47820;
export const WS_SUBPROTOCOL = "roxy-ae.v1";

export interface CommandRequest<A = unknown> {
  type?: "request";
  /** Operation ID. Echoed in the response and in every log line for that operation. */
  id: string;
  command: string;
  args: A;
  meta?: {
    /** Timeout the server applies; informational for the plugin. */
    timeoutMs?: number;
    /** Origin of the call, e.g. MCP tool name. Used for logging only. */
    source?: string;
  };
}

export interface CommandResponse<D = unknown> {
  type?: "response";
  id: string;
  success: boolean;
  data?: D;
  error?: ErrorPayload;
  /** Non-fatal issues (fallbacks used, values coerced, ...). */
  warnings?: string[];
  meta?: {
    durationMs?: number;
  };
}

/** Plugin -> server, first message after connecting. */
export interface HelloMessage {
  type: "hello";
  protocolVersion: number;
  plugin: { name: string; version: string };
  host: { appName?: string; version?: string; buildNumber?: number; isBeta?: boolean; language?: string };
  /** Commands the plugin can execute. */
  commands: string[];
  token?: string;
}

export interface HelloAckMessage {
  type: "hello_ack";
  protocolVersion: number;
  server: { name: string; version: string };
  accepted: boolean;
  reason?: string;
}

/** Plugin -> server: forwards plugin-side warnings/errors into the server log. */
export interface PluginLogMessage {
  type: "log";
  level: "error" | "warn" | "info" | "debug";
  message: string;
  data?: unknown;
}

export interface PingMessage {
  type: "ping";
  t: number;
}
export interface PongMessage {
  type: "pong";
  t: number;
}

export type ServerToPluginMessage = (CommandRequest & { type: "request" }) | HelloAckMessage | PongMessage;
export type PluginToServerMessage = (CommandResponse & { type: "response" }) | HelloMessage | PluginLogMessage | PingMessage;

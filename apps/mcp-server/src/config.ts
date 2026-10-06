import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_WS_PORT } from "@roxy/ae-protocol";
import { Logger, parseLogLevel } from "@roxy/shared";

export const SERVER_INFO = { name: "roxy-ae-agent", version: "0.1.0" };

export interface ServerConfig {
  host: string;
  port: number;
  token?: string;
  timeoutMs: number;
  previewDir: string;
  logLevel: ReturnType<typeof parseLogLevel>;
  logFile?: string;
  experimentalMv: boolean;
}

/** All configuration comes from environment variables (set in the MCP client config). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.ROXY_AE_HOST || "127.0.0.1",
    port: Number(env.ROXY_AE_PORT) || DEFAULT_WS_PORT,
    token: env.ROXY_AE_TOKEN || undefined,
    timeoutMs: Number(env.ROXY_TIMEOUT_MS) || 30_000,
    previewDir: env.ROXY_PREVIEW_DIR || join(tmpdir(), "roxy-ae-agent", "previews"),
    logLevel: parseLogLevel(env.ROXY_LOG_LEVEL, "info"),
    logFile: env.ROXY_LOG_FILE || undefined,
    experimentalMv: env.ROXY_EXPERIMENTAL_MV !== "0",
  };
}

/** stdout is the MCP channel: logs go to stderr (+ optional file). */
export function createLogger(config: ServerConfig): Logger {
  const logger = new Logger({ level: config.logLevel, sink: (line) => process.stderr.write(line + "\n") });
  if (config.logFile) {
    const file = config.logFile;
    mkdirSync(dirname(file), { recursive: true });
    logger.addSink((line) => appendFileSync(file, line + "\n"));
  }
  return logger;
}

/**
 * Tagged, level-filtered logger shared by the MCP server and the AE plugin.
 *
 * Output format: `[ROXY][TAG] message {json}`
 * The sink is injectable: the MCP server MUST log to stderr (stdout is the MCP stdio channel),
 * the plugin logs to the panel console and its log view.
 */

export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogTag = "MCP" | "WS" | "AE" | "ERROR" | "PREVIEW" | "PLUGIN" | "CLI";

const LEVEL_ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface LogRecord {
  time: string;
  level: LogLevel;
  tag: LogTag;
  message: string;
  data?: unknown;
}

export type LogSink = (line: string, record: LogRecord) => void;

export interface LoggerOptions {
  level?: LogLevel;
  sink?: LogSink;
  /** Truncate serialized `data` beyond this many chars to avoid huge log lines. */
  maxDataChars?: number;
}

export function parseLogLevel(value: string | undefined, fallback: LogLevel = "info"): LogLevel {
  const v = (value ?? "").toLowerCase();
  return v === "error" || v === "warn" || v === "info" || v === "debug" ? v : fallback;
}

export class Logger {
  private level: LogLevel;
  private readonly sinks: LogSink[];
  private readonly maxDataChars: number;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.sinks = [options.sink ?? ((line) => console.error(line))];
    this.maxDataChars = options.maxDataChars ?? 2000;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  addSink(sink: LogSink): void {
    this.sinks.push(sink);
  }

  isEnabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] <= LEVEL_ORDER[this.level];
  }

  log(level: LogLevel, tag: LogTag, message: string, data?: unknown): void {
    if (!this.isEnabled(level)) return;
    const record: LogRecord = { time: new Date().toISOString(), level, tag, message, data };
    // Errors are always additionally tagged [ERROR] so they can be grepped across sources.
    const tags = level === "error" && tag !== "ERROR" ? `[ROXY][${tag}][ERROR]` : `[ROXY][${tag}]`;
    let line = `${record.time} ${tags} ${message}`;
    if (data !== undefined) line += " " + this.serialize(data);
    for (const sink of this.sinks) {
      try {
        sink(line, record);
      } catch {
        // A broken sink must never break the caller.
      }
    }
  }

  error(tag: LogTag, message: string, data?: unknown): void {
    this.log("error", tag, message, data);
  }
  warn(tag: LogTag, message: string, data?: unknown): void {
    this.log("warn", tag, message, data);
  }
  info(tag: LogTag, message: string, data?: unknown): void {
    this.log("info", tag, message, data);
  }
  debug(tag: LogTag, message: string, data?: unknown): void {
    this.log("debug", tag, message, data);
  }

  private serialize(data: unknown): string {
    let s: string;
    try {
      s = data instanceof Error ? `${data.name}: ${data.message}` : JSON.stringify(data);
    } catch {
      s = String(data);
    }
    if (s.length > this.maxDataChars) s = s.slice(0, this.maxDataChars) + `...(+${s.length - this.maxDataChars} chars)`;
    return s;
  }
}

/**
 * Structured error codes shared by every layer (MCP server, bridge, AE plugin).
 * AI clients should branch on `code`, never on `message`.
 */
export const ErrorCode = {
  /** No AE plugin is connected to the bridge. */
  AE_NOT_CONNECTED: "AE_NOT_CONNECTED",
  /** The connection dropped while a request was in flight. */
  CONNECTION_LOST: "CONNECTION_LOST",
  /** The WebSocket bridge could not start (e.g. port already in use). */
  BRIDGE_UNAVAILABLE: "BRIDGE_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_ARGS: "INVALID_ARGS",
  UNKNOWN_COMMAND: "UNKNOWN_COMMAND",
  NOT_FOUND: "NOT_FOUND",
  /** A selector matched more than one candidate. Candidates are in `details.candidates`. */
  AMBIGUOUS_SELECTOR: "AMBIGUOUS_SELECTOR",
  /** Target carries Roxy metadata `lockedForAI: true`. */
  LOCKED_FOR_AI: "LOCKED_FOR_AI",
  /** A name/ID collision that would make later selection ambiguous. */
  CONFLICT: "CONFLICT",
  /** The host API needed for this operation is not available in this AE build. */
  UNSUPPORTED: "UNSUPPORTED",
  /** After Effects threw while executing the operation. */
  AE_ERROR: "AE_ERROR",
  PREVIEW_FAILED: "PREVIEW_FAILED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  /** Machine-readable extra info (candidates, available names, zod issues, ...). */
  details?: unknown;
  /** Short hint for the AI on how to recover. */
  hint?: string;
}

export class RoxyError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, extra: { details?: unknown; hint?: string } = {}) {
    super(message);
    this.name = "RoxyError";
    this.code = code;
    this.details = extra.details;
    this.hint = extra.hint;
  }

  toPayload(): ErrorPayload {
    const p: ErrorPayload = { code: this.code, message: this.message };
    if (this.details !== undefined) p.details = this.details;
    if (this.hint !== undefined) p.hint = this.hint;
    return p;
  }
}

/** Convert anything thrown into a structured payload. Unknown errors become `fallback`. */
export function toErrorPayload(err: unknown, fallback: ErrorCode = ErrorCode.INTERNAL): ErrorPayload {
  if (err instanceof RoxyError) return err.toPayload();
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const e = err as { code: unknown; message: unknown; details?: unknown; hint?: unknown };
    if (typeof e.code === "string" && (Object.values(ErrorCode) as string[]).includes(e.code)) {
      return {
        code: e.code as ErrorCode,
        message: String(e.message),
        ...(e.details !== undefined ? { details: e.details } : {}),
        ...(typeof e.hint === "string" ? { hint: e.hint } : {}),
      };
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: fallback, message };
}

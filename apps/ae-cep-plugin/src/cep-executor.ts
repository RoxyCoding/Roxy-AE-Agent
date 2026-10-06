import {
  ErrorCode,
  containsRef,
  getCommand,
  type CommandRequest,
  type CommandResponse,
  type ErrorPayload,
  type HelloMessage,
} from "@roxy/ae-protocol";
import type { Logger } from "@roxy/shared";
import type { PanelExecutor } from "@roxy/plugin-panel";

/** Runs ExtendScript and returns its string result (CEP: window.__adobe_cep__.evalScript). */
export type EvalScript = (script: string) => Promise<string>;

/** CEP returns this literal string when the ExtendScript throws uncaught. */
const CEP_EVAL_ERROR = "EvalScript error.";

/**
 * Encode a JS string as an ExtendScript (ES3) string literal: JSON escaping plus \uXXXX for every
 * non-ASCII char (U+2028/2029 are line terminators in ES3 and would break the script).
 */
export function toEs3StringLiteral(s: string): string {
  return JSON.stringify(s).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/**
 * Executor for AE 2024-2026: validation and defaults happen here (shared zod schemas),
 * After Effects is driven by jsx/host.jsx (ES3) through evalScript.
 * Requests are serialized because ExtendScript runs one script at a time.
 */
export class CepExecutor implements PanelExecutor {
  private queue: Promise<unknown> = Promise.resolve();
  private names: string[] = [];
  private host: HelloMessage["host"] = {};

  constructor(
    private readonly evalScript: EvalScript,
    private readonly log: Logger,
  ) {}

  /** Load command list + host info from the ExtendScript side. Throws if host.jsx is not loaded. */
  async init(): Promise<void> {
    const raw = await this.evalScript("RoxyHost.describe()");
    let info: { commands: string[]; host: HelloMessage["host"] };
    try {
      info = JSON.parse(raw);
    } catch {
      throw new Error(`host.jsx not loaded or failed (got: ${raw.slice(0, 120)})`);
    }
    this.names = info.commands;
    this.host = info.host;
  }

  commandNames(): string[] {
    return this.names;
  }

  hostInfo(): HelloMessage["host"] {
    return this.host;
  }

  onDisconnect(): void {
    void this.evalScript("RoxyHost.closeUndo()").catch(() => undefined);
  }

  handle(req: CommandRequest): Promise<CommandResponse> {
    const run = this.queue.then(() => this.execute(req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async execute(req: CommandRequest): Promise<CommandResponse> {
    const started = Date.now();
    const fail = (error: ErrorPayload): CommandResponse => ({ id: req.id, success: false, error, meta: { durationMs: Date.now() - started } });

    const spec = getCommand(req.command);
    if (!spec || !this.names.includes(req.command)) {
      return fail({ code: ErrorCode.UNKNOWN_COMMAND, message: `Unknown command "${req.command}"`, details: { available: this.names } });
    }
    const parsed = spec.args.safeParse(req.args ?? {});
    if (!parsed.success) {
      return fail({
        code: ErrorCode.INVALID_ARGS,
        message: `Invalid args for ${req.command}`,
        details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    let args = parsed.data as Record<string, unknown>;
    if (req.command === "batch.execute") {
      const prepared = this.prepareBatch(args);
      if ("error" in prepared) return fail(prepared.error);
      args = prepared.args;
    }

    const payload = JSON.stringify({ id: req.id, command: req.command, args, mutates: spec.mutates });
    let raw: string;
    try {
      raw = await this.evalScript(`RoxyHost.dispatch(${toEs3StringLiteral(payload)})`);
    } catch (e) {
      return fail({ code: ErrorCode.AE_ERROR, message: `evalScript failed: ${(e as Error).message}` });
    }
    if (raw === CEP_EVAL_ERROR || raw === undefined || raw === null) {
      this.log.error("AE", `${req.command}: ExtendScript threw outside RoxyHost`, { id: req.id });
      return fail({ code: ErrorCode.AE_ERROR, message: "ExtendScript evaluation error (host.jsx not loaded or crashed)" });
    }
    try {
      const res = JSON.parse(raw) as Omit<CommandResponse, "id">;
      if (!res.success) this.log.warn("AE", `${req.command} failed: ${res.error?.code} ${res.error?.message}`, { id: req.id });
      return { ...res, id: req.id, meta: { durationMs: Date.now() - started } };
    } catch {
      return fail({ code: ErrorCode.INTERNAL, message: `Unparseable ExtendScript result: ${String(raw).slice(0, 200)}` });
    }
  }

  /**
   * Apply schema defaults to batch steps that contain no $ref (steps with $ref are resolved inside
   * ExtendScript, whose handlers apply their own defaults).
   */
  private prepareBatch(args: Record<string, unknown>): { args: Record<string, unknown> } | { error: ErrorPayload } {
    const steps = args.commands as Array<{ id?: string; command: string; args: Record<string, unknown> }>;
    const out = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const spec = getCommand(step.command);
      if (!spec) return { error: { code: ErrorCode.UNKNOWN_COMMAND, message: `Step ${i}: unknown command "${step.command}"` } };
      if (spec.batchable === false) {
        return { error: { code: ErrorCode.INVALID_ARGS, message: `Step ${i}: "${step.command}" is not allowed inside batch.execute` } };
      }
      if (containsRef(step.args)) {
        out.push(step);
        continue;
      }
      const p = spec.args.safeParse(step.args ?? {});
      if (!p.success) {
        return {
          error: {
            code: ErrorCode.INVALID_ARGS,
            message: `Step ${i} (${step.command}): ${p.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`,
          },
        };
      }
      out.push({ ...step, args: p.data });
    }
    return { args: { ...args, commands: out } };
  }
}

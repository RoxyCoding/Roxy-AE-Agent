import {
  ErrorCode,
  RoxyError,
  getCommand,
  toErrorPayload,
  type CommandRequest,
  type CommandResponse,
} from "@roxy/ae-protocol";
import type { Logger } from "@roxy/shared";
import type { Handler, HandlerContext } from "./commands/index.js";
import type { UndoManager } from "./undo.js";

/**
 * Executes commands: envelope check -> args validation (shared zod schema) -> lock/undo policy
 * -> handler -> structured response. Requests are serialized: AE is single-threaded and
 * interleaving two operations would corrupt undo groups.
 */
export class Dispatcher {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly handlers: Record<string, Handler>,
    private readonly undo: UndoManager,
    private readonly log: Logger,
  ) {}

  get commandNames(): string[] {
    return Object.keys(this.handlers);
  }

  handle(req: CommandRequest): Promise<CommandResponse> {
    const run = this.queue.then(() => this.execute(req.id, req.command, req.args, false));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async execute(id: string, command: string, rawArgs: unknown, nested: boolean): Promise<CommandResponse> {
    const started = Date.now();
    const warnings: string[] = [];
    const respond = (r: Omit<CommandResponse, "id">): CommandResponse => {
      const res: CommandResponse = { id, ...r, meta: { durationMs: Date.now() - started } };
      if (warnings.length) res.warnings = warnings;
      return res;
    };

    try {
      const spec = getCommand(command);
      const handler = this.handlers[command];
      if (!spec || !handler) {
        throw new RoxyError(ErrorCode.UNKNOWN_COMMAND, `Unknown command "${command}"`, {
          details: { available: this.commandNames },
        });
      }
      const parsed = spec.args.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        throw new RoxyError(ErrorCode.INVALID_ARGS, `Invalid args for ${command}`, {
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const ctx: HandlerContext = {
        warn: (m) => warnings.push(m),
        undo: this.undo,
        executeNested: (cmd, args) => this.execute(`${id}/${cmd}`, cmd, args, true),
      };
      const run = () => handler(parsed.data, ctx);
      const data = spec.mutates ? await this.undo.runGrouped(`Roxy: ${command}`, run) : await run();
      if (!nested) this.log.debug("AE", `${command} ok`, { id, ms: Date.now() - started });
      return respond({ success: true, data });
    } catch (err) {
      const error = toErrorPayload(err, ErrorCode.AE_ERROR);
      this.log.warn("AE", `${command} failed: ${error.code} ${error.message}`, { id });
      return respond({ success: false, error });
    }
  }
}

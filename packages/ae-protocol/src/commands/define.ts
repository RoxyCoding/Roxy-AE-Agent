import type * as z from "zod/v4";

/**
 * A command is the unit of work executed by the AE plugin.
 * The same spec drives: MCP tool input schemas (server), argument validation (plugin),
 * undo wrapping (mutates), and timeouts.
 */
export interface CommandSpec<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  args: S;
  /** Changes the project -> auto-wrapped in an undo group, checked against lockedForAI. */
  mutates: boolean;
  /** Removes data (delete/remove). Responses must include what was removed. */
  destructive?: boolean;
  /** Per-command timeout override (ms). */
  timeoutMs?: number;
  /** Allowed inside batch.execute. Default true. */
  batchable?: boolean;
  /** Not exposed as a generic MCP tool (server provides a custom tool or uses it internally). */
  internal?: boolean;
}

export function defineCommand<S extends z.ZodObject>(spec: CommandSpec<S>): CommandSpec<S> {
  return spec;
}

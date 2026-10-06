import type * as z from "zod/v4";
import { ErrorCode, RoxyError } from "@roxy/ae-protocol";
import { fromResponse, type ToolDefinition } from "./types.js";

/** One low-level command step (same shape as batch.execute steps; args may contain {"$ref": "..."}). */
export interface PlanStep {
  id?: string;
  command: string;
  args: Record<string, unknown>;
}

export interface Plan {
  steps: PlanStep[];
  undoGroup: string;
  /** Echoed back to the AI to explain what was built. */
  summary: Record<string, unknown>;
}

export interface PlanToolSpec<S extends z.ZodObject> {
  name: string;
  description: string;
  inputSchema: S;
  experimental?: boolean;
  readOnly?: boolean;
  plan(args: z.infer<S>): Plan;
}

export type PlanTool<S extends z.ZodObject = z.ZodObject> = ToolDefinition & { plan: PlanToolSpec<S>["plan"] };

/**
 * Plan tools never touch After Effects directly. They compile their arguments into low-level
 * commands and run them as ONE batch.execute: one round trip, one undo step, the same safety checks
 * in both plugins (UXP and CEP). `plan` is pure, so it is unit-testable without After Effects.
 */
export function definePlanTool<S extends z.ZodObject>(spec: PlanToolSpec<S>): PlanTool<S> {
  return {
    name: spec.name,
    description: (spec.experimental ? "[EXPERIMENTAL] " : "") + spec.description,
    inputSchema: spec.inputSchema,
    readOnly: spec.readOnly,
    plan: spec.plan,
    handler: async (args, ctx) => {
      let plan: Plan;
      try {
        plan = spec.plan(args);
      } catch (e) {
        if (e instanceof RoxyError) return { ok: false, error: e.toPayload() };
        return { ok: false, error: { code: ErrorCode.INVALID_ARGS, message: (e as Error).message } };
      }
      const res = await ctx.execute(
        "batch.execute",
        { commands: plan.steps, onError: "stop", undoGroup: plan.undoGroup },
        { timeoutMs: 300_000, source: spec.name },
      );
      const out = fromResponse(res);
      if (!out.ok) return out;
      const batch = res.data as { failed: number; results: Array<{ id: string; success: boolean; error?: unknown }> };
      if (batch.failed > 0) {
        const failedStep = batch.results.find((r) => !r.success);
        return {
          ok: false,
          opId: res.id,
          error: {
            code: ErrorCode.AE_ERROR,
            message: `${spec.name}: step "${failedStep?.id}" failed; completed steps are in one undo group (Edit > Undo reverts them)`,
            details: { failedStep, summary: plan.summary },
          },
          warnings: out.warnings,
        };
      }
      out.data = { summary: plan.summary, results: batch.results };
      return out;
    },
  };
}

/** {"$ref": "<stepId>.<path>"} helper. */
export const ref = (path: string) => ({ $ref: path });

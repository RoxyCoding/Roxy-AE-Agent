import type * as z from "zod/v4";
import { definePlanTool, type Plan, type PlanStep, type PlanTool, type PlanToolSpec } from "@roxy/ae-tools";

export type { PlanStep };
export type MvPlan = Plan;

/**
 * High-level MV tools never touch After Effects directly: they are plan tools that compile into
 * low-level commands run as one batch.execute (see @roxy/ae-tools definePlanTool).
 */
export function defineMvTool<S extends z.ZodObject>(spec: PlanToolSpec<S>): PlanTool<S> {
  return definePlanTool(spec);
}

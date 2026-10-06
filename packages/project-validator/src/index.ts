import type { DiagnosticsSnapshot } from "@roxy/ae-protocol";
import { PHASE1_RULES, PLANNED_RULES, type ValidationIssue, type ValidationRule } from "./rules.js";

export * from "./rules.js";

export interface ValidationReport {
  ok: boolean;
  counts: { error: number; warning: number; info: number };
  issues: ValidationIssue[];
  rulesRun: string[];
  rulesPlanned: string[];
  failedRules: Array<{ rule: string; error: string }>;
}

export function validateProject(
  snapshot: DiagnosticsSnapshot,
  options: { rules?: ValidationRule[]; only?: string[]; maxIssues?: number } = {},
): ValidationReport {
  const rules = (options.rules ?? PHASE1_RULES).filter((r) => !options.only || options.only.includes(r.id));
  const issues: ValidationIssue[] = [];
  const failedRules: ValidationReport["failedRules"] = [];
  for (const rule of rules) {
    try {
      issues.push(...rule.check(snapshot));
    } catch (e) {
      // One broken rule must not hide the results of the others.
      failedRules.push({ rule: rule.id, error: (e as Error).message });
    }
  }
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return {
    ok: counts.error === 0 && failedRules.length === 0,
    counts,
    issues: issues.slice(0, options.maxIssues ?? 100),
    rulesRun: rules.map((r) => r.id),
    rulesPlanned: PLANNED_RULES.map((r) => r.id),
    failedRules,
  };
}

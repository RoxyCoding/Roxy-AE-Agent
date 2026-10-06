/**
 * Phase 4: approval-based auto-fix.
 *   1. ae_project_autofix (no `apply`) -> runs the validator and returns fix PROPOSALS (nothing changes).
 *   2. The AI shows them to the user; only after the user approves does it call again with `apply: [ids]`.
 *   3. Approved proposals run as one batch (one undo step) after a checkpoint; validation runs again.
 * Only mechanical fixes are proposed; issues needing judgement are listed as manual.
 */
import * as z from "zod/v4";
import { compField, ErrorCode, type DiagnosticsSnapshot } from "@roxy/ae-protocol";
import { validateProject } from "@roxy/project-validator";
import { checkpointCreate } from "./checkpoint.js";
import { fromResponse, type ToolDefinition } from "./types.js";
import type { PlanStep } from "./plan.js";

export interface FixProposal {
  id: string;
  rule: string;
  description: string;
  destructive: boolean;
  commands: PlanStep[];
}

export interface ManualIssue {
  rule: string;
  message: string;
  suggestion: string;
}

const MANUAL_SUGGESTIONS: Record<string, string> = {
  "missing-assets": "Relink the footage in After Effects (File > Dependencies) or re-import it with ae_footage_import.",
  "empty-composition": "Add content or delete the composition if it is unused.",
  "broken-parent": "Re-parent the layer with ae_layer_set { attributes: { parent } }.",
  "off-screen-layer": "Check the layer position (ae_transform_get) and move it into the frame if it should be visible.",
  "layer-timing": "Adjust inPoint/outPoint/startTime with ae_layer_set if the layer should be visible.",
};

/** Pure: snapshot -> proposals + manual issues. */
export function proposeFixes(snapshot: DiagnosticsSnapshot): { proposals: FixProposal[]; manual: ManualIssue[] } {
  const proposals: FixProposal[] = [];
  const manual: ManualIssue[] = [];
  let n = 0;
  const id = () => `fix-${++n}`;

  // duplicate-roxy-id: keep the first use, rename the others.
  const seen = new Map<string, number>();
  for (const c of snapshot.comps) {
    const uses: Array<{ layerId?: number; label: string }> = [];
    if (c.roxy?.roxyId) uses.push({ label: `comp "${c.name}"` });
    for (const l of c.layers) if (l.roxy?.roxyId) uses.push({ layerId: l.id, label: `layer "${l.name}" in "${c.name}"` });
    for (const u of uses) {
      const rid = u.layerId === undefined ? c.roxy!.roxyId! : c.layers.find((l) => l.id === u.layerId)!.roxy!.roxyId!;
      const count = (seen.get(rid) ?? 0) + 1;
      seen.set(rid, count);
      if (count === 1) continue;
      const newId = `${rid}_${count}`;
      proposals.push({
        id: id(),
        rule: "duplicate-roxy-id",
        description: `Rename duplicate roxyId "${rid}" on ${u.label} to "${newId}"`,
        destructive: false,
        commands: [{ command: "metadata.set", args: { comp: c.id, ...(u.layerId !== undefined ? { layer: u.layerId } : {}), metadata: { roxyId: newId } } }],
      });
    }
  }

  const installed = snapshot.installedEffects ? new Set(snapshot.installedEffects) : null;
  for (const c of snapshot.comps) {
    for (const l of c.layers) {
      for (const e of l.expressionErrors) {
        proposals.push({
          id: id(),
          rule: "broken-expressions",
          description: `Disable the failing expression on ${e.path} of layer "${l.name}" (kept, not deleted): ${e.error}`,
          destructive: false,
          commands: [{ command: "property.set", args: { comp: c.id, layer: l.id, path: e.path, expressionEnabled: false } }],
        });
      }
      if (installed) {
        // Remove from the highest index down so earlier indices stay valid inside one batch.
        const missing = l.effects.map((e, i) => ({ ...e, index: i + 1 })).filter((e) => !installed.has(e.matchName)).reverse();
        for (const e of missing) {
          proposals.push({
            id: id(),
            rule: "missing-effects",
            description: `Remove effect "${e.name}" (${e.matchName}, not installed) from layer "${l.name}"`,
            destructive: true,
            commands: [{ command: "property.remove", args: { comp: c.id, layer: l.id, path: ["effects", e.index] } }],
          });
        }
      }
    }
  }

  const report = validateProject(snapshot, { maxIssues: 500 });
  for (const issue of report.issues) {
    const suggestion = MANUAL_SUGGESTIONS[issue.rule];
    if (suggestion) manual.push({ rule: issue.rule, message: issue.message, suggestion });
  }
  return { proposals, manual };
}

let lastProposals = new Map<string, FixProposal>();

export const projectAutofix: ToolDefinition = {
  name: "ae_project_autofix",
  description:
    "Approval-based auto-fix. Without `apply`: validates and returns fix PROPOSALS (nothing is changed) - show them to the user and ask which to apply. " +
    "With `apply: [proposal ids]` (only ids the USER approved): takes a checkpoint, applies them as one undo step and validates again.",
  inputSchema: z.object({
    comp: compField.describe("Limit to one comp (default: whole project)"),
    apply: z.array(z.string()).optional().describe("Proposal ids approved by the user"),
  }),
  handler: async (args, ctx) => {
    const collect = async () => ctx.execute("project.collectDiagnostics", { comp: args.comp }, { timeoutMs: 120_000, source: "autofix" });
    if (!args.apply) {
      const res = await collect();
      if (!res.success) return fromResponse(res);
      const { proposals, manual } = proposeFixes(res.data as DiagnosticsSnapshot);
      lastProposals = new Map(proposals.map((p) => [p.id, p]));
      return {
        ok: true,
        opId: res.id,
        data: {
          proposals: proposals.map(({ commands: _c, ...p }) => p),
          manual,
          next: proposals.length
            ? "Show these proposals to the user. Call again with apply: [ids] ONLY for the ones they approve."
            : "Nothing can be fixed automatically.",
        },
      };
    }

    const selected = args.apply.map((id: string) => lastProposals.get(id));
    const unknown = args.apply.filter((_: string, i: number) => !selected[i]);
    if (unknown.length) {
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: `Unknown proposal ids: ${unknown.join(", ")}`, hint: "Run ae_project_autofix without `apply` first." } };
    }
    const warnings: string[] = [];
    const cp = await checkpointCreate.handler({ label: "before-autofix" }, ctx);
    if (!cp.ok) warnings.push(`No checkpoint: ${cp.error?.message}`);
    const steps = (selected as FixProposal[]).flatMap((p) => p.commands.map((c, i) => ({ ...c, id: `${p.id}${p.commands.length > 1 ? `_${i}` : ""}` })));
    const res = await ctx.execute("batch.execute", { commands: steps, onError: "continue", undoGroup: "Roxy: autofix" }, { timeoutMs: 300_000, source: "autofix" });
    if (!res.success) return fromResponse(res);
    lastProposals = new Map();
    const after = await collect();
    const report = after.success ? validateProject(after.data as DiagnosticsSnapshot) : null;
    return {
      ok: true,
      opId: res.id,
      data: {
        applied: res.data,
        checkpoint: cp.ok ? (cp.data as { checkpoint: string }).checkpoint : null,
        validationAfter: report && { ok: report.ok, counts: report.counts, issues: report.issues.slice(0, 20) },
      },
      warnings: warnings.length ? warnings : undefined,
    };
  },
};

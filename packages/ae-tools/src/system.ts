import * as z from "zod/v4";
import { batchExecute, compField, containsRef, ErrorCode, getCommand, type DiagnosticsSnapshot } from "@roxy/ae-protocol";
import { validateProject } from "@roxy/project-validator";
import { fromResponse, type ToolDefinition } from "./types.js";

export const statusTool: ToolDefinition = {
  name: "ae_status",
  description:
    "Connection status of the After Effects plugin (bridge port, connected, AE version, plugin version). Call first when anything fails with AE_NOT_CONNECTED.",
  inputSchema: z.object({ ping: z.boolean().default(true).describe("Also round-trip a ping to the plugin") }),
  readOnly: true,
  handler: async (args, ctx) => {
    const status = ctx.status();
    const data: Record<string, unknown> = { ...status, pluginCommands: status.pluginCommands.length };
    if (args.ping && status.connected) {
      const res = await ctx.execute("system.ping", {}, { timeoutMs: 5000, source: "status" });
      data.ping = res.success ? { ok: true, ms: res.meta?.durationMs, host: (res.data as { host?: unknown })?.host } : { ok: false, error: res.error };
    }
    if (!status.connected) {
      data.hint = status.listening
        ? "Open the Roxy AE Agent panel in After Effects (AE 2024-2026: Window > Extensions > Roxy AE Agent; AE 27+: UXP plugin). The panel connects automatically; the port must match."
        : `Bridge not listening: ${status.bridgeError ?? "unknown"}. Another Roxy MCP server may be using port ${status.port}.`;
    }
    return { ok: true, data };
  },
};

export const batchTool: ToolDefinition = {
  name: "ae_batch_execute",
  description: `[batch.execute] ${batchExecute.description} Use for anything beyond a few operations (e.g. many keyframes/layers).`,
  inputSchema: batchExecute.args,
  handler: async (args, ctx) => {
    // Fail fast on the server for steps we can fully validate (no $ref inside).
    const problems: Array<{ step: number; id?: string; message: string }> = [];
    (args.commands as Array<{ id?: string; command: string; args: unknown }>).forEach((step, i) => {
      const spec = getCommand(step.command);
      if (!spec) return problems.push({ step: i, id: step.id, message: `unknown command "${step.command}"` });
      if (spec.batchable === false) return problems.push({ step: i, id: step.id, message: `"${step.command}" is not allowed in a batch` });
      if (!containsRef(step.args)) {
        const parsed = spec.args.safeParse(step.args ?? {});
        if (!parsed.success) {
          problems.push({ step: i, id: step.id, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
        }
      }
    });
    if (problems.length) {
      return { ok: false, error: { code: ErrorCode.INVALID_ARGS, message: "Batch rejected before execution; nothing was changed", details: problems } };
    }
    return fromResponse(await ctx.execute("batch.execute", args, { timeoutMs: batchExecute.timeoutMs, source: "batch" }));
  },
};

export const validateTool: ToolDefinition = {
  name: "ae_project_validate",
  description:
    "Run project validation (missing assets, broken expressions, empty comps, duplicate Roxy IDs, broken parents, off-screen/timing heuristics). " +
    "Returns issues with comp/layer references.",
  inputSchema: z.object({
    comp: compField.describe("Validate only this comp (default: whole project)"),
    rules: z.array(z.string()).optional().describe("Run only these rule ids"),
    maxIssues: z.number().int().min(1).max(500).default(100),
  }),
  readOnly: true,
  handler: async (args, ctx) => {
    const res = await ctx.execute("project.collectDiagnostics", { comp: args.comp }, { timeoutMs: 120_000, source: "validate" });
    if (!res.success) return fromResponse(res);
    const report = validateProject(res.data as DiagnosticsSnapshot, { only: args.rules, maxIssues: args.maxIssues });
    return { ok: true, opId: res.id, data: report, warnings: res.warnings };
  },
};

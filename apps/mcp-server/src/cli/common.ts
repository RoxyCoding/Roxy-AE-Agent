import { buildAeTools, type ToolContext, type ToolOutcome } from "@roxy/ae-tools";
import { createLogger, loadConfig } from "../config.js";
import { createRuntime } from "../runtime.js";

export async function startCli(waitMs: number) {
  const config = loadConfig();
  const logger = createLogger(config);
  // CLI tools must not wait for the port: fail fast if another Roxy MCP server owns it.
  const { bridge, ctx } = createRuntime(config, logger, { retryBindMs: 0 });
  bridge.start();
  await new Promise((r) => setTimeout(r, 300));
  if (!bridge.status().listening) {
    console.log(`[ROXY][CLI] cannot listen on port ${config.port}: ${bridge.status().bridgeError ?? "unknown error"}`);
    console.log("  Another Roxy MCP server is probably running (e.g. started by Claude Code / Codex).");
    console.log("  - Use that client instead (ask it to run ae_status), or");
    console.log("  - close that client (or disable roxy-ae with /mcp) and run this command again.");
    await bridge.stop();
    process.exit(3);
  }
  console.log(`[ROXY][CLI] waiting up to ${waitMs / 1000}s for the AE plugin on ws://${config.host}:${config.port} ...`);
  const ok = await bridge.waitForConnection(waitMs);
  const status = bridge.status();
  if (!ok) {
    console.log(`[ROXY][CLI] plugin did not connect. listening=${status.listening} error=${status.bridgeError ?? "-"}`);
    console.log("  - Is After Effects running with the Roxy AE Agent panel open? (AE 2024-2026: Window > Extensions > Roxy AE Agent)");
    console.log("  - Is another Roxy MCP server (e.g. Claude Code) already using the port? Close it first.");
    await bridge.stop();
    process.exit(2);
  }
  console.log(`[ROXY][CLI] connected: ${JSON.stringify({ plugin: status.plugin, host: status.host })}`);
  return { bridge, ctx };
}

const tools = new Map(buildAeTools().map((t) => [t.name, t]));

/** Call a tool exactly like the MCP layer does (schema defaults applied). */
export async function callTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: { code: "INVALID_ARGS", message: parsed.error.message } };
  return tool.handler(parsed.data, ctx);
}

export function print(step: string, outcome: ToolOutcome): void {
  const mark = outcome.ok ? "OK  " : "FAIL";
  const body = outcome.ok ? outcome.data : outcome.error;
  let text = JSON.stringify(body);
  if (text && text.length > 600) text = text.slice(0, 600) + "...";
  console.log(`[${mark}] ${step}: ${text}`);
  if (outcome.warnings?.length) console.log(`       warnings: ${JSON.stringify(outcome.warnings)}`);
}

/**
 * Roxy AE Agent - MCP server entry (stdio).
 *
 *   Claude Code / Codex --stdio--> this process --WebSocket--> AE UXP plugin (AE 27+) or CEP extension (AE 2024-2026) --> After Effects
 */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { buildAeTools } from "@roxy/ae-tools";
import { buildMvTools } from "@roxy/mv-tools";
import { createLogger, loadConfig, SERVER_INFO } from "./config.js";
import { registerTools } from "./mcp/register.js";
import { registerPrompts } from "./mcp/prompts.js";
import { createRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const { bridge, ctx } = createRuntime(config, logger);

  process.on("uncaughtException", (e) => logger.error("MCP", "uncaughtException", e));
  process.on("unhandledRejection", (e) => logger.error("MCP", "unhandledRejection", e));

  bridge.start();

  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Roxy AE Agent controls Adobe After Effects through a UXP plugin (AE 27+) or a CEP extension (AE 2024-2026). Start with ae_status. " +
      "Address comps/layers with selectors (name/id/roxyId); AMBIGUOUS_SELECTOR means pick a more specific selector. " +
      "Use ae_batch_execute for many operations. Prefer effect matchNames (ae_effect_listAvailable) over display names. " +
      "Use ae_preview_frameAtTime (returnImage=true to look at it) to check results visually. " +
      "For iterative refinement use the review loop (ae_review_start -> ae_review_record -> fixes -> ae_review_capture). " +
      "Never apply ae_project_autofix proposals without the user's approval.",
  });
  const tools = [...buildAeTools(), ...buildMvTools({ experimental: config.experimentalMv })];
  registerTools(server, tools, ctx);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP", `${SERVER_INFO.name} ${SERVER_INFO.version} ready: ${tools.length} tools, preview dir ${ctx.preview.dir}`);

  const shutdown = async () => {
    logger.info("MCP", "shutting down");
    await bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
}

main().catch((e) => {
  process.stderr.write(`[ROXY][MCP][ERROR] fatal: ${(e as Error)?.stack ?? e}\n`);
  process.exit(1);
});

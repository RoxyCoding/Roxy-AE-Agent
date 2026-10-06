import type { McpServer } from "@modelcontextprotocol/server";
import { ErrorCode, toErrorPayload } from "@roxy/ae-protocol";
import type { ToolContext, ToolDefinition, ToolOutcome } from "@roxy/ae-tools";

type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** Compact JSON (no indentation) keeps tool results cheap for the AI's context. */
export function outcomeToMcp(outcome: ToolOutcome): { content: McpContent[]; isError?: boolean } {
  const body: Record<string, unknown> = { success: outcome.ok };
  if (outcome.opId) body.opId = outcome.opId;
  if (outcome.ok) body.data = outcome.data;
  else body.error = outcome.error;
  if (outcome.warnings?.length) body.warnings = outcome.warnings;
  const content: McpContent[] = [{ type: "text", text: JSON.stringify(body) }];
  for (const img of outcome.images ?? []) content.push({ type: "image", data: img.base64, mimeType: img.mimeType });
  return outcome.ok ? { content } : { content, isError: true };
}

export function registerTools(server: McpServer, tools: ToolDefinition[], ctx: ToolContext): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`Duplicate tool name ${tool.name}`);
    seen.add(tool.name);
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly ?? false, destructiveHint: tool.destructive ?? false },
      },
      async (args: unknown) => {
        const started = Date.now();
        ctx.logger.debug("MCP", `tool ${tool.name}`, args);
        try {
          const outcome = await tool.handler(args, ctx);
          ctx.logger.info("MCP", `tool ${tool.name} ${outcome.ok ? "ok" : `failed: ${outcome.error?.code}`} (${Date.now() - started}ms)`);
          return outcomeToMcp(outcome);
        } catch (e) {
          // Safe failure: a bug in a tool must never crash the server.
          ctx.logger.error("MCP", `tool ${tool.name} threw`, e);
          return outcomeToMcp({ ok: false, error: toErrorPayload(e, ErrorCode.INTERNAL) });
        }
      },
    );
  }
}

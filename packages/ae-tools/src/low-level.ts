import { COMMANDS, type CommandSpec } from "@roxy/ae-protocol";
import { fromResponse, type ToolDefinition } from "./types.js";

/** Tool names must match ^[a-zA-Z0-9_-]+$ for MCP clients, so dots become underscores. */
const NAME_OVERRIDES: Record<string, string> = {
  "project.getState": "ae_get_project_state",
};

export function commandToToolName(command: string): string {
  return NAME_OVERRIDES[command] ?? "ae_" + command.replace(/\./g, "_");
}

/** 1:1 tools generated from the command catalog (everything not marked internal). */
export function buildCommandTools(): ToolDefinition[] {
  return Object.values(COMMANDS)
    .filter((spec) => !spec.internal && spec.name !== "batch.execute")
    .map((spec) => commandTool(spec));
}

function commandTool(spec: CommandSpec): ToolDefinition {
  return {
    name: commandToToolName(spec.name),
    description: `[${spec.name}] ${spec.description}`,
    inputSchema: spec.args,
    readOnly: !spec.mutates && !spec.destructive,
    destructive: spec.destructive ?? false,
    handler: async (args, ctx) => fromResponse(await ctx.execute(spec.name, args, { timeoutMs: spec.timeoutMs, source: spec.name })),
  };
}

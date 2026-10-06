import * as z from "zod/v4";
import { defineCommand } from "./define.js";
import { compField } from "../selectors.js";

/**
 * Plugin-side preview command. The MCP server owns the output path (so it can verify the file),
 * therefore the public MCP tool has a different (smaller) schema - see @roxy/ae-tools.
 */
export const previewRenderFrame = defineCommand({
  name: "preview.renderFrame",
  description: "Internal: render one comp frame to a PNG at `outputPath`.",
  args: z.object({
    comp: compField,
    time: z.number().min(0).optional().describe("Seconds; omit for the comp's current time"),
    outputPath: z.string().min(1),
    draft: z.boolean().default(false),
  }),
  mutates: false,
  internal: true,
  batchable: false,
  timeoutMs: 120_000,
});

export const undoBeginGroup = defineCommand({
  name: "undo.beginGroup",
  description:
    "Open an explicit undo group so the following commands become ONE Edit>Undo step. Must be closed with undo.endGroup. " +
    "Commands executed outside an explicit group are wrapped in their own group automatically.",
  args: z.object({ name: z.string().min(1).default("Roxy AE Agent") }),
  mutates: false,
  batchable: false,
});

export const undoEndGroup = defineCommand({
  name: "undo.endGroup",
  description: "Close the explicit undo group opened by undo.beginGroup.",
  args: z.object({}),
  mutates: false,
  batchable: false,
});

export const batchStep = z.object({
  id: z.string().optional().describe("Step id, referenced by later steps as {\"$ref\":\"<id>.<path>\"}"),
  command: z.string().describe("Command name, e.g. 'keyframe.add'"),
  args: z.record(z.string(), z.unknown()).default({}),
});

export const batchExecute = defineCommand({
  name: "batch.execute",
  description:
    "Execute many commands in ONE round trip and ONE undo group. onError='stop' (default) stops at the first failure; " +
    "'continue' runs the rest. Completed steps are NOT rolled back automatically (use Edit>Undo for the whole group). " +
    "Later steps can use {\"$ref\":\"stepId.path\"} to reuse earlier results.",
  args: z.object({
    commands: z.array(batchStep).min(1).max(500),
    onError: z.enum(["stop", "continue"]).default("stop"),
    undoGroup: z.string().default("Roxy batch"),
  }),
  mutates: false, // undo grouping is handled by the batch itself
  batchable: false,
  timeoutMs: 300_000,
});

import { buildCommandTools } from "./low-level.js";
import { previewCurrentFrame, previewFrameAtTime, previewFrames } from "./preview.js";
import { COMPOSED_TOOLS } from "./compose.js";
import { CHECKPOINT_TOOLS } from "./checkpoint.js";
import { REVIEW_TOOLS } from "./review.js";
import { renderVerify } from "./verify.js";
import { projectAutofix } from "./autofix.js";
import { batchTool, statusTool, validateTool } from "./system.js";
import type { ToolDefinition } from "./types.js";

export * from "./types.js";
export { commandToToolName } from "./low-level.js";
export * from "./plan.js";
export * from "./compose.js";
export * from "./checkpoint.js";
export * from "./review.js";
export * from "./verify.js";
export * from "./autofix.js";

/** All low-level After Effects tools exposed over MCP. */
export function buildAeTools(): ToolDefinition[] {
  return [
    statusTool,
    ...buildCommandTools(),
    previewFrameAtTime,
    previewCurrentFrame,
    previewFrames,
    batchTool,
    validateTool,
    ...COMPOSED_TOOLS,
    ...CHECKPOINT_TOOLS,
    ...REVIEW_TOOLS,
    renderVerify,
    projectAutofix,
  ];
}

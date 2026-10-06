import * as z from "zod/v4";
import { compField, ErrorCode, previewRenderFrame } from "@roxy/ae-protocol";
import type { ToolContext, ToolDefinition, ToolOutcome } from "./types.js";

const common = {
  draft: z.boolean().default(false).describe("Draft-quality render (faster)"),
  returnImage: z
    .boolean()
    .default(false)
    .describe("Also return the PNG inline so a vision model can inspect it (costs context). The file path is always returned."),
};

export async function renderFrame(
  ctx: ToolContext,
  args: { comp?: unknown; time?: number; draft: boolean; returnImage: boolean },
): Promise<ToolOutcome> {
  // Resolve the comp name first so the file name is meaningful (and the selector is validated).
  const info = await ctx.execute("comp.get", { comp: args.comp, includeLayers: false });
  if (!info.success) return { ok: false, opId: info.id, error: info.error };
  const comp = info.data as { id: number; name: string; time?: number };
  const time = args.time ?? comp.time ?? 0;
  const outputPath = ctx.preview.framePath(comp.name, time);
  const timeoutMs = previewRenderFrame.timeoutMs ?? 120_000;

  const res = await ctx.execute("preview.renderFrame", { comp: comp.id, time, outputPath, draft: args.draft }, { timeoutMs, source: "preview" });
  if (!res.success) return { ok: false, opId: res.id, error: res.error, warnings: res.warnings };

  try {
    const file = await ctx.preview.waitForFrame(outputPath, timeoutMs);
    ctx.preview.prune();
    const out: ToolOutcome = {
      ok: true,
      opId: res.id,
      data: {
        imagePath: file.path,
        width: file.width,
        height: file.height,
        time,
        compName: comp.name,
        compId: comp.id,
        draft: args.draft,
        // CEP extension only: saveFrameToPng (undocumented in ExtendScript) or renderQueue (documented fallback)
        method: (res.data as { method?: string } | undefined)?.method,
      },
      warnings: res.warnings,
    };
    if (args.returnImage) out.images = [{ base64: await ctx.preview.readBase64(file.path), mimeType: "image/png" }];
    return out;
  } catch (e) {
    return {
      ok: false,
      opId: res.id,
      error: {
        code: ErrorCode.PREVIEW_FAILED,
        message: (e as Error).message,
        details: { plugin: res.data },
        hint: "Check the AE plugin log. The comp may contain missing footage or the output folder may not be writable by AE.",
      },
    };
  }
}

export const previewFrameAtTime: ToolDefinition = {
  name: "ae_preview_frameAtTime",
  description:
    "[preview.frameAtTime] Render one frame of a comp to PNG (CompItem.saveFrameToPng). Returns imagePath, width, height, time, compName. " +
    "Set returnImage=true to view the frame yourself.",
  inputSchema: z.object({
    comp: compField,
    time: z.number().min(0).describe("Seconds (comp time)"),
    ...common,
  }),
  readOnly: true,
  handler: (args, ctx) => renderFrame(ctx, args),
};

export const previewCurrentFrame: ToolDefinition = {
  name: "ae_preview_currentFrame",
  description: "[preview.currentFrame] Render the comp's current-time frame to PNG. Same output as ae_preview_frameAtTime.",
  inputSchema: z.object({ comp: compField, ...common }),
  readOnly: true,
  handler: (args, ctx) => renderFrame(ctx, { ...args, time: undefined }),
};

export const previewFrames: ToolDefinition = {
  name: "ae_preview_frames",
  description:
    "Render several frames of a comp (up to 12 times) in one call - e.g. key moments of an animation. Same output per frame as ae_preview_frameAtTime. " +
    "returnImage=true returns all images (costs context; prefer few times).",
  inputSchema: z.object({
    comp: compField,
    times: z.array(z.number().min(0)).min(1).max(12),
    ...common,
  }),
  readOnly: true,
  handler: async (args, ctx) => {
    const frames: unknown[] = [];
    const images: ToolOutcome["images"] = [];
    const warnings: string[] = [];
    for (const time of args.times as number[]) {
      const out = await renderFrame(ctx, { comp: args.comp, time, draft: args.draft, returnImage: args.returnImage });
      if (!out.ok) return { ...out, data: { framesBeforeFailure: frames } };
      frames.push(out.data);
      if (out.images) images.push(...out.images);
      if (out.warnings) warnings.push(...out.warnings);
    }
    return { ok: true, data: { frames }, images: images.length ? images : undefined, warnings: warnings.length ? warnings : undefined };
  },
};

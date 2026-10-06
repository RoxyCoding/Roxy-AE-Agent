/**
 * Phase 1 end-to-end scenario without an AI:  npm run smoke [-- --glow=<matchName>]
 *
 * 1920x1080 / 60fps / 5s comp, centered text "ROXY", opacity 0->100 (0-1s), scale 100->120 (1-3s),
 * fade out (4-5s), Glow, preview PNG at 2.5s. Every step uses the same tool handlers as MCP.
 * The visual result must be checked by a human in After Effects / the PNG.
 */
import { callTool, print, startCli } from "./common.js";

const glowArg = process.argv.find((a) => a.startsWith("--glow="))?.slice("--glow=".length);
const { bridge, ctx } = await startCli(60_000);
let failed = false;
const step = async (label: string, tool: string, args: Record<string, unknown>) => {
  const out = await callTool(ctx, tool, args);
  print(label, out);
  if (!out.ok) failed = true;
  return out;
};

const compName = `ROXY_PHASE1_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
const comp = { name: compName };
const layer = { name: "ROXY_TEXT" };

try {
  await step("create comp", "ae_comp_create", { name: compName, width: 1920, height: 1080, duration: 5, fps: 60 });
  await step("create text", "ae_text_create", { comp, text: "ROXY", name: "ROXY_TEXT", fontSize: 200, fillColor: [1, 1, 1] });
  await step("opacity keys", "ae_keyframe_add", {
    comp,
    layer,
    path: ["transform", "opacity"],
    keys: [
      { time: 0, value: 0 },
      { time: 1, value: 100 },
      { time: 4, value: 100 },
      { time: 5, value: 0 },
    ],
  });
  await step("scale keys", "ae_keyframe_add", {
    comp,
    layer,
    path: ["transform", "scale"],
    keys: [
      { time: 1, value: 100 },
      { time: 3, value: 120 },
    ],
  });

  let glow = glowArg;
  if (!glow) {
    const list = await step("find Glow", "ae_effect_listAvailable", { filter: "glo", limit: 20 });
    const effects = ((list.data as { effects?: Array<{ displayName: string; matchName: string }> })?.effects ?? []);
    // "ADBE Glo2" is the matchName of the built-in Glow effect; fall back to an exact display-name match.
    glow = effects.find((e) => e.matchName === "ADBE Glo2")?.matchName ?? effects.find((e) => e.displayName.toLowerCase() === "glow")?.matchName;
    if (!glow) console.log("       Glow not identified automatically; rerun with --glow=<matchName> from the list above.");
  }
  if (glow) await step("add Glow", "ae_effect_add", { comp, layer, matchName: glow });

  await step("transform @2.5s (expect opacity 100, scale 115 if linear)", "ae_transform_get", { comp, layer, time: 2.5 });
  await step("preview @2.5s", "ae_preview_frameAtTime", { comp, time: 2.5 });
  await step("validate comp", "ae_project_validate", { comp });
} finally {
  console.log(failed ? "\n[ROXY][CLI] smoke finished WITH FAILURES" : "\n[ROXY][CLI] smoke finished: all steps OK. Check the comp and PNG visually in AE.");
  await bridge.stop();
  process.exit(failed ? 1 : 0);
}

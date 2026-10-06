import * as z from "zod/v4";
import { compField, ErrorCode, RoxyError } from "@roxy/ae-protocol";
import { ref, textAnimatorSteps } from "@roxy/ae-tools";
import { defineMvTool, type PlanStep } from "./define.js";

/** Options accepted by the schema; the ones not yet implemented are rejected with UNSUPPORTED. */
const SUPPORTED = {
  reveal: ["line", "character"],
  entrance: ["none", "fade", "scale-pop", "slide-up"],
  exit: ["none", "fade"],
} as const;

const ANIM_POSITION = ["ADBE Text Properties", "ADBE Text Animators"];

export const createLyricAnimation = defineMvTool({
  name: "mv_createLyricAnimation",
  experimental: true,
  description:
    "Create one lyric line: a text layer tagged role=lyrics, visible between `start` and `start+duration` (comp seconds). " +
    "reveal: line (whole line) | character (characters appear left to right via a text animator). " +
    "entrance: fade | scale-pop | slide-up | none. exit: fade | none. Word reveal and glitch exit are planned.",
  inputSchema: z.object({
    comp: compField,
    text: z.string().min(1),
    start: z.number().min(0),
    duration: z.number().positive(),
    reveal: z.enum(["line", "word", "character"]).default("line"),
    entrance: z.enum(["none", "fade", "scale-pop", "slide-up"]).default("fade"),
    exit: z.enum(["none", "fade", "glitch"]).default("fade"),
    position: z.array(z.number()).min(2).max(3).optional(),
    fontSize: z.number().positive().optional(),
    name: z.string().optional(),
    roxyId: z.string().optional(),
    scene: z.string().optional(),
  }),
  plan: (a) => {
    for (const key of ["reveal", "entrance", "exit"] as const) {
      if (!(SUPPORTED[key] as readonly string[]).includes(a[key])) {
        throw new RoxyError(ErrorCode.UNSUPPORTED, `${key}="${a[key]}" is not implemented yet`, {
          details: { supported: SUPPORTED[key] },
          hint: "Use a supported option, or build it from low-level tools (keyframe.add / ae_text_addAnimator / effect.add).",
        });
      }
    }
    const end = a.start + a.duration;
    const inLen = Math.min(0.3, a.duration / 3);
    const outLen = Math.min(0.3, a.duration / 3);
    const target = { comp: ref("text.comp.id"), layer: ref("text.layer.id") };
    const perCharacter = a.reveal === "character";

    const steps: PlanStep[] = [
      {
        id: "text",
        command: "text.create",
        args: {
          ...(a.comp !== undefined ? { comp: a.comp } : {}),
          text: a.text,
          ...(a.name ? { name: a.name } : {}),
          ...(a.position ? { position: a.position } : {}),
          ...(a.fontSize ? { fontSize: a.fontSize } : {}),
          roxy: { role: "lyrics", managedBy: "roxy", ...(a.roxyId ? { roxyId: a.roxyId } : {}), ...(a.scene ? { scene: a.scene } : {}) },
        },
      },
    ];

    // Layer opacity gates visibility to [start, end] so no layer trimming is needed.
    // With per-character reveal the characters themselves do the entrance, so the layer just switches on.
    const fadeIn = !perCharacter && a.entrance !== "none";
    const opacity: Array<{ time: number; value: number }> = [];
    if (a.start > 0 && !fadeIn) opacity.push({ time: Math.max(0, a.start - 0.001), value: 0 });
    opacity.push({ time: a.start, value: fadeIn ? 0 : 100 });
    if (fadeIn) opacity.push({ time: a.start + inLen, value: 100 });
    // exit="none" = hard cut: hold 100 until just before `end`.
    opacity.push({ time: a.exit === "none" ? end - 0.001 : end - outLen, value: 100 });
    opacity.push({ time: end, value: 0 });
    steps.push({ id: "opacity", command: "keyframe.add", args: { ...target, path: ["transform", "opacity"], keys: opacity } });

    if (perCharacter) {
      // Characters hidden by an animator; its Range Selector sweeps so they appear left to right.
      const revealLen = Math.min(a.duration * 0.6, Math.max(0.3, a.text.length * 0.06));
      const properties: Record<string, unknown> = { opacity: 0 };
      if (a.entrance === "slide-up") properties.position = [0, 40, 0];
      if (a.entrance === "scale-pop") properties.scale = 0;
      // comp/layer are batch $refs here (resolved in the plugin), hence the cast.
      const animatorArgs = {
        ...target,
        properties,
        reveal: { start: a.start, duration: revealLen, direction: "in", ease: "easeOut" },
        name: "Roxy Reveal",
      } as unknown as Parameters<typeof textAnimatorSteps>[0];
      steps.push(...textAnimatorSteps(animatorArgs, "reveal"));
    } else if (a.entrance === "scale-pop") {
      steps.push({
        id: "scale",
        command: "keyframe.add",
        args: {
          ...target,
          path: ["transform", "scale"],
          keys: [
            { time: a.start, value: 60 },
            { time: a.start + inLen * 0.6, value: 112 },
            { time: a.start + inLen, value: 100, ease: "easeIn" },
          ],
        },
      });
    } else if (a.entrance === "slide-up") {
      // A text animator with no selector range limits applies to the whole line: animate its position offset.
      const animPath = [...ANIM_POSITION, ref("slide.index")];
      steps.push(
        { id: "slide", command: "property.addGroup", args: { ...target, path: ANIM_POSITION, matchName: "ADBE Text Animator", name: "Roxy Slide" } },
        { id: "slidePos", command: "property.addGroup", args: { ...target, path: [...animPath, "ADBE Text Animator Properties"], matchName: "ADBE Text Position 3D" } },
        {
          id: "slideKeys",
          command: "keyframe.add",
          args: {
            ...target,
            path: [...animPath, "ADBE Text Animator Properties", "ADBE Text Position 3D"],
            keys: [
              { time: a.start, value: [0, 40, 0] },
              { time: a.start + inLen, value: [0, 0, 0], ease: "easeIn" },
            ],
          },
        },
      );
    }

    return {
      steps,
      undoGroup: `Roxy: lyric "${a.text.slice(0, 20)}"`,
      summary: { text: a.text, start: a.start, end, reveal: a.reveal, entrance: a.entrance, exit: a.exit, steps: steps.length },
    };
  },
});

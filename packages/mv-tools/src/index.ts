import type { ToolDefinition } from "@roxy/ae-tools";
import { createLyricAnimation } from "./lyric-animation.js";

export * from "./define.js";
export { createLyricAnimation };

/**
 * High-level MV tools. Planned (see docs/ROADMAP.md): mv.createBeatPulse, mv.createGlitchTransition,
 * mv.createParallaxScene, mv.createCameraSequence, mv.createIntro / Chorus / Outro.
 */
export function buildMvTools(options: { experimental: boolean }): ToolDefinition[] {
  return options.experimental ? [createLyricAnimation] : [];
}

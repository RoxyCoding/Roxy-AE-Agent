import { ErrorCode, RoxyError } from "@roxy/ae-protocol";
import { aeCall, getProject, safeGet } from "../ae/host.js";
import { allComps, allLayers, compRef, resolveComp } from "../ae/resolve.js";
import { compDetails, compSummary, layerSummary } from "../ae/serialize.js";
import { writeMetadata } from "../ae/metadata.js";
import type { Handler } from "./context.js";

interface CompCreateArgs {
  name: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  pixelAspect: number;
  bgColor?: number[];
  open: boolean;
  allowDuplicateName: boolean;
  roxy?: Record<string, unknown>;
}

export const compHandlers: Record<string, Handler> = {
  "comp.create": (args: CompCreateArgs, ctx) => {
    const existing = allComps().filter((c) => c.name === args.name);
    if (existing.length > 0 && !args.allowDuplicateName) {
      throw new RoxyError(ErrorCode.CONFLICT, `A composition named "${args.name}" already exists`, {
        details: { existing: existing.map(compRef) },
        hint: "Use the existing comp, choose another name, or pass allowDuplicateName=true.",
      });
    }
    const project = getProject();
    const comp = aeCall("items.addComp", () =>
      project.items.addComp(args.name, args.width, args.height, args.pixelAspect, args.duration, args.fps),
    );
    if (args.bgColor) aeCall("set bgColor", () => (comp.bgColor = args.bgColor));
    writeMetadata(comp, { managedBy: "roxy", ...(args.roxy ?? {}) }, ctx.warn);
    if (args.open) {
      try {
        comp.openInViewer();
      } catch (e) {
        ctx.warn(`openInViewer failed: ${(e as Error).message}`);
      }
    }
    return { compId: comp.id, comp: compSummary(comp) };
  },

  "comp.get": (args: { comp?: unknown; includeLayers: boolean }) => {
    const comp = resolveComp(args.comp as never);
    const out: Record<string, unknown> = compDetails(comp);
    if (args.includeLayers) out.layers = allLayers(comp).map(layerSummary);
    return out;
  },

  "comp.list": (args: { filter?: string; limit: number }) => {
    const f = args.filter?.toLowerCase();
    const comps = allComps().filter((c) => !f || String(c.name).toLowerCase().includes(f));
    return {
      total: comps.length,
      comps: comps.slice(0, args.limit).map((c) => {
        const s = compSummary(c);
        return { id: s.id, name: s.name, width: s.width, height: s.height, fps: s.fps, duration: s.duration, numLayers: s.numLayers };
      }),
      activeCompId: safeGet(() => getProject().activeItem?.id, null),
    };
  },
};

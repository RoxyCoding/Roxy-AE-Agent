import { ErrorCode, RoxyError, type EffectSelector, type PropertyPath } from "@roxy/ae-protocol";
import { aeCall, getApp, safeGet, type AE } from "../ae/host.js";
import { describeProperty, MN, resolvePropertyPath } from "../ae/properties.js";
import { effectsOnLayer } from "../ae/serialize.js";
import { target, type Handler } from "./context.js";
import { applyPropertyChange } from "./property.js";

interface InstalledEffect {
  displayName: string;
  matchName: string;
  category: string;
  version?: string;
}

/** `app.effects` (AE 27.0): every installed effect incl. third-party plugins. */
function installedEffects(): InstalledEffect[] {
  const list = safeGet<InstalledEffect[] | null>(() => getApp().effects, null);
  if (!Array.isArray(list)) {
    throw new RoxyError(ErrorCode.UNSUPPORTED, "app.effects is not available in this After Effects build");
  }
  return list;
}

function resolveEffect(layer: AE, sel: EffectSelector): AE {
  const parade = layer.property(MN.effects);
  const s = typeof sel === "string" ? { name: sel } : typeof sel === "number" ? { index: sel } : sel;
  const applied = effectsOnLayer(layer);
  const matches = applied.filter(
    (e) =>
      (s.index === undefined || e.index === s.index) &&
      (s.name === undefined || e.name === s.name) &&
      (s.matchName === undefined || e.matchName === s.matchName),
  );
  if (matches.length === 1) return parade.property(matches[0].index);
  if (matches.length === 0) {
    throw new RoxyError(ErrorCode.NOT_FOUND, `No effect matches ${JSON.stringify(sel)} on layer "${layer.name}"`, {
      details: { applied },
    });
  }
  throw new RoxyError(ErrorCode.AMBIGUOUS_SELECTOR, `${matches.length} effects match ${JSON.stringify(sel)}`, {
    details: { candidates: matches },
    hint: "Select by index.",
  });
}

export const effectHandlers: Record<string, Handler> = {
  "effect.listAvailable": (args: { filter?: string; category?: string; offset: number; limit: number }) => {
    const f = args.filter?.toLowerCase();
    const c = args.category?.toLowerCase();
    const all = installedEffects().filter(
      (e) =>
        (!f || e.displayName.toLowerCase().includes(f) || e.matchName.toLowerCase().includes(f)) &&
        (!c || (e.category ?? "").toLowerCase().includes(c)),
    );
    return {
      total: all.length,
      offset: args.offset,
      effects: all.slice(args.offset, args.offset + args.limit).map((e) => ({
        displayName: e.displayName,
        matchName: e.matchName,
        category: e.category,
      })),
    };
  },

  "effect.listOnLayer": (args) => {
    const { layer } = target(args, false);
    return { layer: { id: layer.id, name: layer.name }, effects: effectsOnLayer(layer) };
  },

  "effect.add": (args: { comp?: unknown; layer: unknown; matchName?: string; displayName?: string; name?: string }) => {
    const { layer } = target(args, true);
    let matchName = args.matchName;
    if (!matchName) {
      if (!args.displayName) throw new RoxyError(ErrorCode.INVALID_ARGS, "Provide `matchName` (preferred) or `displayName`");
      const wanted = args.displayName.toLowerCase();
      const found = installedEffects().filter((e) => e.displayName.toLowerCase() === wanted);
      if (found.length === 0) {
        const similar = installedEffects()
          .filter((e) => e.displayName.toLowerCase().includes(wanted) || e.matchName.toLowerCase().includes(wanted))
          .slice(0, 15);
        throw new RoxyError(ErrorCode.NOT_FOUND, `No installed effect named "${args.displayName}"`, {
          details: { similar },
          hint: "Use effect.listAvailable with a filter, then pass matchName.",
        });
      }
      if (found.length > 1) {
        throw new RoxyError(ErrorCode.AMBIGUOUS_SELECTOR, `${found.length} installed effects are named "${args.displayName}"`, {
          details: { candidates: found },
        });
      }
      matchName = found[0].matchName;
    }
    const parade = layer.property(MN.effects);
    if (!safeGet(() => parade.canAddProperty(matchName), false)) {
      throw new RoxyError(ErrorCode.NOT_FOUND, `Effect "${matchName}" cannot be added to layer "${layer.name}"`, {
        hint: "Check the matchName with effect.listAvailable (the effect may not be installed).",
      });
    }
    const fx = aeCall(`addProperty("${matchName}")`, () => parade.addProperty(matchName));
    if (args.name) fx.name = args.name;
    return {
      layer: { id: layer.id, name: layer.name },
      effect: describeProperty(fx, { depth: 1, index: safeGet(() => fx.propertyIndex, undefined) }),
    };
  },

  "effect.getProperties": (args: { comp?: unknown; layer: unknown; effect: EffectSelector; depth: number; time?: number }) => {
    const { layer } = target(args, false);
    const fx = resolveEffect(layer, args.effect);
    return {
      layer: { id: layer.id, name: layer.name },
      effect: describeProperty(fx, { depth: args.depth, time: args.time, index: safeGet(() => fx.propertyIndex, undefined) }),
    };
  },

  "effect.setProperty": (
    args: { comp?: unknown; layer: unknown; effect: EffectSelector; property: PropertyPath; value?: unknown; time?: number; expression?: string },
    ctx,
  ) => {
    const { layer } = target(args, true);
    const fx = resolveEffect(layer, args.effect);
    const prop = resolvePropertyPath(fx, args.property, `effect "${fx.name}"`);
    return {
      layer: { id: layer.id, name: layer.name },
      effect: { name: fx.name, matchName: fx.matchName },
      ...applyPropertyChange(prop, args, ctx.warn),
    };
  },
};

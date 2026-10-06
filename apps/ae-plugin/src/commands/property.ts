import { ErrorCode, RoxyError, type PropertyPath } from "@roxy/ae-protocol";
import { aeCall, enumValue, hostClass, safeGet, type AE } from "../ae/host.js";
import {
  MN,
  describeProperty,
  isGroup,
  listChildren,
  resolvePropertyPath,
  setExpression,
  setPropertyValue,
  toJsonValue,
  type TransformKey,
} from "../ae/properties.js";
import { layerSummary, transformValues } from "../ae/serialize.js";
import { target, type Handler } from "./context.js";

interface PropertySetArgs {
  comp?: unknown;
  layer: unknown;
  path: PropertyPath;
  value?: unknown;
  time?: number;
  expression?: string;
  expressionEnabled?: boolean;
}

/** Shared by property.set and effect.setProperty. */
export function applyPropertyChange(
  prop: AE,
  change: { value?: unknown; time?: number; expression?: string; expressionEnabled?: boolean },
  warn: (m: string) => void,
): Record<string, unknown> {
  if (change.value === undefined && change.expression === undefined && change.expressionEnabled === undefined) {
    throw new RoxyError(ErrorCode.INVALID_ARGS, "Provide `value`, `expression` and/or `expressionEnabled`");
  }
  if (change.value !== undefined) setPropertyValue(prop, change.value, change.time, warn);
  const result: Record<string, unknown> = {};
  if (change.expression !== undefined) Object.assign(result, setExpression(prop, change.expression));
  if (change.expressionEnabled !== undefined) {
    aeCall("set expressionEnabled", () => {
      prop.expressionEnabled = change.expressionEnabled;
    });
  }
  result.property = describeProperty(prop, { depth: 0, time: change.time });
  return result;
}

const INTERP: Record<string, string> = { linear: "LINEAR", bezier: "BEZIER", hold: "HOLD" };

/** Number of KeyframeEase objects setTemporalEaseAtKey expects: 2/3 for TwoD/ThreeD values, 1 for spatial/other. */
function easeDimensions(prop: AE): number {
  if (safeGet(() => prop.isSpatial, false)) return 1;
  const v = safeGet(() => prop.value, undefined);
  return Array.isArray(v) && (v.length === 2 || v.length === 3) ? v.length : 1;
}

/** Easy ease = Bezier interpolation + KeyframeEase(speed 0, influence 33.33) on the eased side(s). */
function applyEase(prop: AE, keyIndex: number, ease: string, warn: (m: string) => void): void {
  const bezier = enumValue("KeyframeInterpolationType", "BEZIER", warn);
  if (bezier === undefined) return;
  const KeyframeEase = hostClass("KeyframeEase");
  const make = (influence: number) => {
    const e = new KeyframeEase(0, influence);
    e.speed = 0;
    e.influence = influence;
    return e;
  };
  const n = easeDimensions(prop);
  const eased = () => Array.from({ length: n }, () => make(33.33));
  const easeInSide = ease !== "easeOut";
  const easeOutSide = ease !== "easeIn";
  // The side that is not eased keeps its current interpolation and ease.
  const inType = easeInSide ? bezier : safeGet(() => prop.keyInInterpolationType(keyIndex), bezier);
  const outType = easeOutSide ? bezier : safeGet(() => prop.keyOutInterpolationType(keyIndex), bezier);
  const inEase = easeInSide ? eased() : aeCall("keyInTemporalEase", () => prop.keyInTemporalEase(keyIndex));
  const outEase = easeOutSide ? eased() : aeCall("keyOutTemporalEase", () => prop.keyOutTemporalEase(keyIndex));
  aeCall("setInterpolationTypeAtKey", () => prop.setInterpolationTypeAtKey(keyIndex, inType, outType));
  aeCall("setTemporalEaseAtKey", () => prop.setTemporalEaseAtKey(keyIndex, inEase, outEase));
}

export const propertyHandlers: Record<string, Handler> = {
  "transform.get": (args: { comp?: unknown; layer: unknown; time?: number }) => {
    const { layer } = target(args, false);
    return { layer: layerSummary(layer), time: args.time ?? null, transform: transformValues(layer, args.time) };
  },

  "transform.set": (args: { comp?: unknown; layer: unknown; values: Partial<Record<TransformKey, unknown>>; time?: number }, ctx) => {
    const { layer } = target(args, true);
    const group = layer.property(MN.transform);
    const entries = Object.entries(args.values).filter(([, v]) => v !== undefined);
    if (entries.length === 0) throw new RoxyError(ErrorCode.INVALID_ARGS, "`values` is empty");
    for (const [key, value] of entries) {
      const prop = safeGet(() => group.property(MN[key as TransformKey]), null);
      if (!prop) {
        ctx.warn(`Transform property "${key}" is not available on this layer (2D layer?)`);
        continue;
      }
      setPropertyValue(prop, value, args.time, ctx.warn);
    }
    return { layer: layerSummary(layer), transform: transformValues(layer, args.time) };
  },

  "property.get": (args: { comp?: unknown; layer: unknown; path?: PropertyPath; time?: number; depth: number }) => {
    const { layer } = target(args, false);
    if (args.path === undefined) {
      return { layer: layerSummary(layer), groups: listChildren(layer, 50), hint: "Common: transform, effects, text, masks" };
    }
    const prop = resolvePropertyPath(layer, args.path, `layer "${layer.name}"`);
    return { layer: { id: layer.id, name: layer.name }, property: describeProperty(prop, { depth: args.depth, time: args.time }) };
  },

  "property.set": (args: PropertySetArgs, ctx) => {
    const { layer } = target(args, true);
    const prop = resolvePropertyPath(layer, args.path, `layer "${layer.name}"`);
    return { layer: { id: layer.id, name: layer.name }, ...applyPropertyChange(prop, args, ctx.warn) };
  },

  "keyframe.add": (
    args: {
      comp?: unknown;
      layer: unknown;
      path: PropertyPath;
      keys: Array<{ time: number; value: unknown; interpolation?: string; ease?: string }>;
    },
    ctx,
  ) => {
    const { comp, layer } = target(args, true);
    const prop = resolvePropertyPath(layer, args.path, `layer "${layer.name}"`);
    if (isGroup(prop)) throw new RoxyError(ErrorCode.INVALID_ARGS, `"${prop.name}" is a group; keyframes need a property`);
    if (!safeGet(() => prop.canVaryOverTime, true)) {
      throw new RoxyError(ErrorCode.INVALID_ARGS, `"${prop.name}" cannot be animated`);
    }
    for (const k of args.keys) {
      if (k.time > comp.duration + 1e-6) ctx.warn(`Key at ${k.time}s is beyond the comp duration (${comp.duration}s)`);
    }
    const added: Array<{ keyIndex: number; time: number }> = [];
    for (const k of args.keys) {
      setPropertyValue(prop, k.value, k.time, ctx.warn);
      const idx: number = aeCall("nearestKeyIndex", () => prop.nearestKeyIndex(k.time));
      if (k.interpolation) {
        const t = enumValue("KeyframeInterpolationType", INTERP[k.interpolation], ctx.warn);
        if (t !== undefined) aeCall("setInterpolationTypeAtKey", () => prop.setInterpolationTypeAtKey(idx, t, t));
      }
      if (k.ease) applyEase(prop, idx, k.ease, ctx.warn);
      added.push({ keyIndex: idx, time: safeGet(() => prop.keyTime(idx), k.time) });
    }
    // Indices shift as keys are inserted; report the final state.
    return {
      layer: { id: layer.id, name: layer.name },
      property: { name: prop.name, matchName: prop.matchName },
      added: added.map((a) => ({ time: a.time, keyIndex: safeGet(() => prop.nearestKeyIndex(a.time), a.keyIndex) })),
      numKeys: safeGet(() => prop.numKeys, 0),
    };
  },

  "keyframe.remove": (
    args: { comp?: unknown; layer: unknown; path: PropertyPath; time?: number; keyIndex?: number; all?: boolean; dryRun: boolean },
  ) => {
    const { comp, layer } = target(args, true);
    const prop = resolvePropertyPath(layer, args.path, `layer "${layer.name}"`);
    const numKeys: number = safeGet(() => prop.numKeys, 0);
    const modes = [args.time !== undefined, args.keyIndex !== undefined, args.all === true].filter(Boolean).length;
    if (modes !== 1) throw new RoxyError(ErrorCode.INVALID_ARGS, "Specify exactly one of `time`, `keyIndex`, `all`");

    let indices: number[];
    if (args.all) indices = Array.from({ length: numKeys }, (_, i) => i + 1);
    else if (args.keyIndex !== undefined) indices = [args.keyIndex];
    else {
      if (numKeys === 0) indices = [];
      else {
        const idx: number = prop.nearestKeyIndex(args.time);
        const halfFrame = comp.frameDuration / 2;
        indices = Math.abs(prop.keyTime(idx) - (args.time as number)) <= halfFrame + 1e-9 ? [idx] : [];
      }
    }
    if (indices.length === 0 || indices.some((i) => i < 1 || i > numKeys)) {
      throw new RoxyError(ErrorCode.NOT_FOUND, `No matching keyframe on "${prop.name}"`, {
        details: { keyTimes: Array.from({ length: Math.min(numKeys, 100) }, (_, i) => safeGet(() => prop.keyTime(i + 1), null)) },
      });
    }
    const removed = indices.map((i) => ({ keyIndex: i, time: prop.keyTime(i), value: toJsonValue(safeGet(() => prop.keyValue(i), null)) }));
    if (args.dryRun) return { dryRun: true, wouldRemove: removed };
    // Remove from the highest index down so earlier indices stay valid.
    for (const i of [...indices].sort((a, b) => b - a)) aeCall(`removeKey(${i})`, () => prop.removeKey(i));
    return { property: { name: prop.name, matchName: prop.matchName }, removed, numKeys: safeGet(() => prop.numKeys, 0) };
  },
};

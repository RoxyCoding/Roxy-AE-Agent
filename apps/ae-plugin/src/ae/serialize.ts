import { safeGet, type AE } from "./host.js";
import { readMetadata } from "./metadata.js";
import { layerType } from "./resolve.js";
import { MN, TRANSFORM_KEYS, toJsonValue } from "./properties.js";

export function compSummary(comp: AE) {
  return {
    id: comp.id as number,
    name: comp.name as string,
    width: safeGet(() => comp.width, 0) as number,
    height: safeGet(() => comp.height, 0) as number,
    fps: safeGet(() => comp.frameRate, 0) as number,
    duration: safeGet(() => comp.duration, 0) as number,
    numLayers: safeGet(() => comp.numLayers, 0) as number,
    roxy: readMetadata(comp),
  };
}

export function compDetails(comp: AE) {
  return {
    ...compSummary(comp),
    pixelAspect: safeGet(() => comp.pixelAspect, undefined),
    bgColor: safeGet(() => comp.bgColor, undefined),
    time: safeGet(() => comp.time, undefined),
    workAreaStart: safeGet(() => comp.workAreaStart, undefined),
    workAreaDuration: safeGet(() => comp.workAreaDuration, undefined),
  };
}

export function layerSummary(layer: AE) {
  const parent = safeGet(() => layer.parent, null);
  const roxy = readMetadata(layer);
  const s: Record<string, unknown> = {
    id: layer.id,
    index: layer.index,
    name: layer.name,
    type: layerType(layer),
    enabled: safeGet(() => layer.enabled, true),
    inPoint: safeGet(() => layer.inPoint, 0),
    outPoint: safeGet(() => layer.outPoint, 0),
  };
  if (parent) s.parentId = parent.id;
  if (safeGet(() => layer.locked, false)) s.locked = true;
  if (safeGet(() => layer.threeDLayer, false)) s.threeD = true;
  if (roxy) s.roxy = roxy;
  return s;
}

export function transformValues(layer: AE, time?: number): Record<string, unknown> {
  const group = safeGet(() => layer.property(MN.transform), null);
  const out: Record<string, unknown> = {};
  if (!group) return out;
  for (const key of TRANSFORM_KEYS) {
    const p = safeGet(() => group.property(MN[key]), null);
    if (!p) continue;
    const v = time !== undefined ? safeGet(() => p.valueAtTime(time, false), undefined) : safeGet(() => p.value, undefined);
    if (v === undefined) continue;
    // Skip 3D-only properties on 2D layers to keep the payload small.
    if ((key === "orientation" || key === "xRotation" || key === "yRotation") && !safeGet(() => layer.threeDLayer, false)) continue;
    out[key] = toJsonValue(v);
    const numKeys = safeGet(() => p.numKeys, 0);
    if (numKeys > 0) out[`${key}Keys`] = numKeys;
  }
  return out;
}

export function effectsOnLayer(layer: AE): Array<{ index: number; name: string; matchName: string; enabled: boolean }> {
  const parade = safeGet(() => layer.property(MN.effects), null);
  if (!parade) return [];
  const n: number = safeGet(() => parade.numProperties, 0);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const fx = safeGet(() => parade.property(i), null);
    if (fx) out.push({ index: i, name: fx.name, matchName: fx.matchName, enabled: safeGet(() => fx.enabled, true) });
  }
  return out;
}

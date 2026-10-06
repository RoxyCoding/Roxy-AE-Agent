import { ErrorCode, RoxyError, type DiagnosticsSnapshot, type DiagLayer } from "@roxy/ae-protocol";
import { aeCall, getApp, getProject, hostInfo, safeGet, type AE } from "../ae/host.js";
import { activeComp, allComps, allLayers, compRef, isComp, layerType, resolveComp, resolveLayer } from "../ae/resolve.js";
import { compDetails, compSummary, layerSummary } from "../ae/serialize.js";
import { readMetadata, writeMetadata, assertNotLocked } from "../ae/metadata.js";
import { MN } from "../ae/properties.js";
import type { Handler } from "./context.js";

function projectName(project: AE): { name: string; path: string | null } {
  const path: string | null = safeGet(() => project.file, null) || null;
  if (!path) return { name: "Untitled Project", path: null };
  const base = path.split(/[\\/]/).pop() ?? path;
  return { name: base.replace(/\.aep$/i, ""), path };
}

export const projectHandlers: Record<string, Handler> = {
  "system.ping": () => ({ pong: true, host: hostInfo(), time: Date.now() }),

  "project.getState": (args: { detail: "summary" | "detailed"; comp?: unknown; compLimit: number }) => {
    const project = getProject();
    const comps = allComps();
    const active = activeComp();
    const state: Record<string, unknown> = {
      project: {
        ...projectName(project),
        dirty: safeGet(() => project.dirty, undefined),
        numItems: safeGet(() => project.numItems, 0),
      },
      activeComp: active ? compRef(active) : null,
      compCount: comps.length,
      comps: comps.slice(0, args.compLimit).map((c) =>
        args.detail === "detailed" ? compSummary(c) : { id: c.id, name: c.name, numLayers: safeGet(() => c.numLayers, 0) },
      ),
      errors: [] as string[],
    };
    if (comps.length > args.compLimit) state.compsTruncated = true;
    if (args.detail === "detailed") {
      const focus = args.comp !== undefined ? resolveComp(args.comp as never) : active;
      if (focus) {
        state.focusComp = { ...compDetails(focus), layers: allLayers(focus).map(layerSummary) };
      }
      const footageMissing = countMissingFootage(project);
      if (footageMissing > 0) (state.errors as string[]).push(`${footageMissing} footage item(s) are missing`);
    }
    return state;
  },

  "project.save": (args: { path?: string }) => {
    const project = getProject();
    const current: string | null = safeGet(() => project.file, null) || null;
    if (!args.path && !current) {
      throw new RoxyError(ErrorCode.INVALID_ARGS, "Project has never been saved; provide `path` (absolute .aep path)", {
        hint: "Saving without a path would open a blocking Save dialog in After Effects.",
      });
    }
    const ok = aeCall("project.save", () => (args.path ? project.save(args.path) : project.save()));
    return { saved: ok !== false, path: safeGet(() => project.file, args.path ?? current) };
  },

  "project.collectDiagnostics": (args: { comp?: unknown; maxLayersPerComp: number }): DiagnosticsSnapshot => {
    const project = getProject();
    const comps = args.comp !== undefined ? [resolveComp(args.comp as never)] : allComps();
    const snapshot: DiagnosticsSnapshot = { project: projectName(project), comps: [], footage: [], truncatedComps: [] };
    const effects = safeGet<Array<{ matchName: string }> | null>(() => getApp().effects, null);
    if (Array.isArray(effects)) snapshot.installedEffects = effects.map((e) => e.matchName);
    for (const comp of comps) {
      const layers = allLayers(comp);
      if (layers.length > args.maxLayersPerComp) snapshot.truncatedComps.push(comp.id);
      snapshot.comps.push({
        id: comp.id,
        name: comp.name,
        width: comp.width,
        height: comp.height,
        duration: comp.duration,
        fps: comp.frameRate,
        roxy: readMetadata(comp),
        layers: layers.slice(0, args.maxLayersPerComp).map(diagLayer),
      });
    }
    const n: number = project.numItems;
    for (let i = 1; i <= n; i++) {
      const item = safeGet(() => project.item(i), null);
      if (!item || isComp(item)) continue;
      const missing = safeGet(() => item.footageMissing, undefined);
      if (missing === undefined) continue; // folders
      snapshot.footage.push({ id: item.id, name: item.name, missing: !!missing });
    }
    return snapshot;
  },

  "metadata.get": (args: { comp?: unknown; layer?: unknown }) => {
    const comp = resolveComp(args.comp as never);
    if (args.layer === undefined) return { comp: compRef(comp), metadata: readMetadata(comp) };
    const layer = resolveLayer(comp, args.layer as never);
    return { comp: compRef(comp), layer: { id: layer.id, name: layer.name }, metadata: readMetadata(layer) };
  },

  "metadata.set": (args: { comp?: unknown; layer?: unknown; metadata: Record<string, unknown> }, ctx) => {
    const comp = resolveComp(args.comp as never);
    const target = args.layer === undefined ? comp : resolveLayer(comp, args.layer as never);
    // Only a lock *raise* is allowed on a locked element.
    const raisingLockOnly = Object.keys(args.metadata).every((k) => k === "lockedForAI") && args.metadata.lockedForAI === true;
    if (!raisingLockOnly) assertNotLocked(target, `"${target.name}"`);
    const merged = writeMetadata(target, args.metadata, ctx.warn);
    return { target: { id: target.id, name: target.name }, metadata: merged };
  },
};

function countMissingFootage(project: AE): number {
  let missing = 0;
  const n: number = project.numItems;
  for (let i = 1; i <= n; i++) {
    const item = safeGet(() => project.item(i), null);
    if (item && safeGet(() => item.footageMissing, false)) missing++;
  }
  return missing;
}

function diagLayer(layer: AE): DiagLayer {
  const type = layerType(layer);
  const transform = safeGet(() => layer.property(MN.transform), null);
  const pos = transform ? safeGet(() => transform.property(MN.position).valueAtTime(0, false), null) : null;
  const rect =
    type === "text" || type === "shape" ? safeGet(() => layer.sourceRectAtTime(0, false), null) : null;
  const parent = safeGet(() => layer.parent, null);
  return {
    id: layer.id,
    index: layer.index,
    name: layer.name,
    type,
    enabled: safeGet(() => layer.enabled, true),
    threeD: safeGet(() => layer.threeDLayer, false),
    inPoint: safeGet(() => layer.inPoint, 0),
    outPoint: safeGet(() => layer.outPoint, 0),
    parentId: parent ? parent.id : null,
    position: Array.isArray(pos) ? pos : null,
    sourceRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
    roxy: readMetadata(layer),
    expressionErrors: collectExpressionErrors(layer),
    effects: effectList(layer),
  };
}

function effectList(layer: AE): Array<{ name: string; matchName: string }> {
  const parade = safeGet(() => layer.property(MN.effects), null);
  const out: Array<{ name: string; matchName: string }> = [];
  const n: number = parade ? safeGet(() => parade.numProperties, 0) : 0;
  for (let i = 1; i <= n; i++) {
    const fx = safeGet(() => parade.property(i), null);
    if (fx) out.push({ name: fx.name, matchName: fx.matchName });
  }
  return out;
}

/** Scan transform + effect properties (bounded) for expression errors. */
function collectExpressionErrors(layer: AE): Array<{ path: string; error: string }> {
  const errors: Array<{ path: string; error: string }> = [];
  const visit = (group: AE, path: string, depth: number) => {
    if (depth > 4 || errors.length >= 20) return;
    const n: number = safeGet(() => group.numProperties, 0);
    for (let i = 1; i <= n; i++) {
      const p = safeGet(() => group.property(i), null);
      if (!p) continue;
      const name = `${path}/${safeGet(() => p.name, String(i))}`;
      if (typeof safeGet(() => p.numProperties, undefined) === "number") visit(p, name, depth + 1);
      else {
        const err = safeGet(() => (p.expressionEnabled ? p.expressionError : ""), "");
        if (err) errors.push({ path: name, error: err });
      }
    }
  };
  for (const mn of [MN.transform, MN.effects]) {
    const g = safeGet(() => layer.property(mn), null);
    if (g) visit(g, safeGet(() => g.name, mn), 0);
  }
  return errors;
}


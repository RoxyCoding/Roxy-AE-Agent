/** Phase 2 commands: footage import, layer creation/attributes/order, generic group add/remove, project open, render. */
import { ErrorCode, RoxyError, type PropertyPath } from "@roxy/ae-protocol";
import { aeCall, getApp, getProject, hostClass, requireEnumValue, safeGet, type AE } from "../ae/host.js";
import { compRef, itemSummary, resolveComp, resolveItem, resolveLayer } from "../ae/resolve.js";
import { assertNotLocked, writeMetadata } from "../ae/metadata.js";
import { describeProperty, isGroup, resolvePropertyPath } from "../ae/properties.js";
import { layerSummary } from "../ae/serialize.js";
import { target, type Handler } from "./context.js";

type Sel = string | number | Record<string, unknown>;

function lockedComp(sel: unknown): AE {
  const comp = resolveComp(sel as never);
  assertNotLocked(comp, `Composition "${comp.name}"`);
  return comp;
}

/** Find a template by exact name, else by case-insensitive substring. */
function pickTemplate(templates: string[], wanted: string): string {
  const exact = templates.find((t) => t === wanted);
  if (exact) return exact;
  const sub = templates.filter((t) => t.toLowerCase().includes(wanted.toLowerCase()));
  if (sub.length === 0) throw new RoxyError(ErrorCode.NOT_FOUND, `No output-module template matches "${wanted}"`, { details: { templates } });
  return sub[0];
}

export const structureHandlers: Record<string, Handler> = {
  "footage.import": (args: { path: string; name?: string }) => {
    const project = getProject();
    const ImportOptions = hostClass("ImportOptions");
    const io = new ImportOptions();
    io.file = args.path;
    const item = aeCall(`importFile("${args.path}")`, () => project.importFile(io));
    if (args.name) item.name = args.name;
    return { item: itemSummary(item) };
  },

  "layer.addItem": (args: { comp?: unknown; item: Sel; startTime?: number; name?: string; roxy?: Record<string, unknown> }, ctx) => {
    const comp = lockedComp(args.comp);
    const item = resolveItem(args.item as never);
    if (item.id === comp.id) throw new RoxyError(ErrorCode.INVALID_ARGS, "A composition cannot contain itself");
    const layer = aeCall("layers.add", () => comp.layers.add(item));
    if (args.startTime !== undefined) layer.startTime = args.startTime;
    if (args.name) layer.name = args.name;
    if (args.roxy) writeMetadata(layer, args.roxy, ctx.warn);
    return { comp: compRef(comp), item: itemSummary(item), layer: layerSummary(layer) };
  },

  "layer.create": (
    args: { comp?: unknown; kind: string; name?: string; color?: number[]; width?: number; height?: number; startTime?: number; roxy?: Record<string, unknown> },
    ctx,
  ) => {
    const comp = lockedComp(args.comp);
    let layer: AE;
    if (args.kind === "null") layer = aeCall("addNull", () => comp.layers.addNull());
    else if (args.kind === "shape") layer = aeCall("addShape", () => comp.layers.addShape());
    else {
      const name = args.name ?? (args.kind === "adjustment" ? "Adjustment Layer" : "Solid");
      layer = aeCall("addSolid", () =>
        comp.layers.addSolid(args.color ?? [0, 0, 0], name, args.width ?? comp.width, args.height ?? comp.height, comp.pixelAspect ?? 1),
      );
      if (args.kind === "adjustment") layer.adjustmentLayer = true;
    }
    if (args.name) layer.name = args.name;
    if (args.startTime !== undefined) layer.startTime = args.startTime;
    writeMetadata(layer, { managedBy: "roxy", ...(args.roxy ?? {}) }, ctx.warn);
    return { comp: compRef(comp), layer: layerSummary(layer) };
  },

  "layer.set": (args: { comp?: unknown; layer: unknown; attributes: Record<string, unknown> }) => {
    const { comp, layer } = target(args, true);
    const a = args.attributes;
    const set = (key: string, apply: () => void) => aeCall(`set ${key}`, apply);
    if (a.name !== undefined) set("name", () => (layer.name = a.name));
    if (a.startTime !== undefined) set("startTime", () => (layer.startTime = a.startTime));
    if (a.inPoint !== undefined) set("inPoint", () => (layer.inPoint = a.inPoint));
    if (a.outPoint !== undefined) set("outPoint", () => (layer.outPoint = a.outPoint));
    if (a.stretch !== undefined) set("stretch", () => (layer.stretch = a.stretch));
    if (a.parent !== undefined) {
      if (a.parent === null) set("parent", () => (layer.parent = null));
      else {
        const parent = resolveLayer(comp, a.parent as never);
        if (parent.id === layer.id) throw new RoxyError(ErrorCode.INVALID_ARGS, "A layer cannot be its own parent");
        set("parent", () => (layer.parent = parent));
      }
    }
    for (const key of ["enabled", "motionBlur", "adjustmentLayer", "shy", "solo", "label"] as const) {
      if (a[key] !== undefined) set(key, () => (layer[key] = a[key]));
    }
    if (a.threeD !== undefined) set("threeDLayer", () => (layer.threeDLayer = a.threeD));
    if (a.blendingMode !== undefined) {
      const mode = requireEnumValue("BlendingMode", String(a.blendingMode));
      set("blendingMode", () => (layer.blendingMode = mode));
    }
    return { layer: layerSummary(layer) };
  },

  "layer.reorder": (args: { comp?: unknown; layer: unknown; to: "top" | "bottom" | { above?: Sel; below?: Sel } }) => {
    const { comp, layer } = target(args, true);
    const to = args.to;
    if (to === "top") aeCall("moveToBeginning", () => layer.moveToBeginning());
    else if (to === "bottom") aeCall("moveToEnd", () => layer.moveToEnd());
    else {
      const other = resolveLayer(comp, (to.above ?? to.below) as never);
      if (other.id === layer.id) throw new RoxyError(ErrorCode.INVALID_ARGS, "Cannot move a layer relative to itself");
      if (to.above !== undefined) aeCall("moveBefore", () => layer.moveBefore(other));
      else aeCall("moveAfter", () => layer.moveAfter(other));
    }
    return { layer: layerSummary(layer) };
  },

  "property.addGroup": (args: { comp?: unknown; layer: unknown; path: PropertyPath; matchName: string; name?: string; reuseExisting: boolean }) => {
    const { layer } = target(args, true);
    const parent = resolvePropertyPath(layer, args.path, `layer "${layer.name}"`);
    if (!isGroup(parent)) throw new RoxyError(ErrorCode.INVALID_ARGS, `"${parent.name}" is not a property group`);
    if (args.reuseExisting) {
      const n: number = safeGet(() => parent.numProperties, 0);
      for (let i = 1; i <= n; i++) {
        const c = safeGet(() => parent.property(i), null);
        if (c && c.matchName === args.matchName) return { index: i, reused: true, property: describeProperty(c, { depth: 1, index: i }) };
      }
    }
    if (!safeGet(() => parent.canAddProperty(args.matchName), false)) {
      throw new RoxyError(ErrorCode.INVALID_ARGS, `"${args.matchName}" cannot be added under "${parent.name}"`, {
        hint: "Check the parent path and matchName (property.get on the parent shows existing children).",
      });
    }
    const added = aeCall(`addProperty("${args.matchName}")`, () => parent.addProperty(args.matchName));
    if (args.name) aeCall("rename", () => (added.name = args.name));
    const index: number = safeGet(() => added.propertyIndex, safeGet(() => parent.numProperties, 0));
    return { index, reused: false, property: describeProperty(added, { depth: 1, index }) };
  },

  "property.remove": (args: { comp?: unknown; layer: unknown; path: PropertyPath; dryRun: boolean }) => {
    const { layer } = target(args, true);
    const prop = resolvePropertyPath(layer, args.path, `layer "${layer.name}"`);
    const snapshot = describeProperty(prop, { depth: 1 });
    if (args.dryRun) return { dryRun: true, wouldRemove: snapshot };
    aeCall(`remove "${prop.name}"`, () => prop.remove());
    return { removed: snapshot };
  },

  "property.setAttributes": (args: { comp?: unknown; layer: unknown; path: PropertyPath; attributes: Record<string, unknown> }) => {
    const { layer } = target(args, true);
    const prop = resolvePropertyPath(layer, args.path, `layer "${layer.name}"`);
    const a = args.attributes;
    if (a.name !== undefined) aeCall("rename", () => (prop.name = a.name));
    if (a.enabled !== undefined) aeCall("set enabled", () => (prop.enabled = a.enabled));
    if (a.maskMode !== undefined) {
      const mode = requireEnumValue("MaskMode", String(a.maskMode));
      aeCall("set maskMode", () => (prop.maskMode = mode));
    }
    if (a.inverted !== undefined) aeCall("set inverted", () => (prop.inverted = a.inverted));
    return { property: describeProperty(prop, { depth: 0 }) };
  },

  "project.open": (args: { path: string; discardChanges: boolean }) => {
    const app = getApp();
    const current = safeGet(() => app.project, null);
    if (current && safeGet(() => current.dirty, false)) {
      if (!args.discardChanges) {
        throw new RoxyError(ErrorCode.CONFLICT, "The current project has unsaved changes", {
          hint: "Save it (project.save / checkpoint) first, or pass discardChanges=true.",
        });
      }
      const close = requireEnumValue("CloseOptions", "DO_NOT_SAVE_CHANGES");
      aeCall("project.close", () => current.close(close));
    }
    const project = aeCall(`open("${args.path}")`, () => app.open(args.path));
    return { opened: safeGet(() => project.file, args.path) };
  },

  "render.comp": (args: { comp?: unknown; outputPath: string; template?: string; startTime?: number; duration?: number }) => {
    const comp = resolveComp(args.comp as never);
    const rq = getProject().renderQueue;
    if (safeGet(() => rq.rendering, false)) throw new RoxyError(ErrorCode.CONFLICT, "The Render Queue is already rendering");
    const paused: AE[] = [];
    for (let i = 1; i <= rq.numItems; i++) {
      const it = rq.item(i);
      if (safeGet(() => it.render, false)) {
        try {
          it.render = false;
          paused.push(it);
        } catch {
          /* finished items cannot be changed */
        }
      }
    }
    let rqi: AE = null;
    const started = Date.now();
    try {
      rqi = aeCall("renderQueue.items.add", () => rq.items.add(comp));
      if (args.startTime !== undefined) rqi.timeSpanStart = args.startTime;
      if (args.duration !== undefined) rqi.timeSpanDuration = args.duration;
      let om = rqi.outputModule(1);
      let template: string | null = null;
      if (args.template) {
        template = pickTemplate(safeGet(() => om.templates, []), args.template);
        aeCall("applyTemplate", () => om.applyTemplate(template));
        om = rqi.outputModule(1); // OM is invalidated after settings change
      }
      aeCall("set output file", () => (om.file = args.outputPath));
      aeCall("render", () => rq.render());
      return {
        comp: compRef(comp),
        outputPath: safeGet(() => String(om.file), args.outputPath),
        template,
        elapsedMs: Date.now() - started,
        lastError: safeGet(() => rq.lastError, "") || undefined,
      };
    } finally {
      if (rqi) {
        try {
          rqi.remove();
        } catch {
          /* ignore */
        }
      }
      for (const it of paused) {
        try {
          it.render = true;
        } catch {
          /* ignore */
        }
      }
    }
  },
};

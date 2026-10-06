import { ErrorCode, RoxyError } from "@roxy/ae-protocol";
import { aeCall, enumValue, safeGet } from "../ae/host.js";
import { allLayers, layerType, resolveComp } from "../ae/resolve.js";
import { effectsOnLayer, layerSummary, transformValues } from "../ae/serialize.js";
import { assertNotLocked, readMetadata, replaceMetadata, writeMetadata } from "../ae/metadata.js";
import { MN } from "../ae/properties.js";
import { target, type Handler } from "./context.js";

const JUSTIFY: Record<string, string> = { left: "LEFT_JUSTIFY", center: "CENTER_JUSTIFY", right: "RIGHT_JUSTIFY" };

interface TextCreateArgs {
  comp?: unknown;
  text: string;
  name?: string;
  position?: number[];
  fontSize?: number;
  font?: string;
  fillColor?: number[];
  justification: "left" | "center" | "right";
  centerAnchor: boolean;
  roxy?: Record<string, unknown>;
}

export const layerHandlers: Record<string, Handler> = {
  "layer.list": (args: { comp?: unknown; type?: string; limit: number }) => {
    const comp = resolveComp(args.comp as never);
    const layers = allLayers(comp).filter((l) => !args.type || layerType(l) === args.type);
    return {
      comp: { id: comp.id, name: comp.name },
      total: layers.length,
      layers: layers.slice(0, args.limit).map(layerSummary),
    };
  },

  "layer.get": (args) => {
    const { comp, layer } = target(args, false);
    return {
      comp: { id: comp.id, name: comp.name },
      layer: layerSummary(layer),
      transform: transformValues(layer),
      effects: effectsOnLayer(layer),
      comment: safeGet(() => layer.comment, ""),
    };
  },

  "layer.delete": (args: { comp?: unknown; layer: unknown; dryRun: boolean }) => {
    const { comp, layer } = target(args, true);
    // Snapshot BEFORE removing so the response documents what was deleted.
    const snapshot = {
      comp: { id: comp.id, name: comp.name },
      layer: layerSummary(layer),
      transform: transformValues(layer),
      effects: effectsOnLayer(layer),
    };
    if (args.dryRun) return { dryRun: true, wouldDelete: snapshot };
    aeCall(`remove layer "${layer.name}"`, () => layer.remove());
    return { deleted: snapshot };
  },

  "layer.duplicate": (args: { comp?: unknown; layer: unknown; newName?: string; roxyId?: string }, ctx) => {
    const { comp, layer } = target(args, false);
    assertNotLocked(comp, `Composition "${comp.name}"`);
    const dup = aeCall(`duplicate layer "${layer.name}"`, () => layer.duplicate());
    if (args.newName) dup.name = args.newName;
    const meta = readMetadata(dup);
    if (meta) {
      const { roxyId: _drop, lockedForAI: _lock, ...rest } = meta;
      replaceMetadata(dup, { ...rest, ...(args.roxyId ? { roxyId: args.roxyId } : {}) });
      if (meta.roxyId && !args.roxyId) ctx.warn("roxyId was cleared on the duplicate to keep Roxy IDs unique");
    } else if (args.roxyId) {
      writeMetadata(dup, { roxyId: args.roxyId }, ctx.warn);
    }
    return { source: layerSummary(layer), duplicate: layerSummary(dup) };
  },

  "text.create": (args: TextCreateArgs, ctx) => {
    const comp = resolveComp(args.comp as never);
    assertNotLocked(comp, `Composition "${comp.name}"`);
    const layer = aeCall("layers.addText", () => comp.layers.addText(args.text));
    if (args.name) layer.name = args.name;

    // Formatting goes through the Source Text TextDocument (read, modify, write back).
    const sourceText = layer.property(MN.text).property(MN.textDocument);
    const doc = sourceText.value;
    const updates: Record<string, unknown> = {};
    if (args.fontSize !== undefined) updates.fontSize = args.fontSize;
    if (args.font !== undefined) updates.font = args.font;
    if (args.fillColor !== undefined) updates.fillColor = args.fillColor;
    const just = enumValue("ParagraphJustification", JUSTIFY[args.justification], ctx.warn);
    if (just !== undefined) updates.justification = just;
    if (Object.keys(updates).length > 0) {
      Object.assign(doc, updates);
      aeCall("set Source Text", () => sourceText.setValue(doc));
    }

    const transform = layer.property(MN.transform);
    if (args.centerAnchor) {
      const rect = safeGet(() => layer.sourceRectAtTime(0, false), null);
      if (rect) {
        aeCall("set anchorPoint", () =>
          transform.property(MN.anchorPoint).setValue([rect.left + rect.width / 2, rect.top + rect.height / 2]),
        );
      } else {
        ctx.warn("sourceRectAtTime unavailable; anchor point not centered");
      }
    }
    const position = args.position ?? [comp.width / 2, comp.height / 2];
    aeCall("set position", () => transform.property(MN.position).setValue(position));
    writeMetadata(layer, { managedBy: "roxy", ...(args.roxy ?? {}) }, ctx.warn);
    return { comp: { id: comp.id, name: comp.name }, layer: layerSummary(layer), transform: transformValues(layer) };
  },

  "text.setText": (args: { comp?: unknown; layer: unknown; text: string; time?: number }) => {
    const { layer } = target(args, true);
    const sourceText = safeGet(() => layer.property(MN.text).property(MN.textDocument), null);
    if (!sourceText) throw new RoxyError(ErrorCode.INVALID_ARGS, `Layer "${layer.name}" is not a text layer`);
    const doc = sourceText.value;
    doc.text = args.text;
    if (args.time !== undefined) aeCall("Source Text setValueAtTime", () => sourceText.setValueAtTime(args.time, doc));
    else {
      if (safeGet(() => sourceText.numKeys, 0) > 0) {
        throw new RoxyError(ErrorCode.INVALID_ARGS, "Source Text has keyframes; pass `time`");
      }
      aeCall("Source Text setValue", () => sourceText.setValue(doc));
    }
    return { layer: layerSummary(layer), text: args.text };
  },
};

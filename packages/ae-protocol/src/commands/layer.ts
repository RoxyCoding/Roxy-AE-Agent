import * as z from "zod/v4";
import { defineCommand } from "./define.js";
import { compField, layerField, PropertyPath } from "../selectors.js";
import { RoxyMetadata } from "../metadata.js";

const vec = z.array(z.number()).min(2).max(3);
const color = z.array(z.number()).length(3).describe("[r,g,b] floats, 0..1");

export const layerList = defineCommand({
  name: "layer.list",
  description: "List layers of a composition (summary fields only).",
  args: z.object({
    comp: compField,
    type: z.string().optional().describe("Filter by layer type (text, shape, null, ...)"),
    limit: z.number().int().min(1).max(2000).default(300),
  }),
  mutates: false,
});

export const layerGet = defineCommand({
  name: "layer.get",
  description: "Get one layer: summary, transform values, effects list, Roxy metadata.",
  args: z.object({ comp: compField, layer: layerField }),
  mutates: false,
});

export const layerDelete = defineCommand({
  name: "layer.delete",
  description: "Delete a layer. The response contains a snapshot of the deleted layer. dryRun=true only reports what would be deleted.",
  args: z.object({ comp: compField, layer: layerField, dryRun: z.boolean().default(false) }),
  mutates: true,
  destructive: true,
});

export const layerDuplicate = defineCommand({
  name: "layer.duplicate",
  description: "Duplicate a layer. The copy's roxyId is cleared (to avoid duplicate Roxy IDs) unless `roxyId` is given.",
  args: z.object({
    comp: compField,
    layer: layerField,
    newName: z.string().optional(),
    roxyId: z.string().optional(),
  }),
  mutates: true,
});

export const textCreate = defineCommand({
  name: "text.create",
  description:
    "Create a point text layer. By default the text is center-justified, its anchor point is moved to the text bounds center, " +
    "and it is placed at the comp center (or `position`).",
  args: z.object({
    comp: compField,
    text: z.string(),
    name: z.string().optional().describe("Layer name (default: AE uses the text)"),
    position: vec.optional().describe("[x,y] in comp pixels; default comp center"),
    fontSize: z.number().min(0.1).max(1296).optional(),
    font: z.string().optional().describe("PostScript font name"),
    fillColor: color.optional(),
    justification: z.enum(["left", "center", "right"]).default("center"),
    centerAnchor: z.boolean().default(true),
    roxy: RoxyMetadata.optional(),
  }),
  mutates: true,
});

export const textSetText = defineCommand({
  name: "text.setText",
  description: "Replace the source text of a text layer (keeps formatting). With `time`, sets a Source Text keyframe.",
  args: z.object({
    comp: compField,
    layer: layerField,
    text: z.string(),
    time: z.number().min(0).optional(),
  }),
  mutates: true,
});

const transformValues = z
  .object({
    anchorPoint: vec.optional(),
    position: vec.optional(),
    scale: z.union([z.number(), vec]).optional().describe("Percent. A number applies to all axes"),
    rotation: z.number().optional().describe("Degrees (Z rotation)"),
    xRotation: z.number().optional(),
    yRotation: z.number().optional(),
    orientation: z.array(z.number()).length(3).optional(),
    opacity: z.number().min(0).max(100).optional(),
  })
  .describe("Transform values to set");

export const transformGet = defineCommand({
  name: "transform.get",
  description: "Get transform values (anchorPoint, position, scale, rotation, opacity, ...) at `time` (default: comp current time).",
  args: z.object({ comp: compField, layer: layerField, time: z.number().min(0).optional() }),
  mutates: false,
});

export const transformSet = defineCommand({
  name: "transform.set",
  description:
    "Set transform values. Without `time` sets static values (fails on keyframed properties); with `time` creates/updates keyframes.",
  args: z.object({
    comp: compField,
    layer: layerField,
    values: transformValues,
    time: z.number().min(0).optional(),
  }),
  mutates: true,
});

export const propertyGet = defineCommand({
  name: "property.get",
  description:
    "Inspect a property or property group by path. For groups returns children (name, matchName, value) up to `depth`. " +
    "Use this to discover matchNames before property.set.",
  args: z.object({
    comp: compField,
    layer: layerField,
    path: PropertyPath.optional().describe("Omit to list the layer's top-level groups"),
    time: z.number().min(0).optional(),
    depth: z.number().int().min(0).max(4).default(1),
  }),
  mutates: false,
});

export const propertySet = defineCommand({
  name: "property.set",
  description:
    "Set a property value (static, or keyframe when `time` is given) and/or its expression. Returns expressionError if the expression fails.",
  args: z.object({
    comp: compField,
    layer: layerField,
    path: PropertyPath,
    value: z.unknown().optional().describe("number, number[] (vectors/colors), string for text, or {text,...} for Source Text"),
    time: z.number().min(0).optional(),
    expression: z.string().optional().describe("Expression source. Empty string removes the expression"),
  }),
  mutates: true,
});

const keyframe = z.object({
  time: z.number().min(0),
  value: z.unknown(),
  interpolation: z.enum(["linear", "bezier", "hold"]).optional(),
});

export const keyframeAdd = defineCommand({
  name: "keyframe.add",
  description:
    "Add (or overwrite) keyframes on one property. Pass several keys in one call. A single number for a vector property (e.g. scale) is expanded to all axes.",
  args: z.object({
    comp: compField,
    layer: layerField,
    path: PropertyPath,
    keys: z.array(keyframe).min(1).max(2000),
  }),
  mutates: true,
});

export const keyframeRemove = defineCommand({
  name: "keyframe.remove",
  description:
    "Remove keyframes from a property: at `time` (within half a frame), by `keyIndex`, or `all`. Response lists removed keys (time, value).",
  args: z.object({
    comp: compField,
    layer: layerField,
    path: PropertyPath,
    time: z.number().min(0).optional(),
    keyIndex: z.number().int().min(1).optional(),
    all: z.boolean().optional(),
    dryRun: z.boolean().default(false),
  }),
  mutates: true,
  destructive: true,
});


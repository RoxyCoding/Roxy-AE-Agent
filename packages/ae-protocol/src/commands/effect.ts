import * as z from "zod/v4";
import { defineCommand } from "./define.js";
import { compField, layerField, EffectSelector, PropertyPath } from "../selectors.js";

export const effectListAvailable = defineCommand({
  name: "effect.listAvailable",
  description:
    "List effects installed in After Effects (Adobe + third-party) with displayName, matchName, category. " +
    "Always filter: the full list has hundreds of entries. Use matchName with effect.add (display names are localized).",
  args: z.object({
    filter: z.string().optional().describe("Case-insensitive substring of displayName or matchName"),
    category: z.string().optional().describe("Case-insensitive substring of category"),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(500).default(50),
  }),
  mutates: false,
});

export const effectListOnLayer = defineCommand({
  name: "effect.listOnLayer",
  description: "List effects applied to a layer (index, instance name, matchName, enabled).",
  args: z.object({ comp: compField, layer: layerField }),
  mutates: false,
});

export const effectAdd = defineCommand({
  name: "effect.add",
  description:
    "Apply an effect to a layer by matchName (preferred) or displayName. Returns the new effect and its top-level properties.",
  args: z.object({
    comp: compField,
    layer: layerField,
    matchName: z.string().optional(),
    displayName: z.string().optional().describe("Used only when matchName is omitted; must match exactly one installed effect"),
    name: z.string().optional().describe("Rename the effect instance"),
  }),
  mutates: true,
});

export const effectGetProperties = defineCommand({
  name: "effect.getProperties",
  description: "Inspect an applied effect's property tree (name, matchName, value, min/max, keyframe count).",
  args: z.object({
    comp: compField,
    layer: layerField,
    effect: EffectSelector,
    depth: z.number().int().min(1).max(4).default(2),
    time: z.number().min(0).optional(),
  }),
  mutates: false,
});

export const effectSetProperty = defineCommand({
  name: "effect.setProperty",
  description:
    "Set one property of an applied effect. `property` is a path inside the effect (matchName, display name or 1-based index). With `time` sets a keyframe.",
  args: z.object({
    comp: compField,
    layer: layerField,
    effect: EffectSelector,
    property: PropertyPath,
    value: z.unknown().optional(),
    time: z.number().min(0).optional(),
    expression: z.string().optional(),
  }),
  mutates: true,
});

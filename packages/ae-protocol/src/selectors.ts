import * as z from "zod/v4";

/**
 * Selectors let the AI address comps/layers by stable attributes instead of remembering IDs.
 * All provided fields are AND-ed. If more than one candidate matches, the plugin returns
 * AMBIGUOUS_SELECTOR with the candidates instead of picking one.
 *
 * Shorthands: a string means `{ name }`, a number means `{ id }`.
 */

export const CompSelectorObject = z
  .object({
    id: z.number().int().optional().describe("AE item id (persistent across sessions)"),
    name: z.string().optional().describe("Exact composition name"),
    roxyId: z.string().optional().describe("Roxy metadata roxyId"),
    active: z.boolean().optional().describe("true = the active composition"),
  })
  .describe("Composition selector");

export const CompSelector = z.union([z.string(), z.number().int(), CompSelectorObject]);
export type CompSelector = z.infer<typeof CompSelector>;

export const LayerType = z.enum(["text", "shape", "camera", "light", "null", "adjustment", "precomp", "footage", "solid", "av", "unknown"]);
export type LayerType = z.infer<typeof LayerType>;

export const LayerSelectorObject = z
  .object({
    id: z.number().int().optional().describe("AE layer id (persistent across sessions)"),
    name: z.string().optional().describe("Exact layer name"),
    index: z.number().int().min(1).optional().describe("1-based layer index (shifts when layers are added; prefer name/id)"),
    type: LayerType.optional(),
    roxyId: z.string().optional(),
    role: z.string().optional().describe("Roxy metadata role, e.g. 'lyrics'"),
    tag: z.string().optional().describe("Roxy metadata tag"),
  })
  .describe("Layer selector");

export const LayerSelector = z.union([z.string(), z.number().int(), LayerSelectorObject]);
export type LayerSelector = z.infer<typeof LayerSelector>;

/** Optional comp selector; omitted = active composition. */
export const compField = CompSelector.optional().describe(
  "Composition selector: name string, id number, or {id|name|roxyId|active}. Omit to use the active composition.",
);
export const layerField = LayerSelector.describe(
  "Layer selector: name string, id number, or {id|name|index|type|roxyId|role|tag}.",
);

/** Normalize shorthand selectors into object form. */
export function normalizeCompSelector(sel: CompSelector | undefined): z.infer<typeof CompSelectorObject> {
  if (sel === undefined) return { active: true };
  if (typeof sel === "string") return { name: sel };
  if (typeof sel === "number") return { id: sel };
  if (Object.keys(sel).length === 0) return { active: true };
  return sel;
}

export function normalizeLayerSelector(sel: LayerSelector): z.infer<typeof LayerSelectorObject> {
  if (typeof sel === "string") return { name: sel };
  if (typeof sel === "number") return { id: sel };
  return sel;
}

/** Property path: array of segments (matchName, display name, or 1-based index) or "a/b/c" string. */
export const PropertyPath = z
  .union([z.string().min(1), z.array(z.union([z.string().min(1), z.number().int().min(1)])).min(1)])
  .describe(
    "Property path from the layer. Array of segments (matchName preferred, display name or 1-based index allowed) or 'a/b/c'. " +
      "Aliases: 'transform', 'effects', 'text', 'masks' and transform children 'anchorPoint','position','scale','rotation','opacity'. " +
      "Example: ['transform','opacity'] or ['effects', 1, 2] (2nd property of the 1st effect). Discover matchNames with property.get / effect.getProperties.",
  );
export type PropertyPath = z.infer<typeof PropertyPath>;

export function normalizePropertyPath(path: PropertyPath): Array<string | number> {
  if (typeof path === "string") return path.split("/").map((s) => s.trim()).filter((s) => s.length > 0);
  return path;
}

/** Effect selector on a layer. */
export const EffectSelector = z
  .union([
    z.string().describe("Effect instance name on the layer"),
    z.number().int().min(1).describe("1-based effect index on the layer"),
    z.object({
      index: z.number().int().min(1).optional(),
      name: z.string().optional().describe("Instance name as shown in the Effect Controls"),
      matchName: z.string().optional(),
    }),
  ])
  .describe("Effect on the layer: instance name, 1-based index, or {index|name|matchName}");
export type EffectSelector = z.infer<typeof EffectSelector>;

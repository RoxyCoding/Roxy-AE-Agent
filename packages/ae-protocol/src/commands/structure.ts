import * as z from "zod/v4";
import { defineCommand } from "./define.js";
import { compField, layerField, LayerSelector, PropertyPath } from "../selectors.js";
import { RoxyMetadata } from "../metadata.js";

/**
 * Phase 2 structural primitives. They are intentionally generic: shapes, masks and text animators
 * are composed from property.addGroup / property.set / property.setAttributes by server-side plan
 * tools (@roxy/ae-tools), so each plugin only implements these small building blocks.
 */

const color = z.array(z.number()).length(3).describe("[r,g,b] floats, 0..1");

export const layerCreate = defineCommand({
  name: "layer.create",
  description:
    "Create a solid, null, adjustment or (empty) shape layer. Shapes/masks are added afterwards (ae_shape_create, ae_mask_add or property.addGroup).",
  args: z.object({
    comp: compField,
    kind: z.enum(["solid", "null", "adjustment", "shape"]),
    name: z.string().optional(),
    color: color.optional().describe("Solid / adjustment color (default black)"),
    width: z.number().int().min(1).max(30000).optional().describe("Solid size; default comp size"),
    height: z.number().int().min(1).max(30000).optional(),
    startTime: z.number().optional(),
    roxy: RoxyMetadata.optional(),
  }),
  mutates: true,
});

export const layerSet = defineCommand({
  name: "layer.set",
  description:
    "Set layer attributes: name, timing (startTime, inPoint, outPoint, stretch), parent (layer selector or null), switches (enabled, threeD, motionBlur, adjustmentLayer, shy, solo), label (0-16), blendingMode (BlendingMode enum name, e.g. ADD, SCREEN).",
  args: z.object({
    comp: compField,
    layer: layerField,
    attributes: z.object({
      name: z.string().optional(),
      startTime: z.number().optional(),
      inPoint: z.number().optional(),
      outPoint: z.number().optional(),
      stretch: z.number().optional().describe("Percent, 100 = normal speed"),
      parent: z.union([LayerSelector, z.null()]).optional().describe("Parent layer selector, or null to unparent"),
      enabled: z.boolean().optional(),
      threeD: z.boolean().optional(),
      motionBlur: z.boolean().optional(),
      adjustmentLayer: z.boolean().optional(),
      shy: z.boolean().optional(),
      solo: z.boolean().optional(),
      label: z.number().int().min(0).max(16).optional(),
      blendingMode: z.string().optional().describe("BlendingMode enum member name, e.g. NORMAL, ADD, SCREEN, MULTIPLY, OVERLAY"),
    }),
  }),
  mutates: true,
});

export const layerReorder = defineCommand({
  name: "layer.reorder",
  description: "Move a layer in the stack: to the top/bottom, or directly above/below another layer.",
  args: z.object({
    comp: compField,
    layer: layerField,
    to: z.union([
      z.enum(["top", "bottom"]),
      z.object({ above: LayerSelector }),
      z.object({ below: LayerSelector }),
    ]),
  }),
  mutates: true,
});

export const propertyAddGroup = defineCommand({
  name: "property.addGroup",
  description:
    "Add a property/group under an indexed group by matchName (e.g. a mask 'ADBE Mask Atom' under 'masks', a shape group 'ADBE Vector Group', " +
    "a text animator 'ADBE Text Animator'). Returns the new child's 1-based index for use in later paths. " +
    "reuseExisting=true returns an existing child with that matchName instead of adding another. " +
    "Do NOT use reuseExisting under 'ADBE Text Animator Properties': AE lists every possible property there as a hidden child that cannot be set until added.",
  args: z.object({
    comp: compField,
    layer: layerField,
    path: PropertyPath.describe("Path of the parent group"),
    matchName: z.string().min(1),
    name: z.string().optional().describe("Rename the new group (indexed groups only)"),
    reuseExisting: z.boolean().default(false),
  }),
  mutates: true,
});

export const propertyRemove = defineCommand({
  name: "property.remove",
  description:
    "Remove a removable property group (effect, mask, shape group, text animator...). The response describes what was removed; dryRun only reports it.",
  args: z.object({ comp: compField, layer: layerField, path: PropertyPath, dryRun: z.boolean().default(false) }),
  mutates: true,
  destructive: true,
});

export const propertySetAttributes = defineCommand({
  name: "property.setAttributes",
  description:
    "Set non-keyframable attributes of a property group: name, enabled, and for masks maskMode (MaskMode name: NONE, ADD, SUBTRACT, INTERSECT, LIGHTEN, DARKEN, DIFFERENCE) and inverted.",
  args: z.object({
    comp: compField,
    layer: layerField,
    path: PropertyPath,
    attributes: z.object({
      name: z.string().optional(),
      enabled: z.boolean().optional(),
      maskMode: z.string().optional(),
      inverted: z.boolean().optional(),
    }),
  }),
  mutates: true,
});

export const projectOpen = defineCommand({
  name: "project.open",
  description:
    "Open an .aep project (used to restore checkpoints). Refuses if the current project has unsaved changes unless discardChanges=true.",
  args: z.object({
    path: z.string().min(1),
    discardChanges: z.boolean().default(false),
  }),
  mutates: false,
  timeoutMs: 120_000,
  batchable: false,
});

export const renderComp = defineCommand({
  name: "render.comp",
  description:
    "Render a composition with the Render Queue (blocks After Effects until done). `template` selects an output-module template by exact name " +
    "or case-insensitive substring (e.g. 'H.264', 'PNG'); omit to use the default. Other queued items are paused and restored.",
  args: z.object({
    comp: compField,
    outputPath: z.string().min(1).describe("Absolute output file path"),
    template: z.string().optional(),
    startTime: z.number().min(0).optional(),
    duration: z.number().positive().optional(),
  }),
  mutates: false,
  timeoutMs: 3_600_000,
  batchable: false,
});

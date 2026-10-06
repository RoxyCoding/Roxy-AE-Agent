/**
 * Phase 2 composed tools: shapes, masks and text animators are built from the generic primitives
 * (layer.create, property.addGroup, property.set, property.setAttributes, keyframe.add).
 * matchNames come from the After Effects scripting guide match-name tables.
 */
import * as z from "zod/v4";
import { compField, layerField } from "@roxy/ae-protocol";
import { definePlanTool, ref, type PlanStep } from "./plan.js";

const MN = {
  root: "ADBE Root Vectors Group",
  group: "ADBE Vector Group",
  contents: "ADBE Vectors Group",
  rect: "ADBE Vector Shape - Rect",
  rectSize: "ADBE Vector Rect Size",
  rectRoundness: "ADBE Vector Rect Roundness",
  ellipse: "ADBE Vector Shape - Ellipse",
  ellipseSize: "ADBE Vector Ellipse Size",
  fill: "ADBE Vector Graphic - Fill",
  fillColor: "ADBE Vector Fill Color",
  stroke: "ADBE Vector Graphic - Stroke",
  strokeColor: "ADBE Vector Stroke Color",
  strokeWidth: "ADBE Vector Stroke Width",
  mask: "ADBE Mask Atom",
  maskShape: "ADBE Mask Shape",
  textProps: "ADBE Text Properties",
  animators: "ADBE Text Animators",
  animator: "ADBE Text Animator",
  selectors: "ADBE Text Selectors",
  selector: "ADBE Text Selector",
  selStart: "ADBE Text Percent Start",
  selEnd: "ADBE Text Percent End",
  animProps: "ADBE Text Animator Properties",
} as const;

const rgb = z.array(z.number().min(0).max(1)).length(3).describe("[r,g,b] 0..1");
const rgba = (c: number[]) => [c[0], c[1], c[2], 1];

/* ------------------------------------------------------------------ shapes */

export const shapeCreate = definePlanTool({
  name: "ae_shape_create",
  description:
    "Create a shape layer with one rectangle or ellipse (fill and/or stroke). Position is the layer position in comp pixels (default comp center).",
  inputSchema: z.object({
    comp: compField,
    name: z.string().optional(),
    type: z.enum(["rect", "ellipse"]),
    size: z.array(z.number().positive()).length(2).describe("[width, height] in pixels"),
    position: z.array(z.number()).length(2).optional(),
    fillColor: rgb.optional(),
    strokeColor: rgb.optional(),
    strokeWidth: z.number().min(0).optional(),
    roundness: z.number().min(0).optional().describe("Rectangle corner roundness (px)"),
    startTime: z.number().optional(),
  }),
  plan: (a) => {
    const layer = { comp: ref("layer.comp.id"), layer: ref("layer.layer.id") };
    const contents = [MN.root, ref("group.index"), MN.contents];
    const steps: PlanStep[] = [
      {
        id: "layer",
        command: "layer.create",
        args: { ...(a.comp !== undefined ? { comp: a.comp } : {}), kind: "shape", ...(a.name ? { name: a.name } : {}), ...(a.startTime !== undefined ? { startTime: a.startTime } : {}) },
      },
      { id: "group", command: "property.addGroup", args: { ...layer, path: [MN.root], matchName: MN.group } },
      { id: "path", command: "property.addGroup", args: { ...layer, path: contents, matchName: a.type === "rect" ? MN.rect : MN.ellipse } },
      {
        id: "size",
        command: "property.set",
        args: { ...layer, path: [...contents, ref("path.index"), a.type === "rect" ? MN.rectSize : MN.ellipseSize], value: a.size },
      },
    ];
    if (a.type === "rect" && a.roundness !== undefined) {
      steps.push({ id: "roundness", command: "property.set", args: { ...layer, path: [...contents, ref("path.index"), MN.rectRoundness], value: a.roundness } });
    }
    // Stroke first, then fill: shape items render bottom-up, so the fill ends up below the stroke.
    if (a.strokeColor || a.strokeWidth !== undefined) {
      steps.push({ id: "stroke", command: "property.addGroup", args: { ...layer, path: contents, matchName: MN.stroke } });
      if (a.strokeColor) steps.push({ id: "strokeColor", command: "property.set", args: { ...layer, path: [...contents, ref("stroke.index"), MN.strokeColor], value: rgba(a.strokeColor) } });
      if (a.strokeWidth !== undefined) steps.push({ id: "strokeWidth", command: "property.set", args: { ...layer, path: [...contents, ref("stroke.index"), MN.strokeWidth], value: a.strokeWidth } });
    }
    if (a.fillColor || !a.strokeColor) {
      steps.push({ id: "fill", command: "property.addGroup", args: { ...layer, path: contents, matchName: MN.fill } });
      steps.push({ id: "fillColor", command: "property.set", args: { ...layer, path: [...contents, ref("fill.index"), MN.fillColor], value: rgba(a.fillColor ?? [1, 1, 1]) } });
    }
    if (a.position) steps.push({ id: "position", command: "transform.set", args: { ...layer, values: { position: a.position } } });
    return { steps, undoGroup: `Roxy: shape ${a.type}`, summary: { type: a.type, size: a.size, layerStep: "layer" } };
  },
});

/* ------------------------------------------------------------------- masks */

const KAPPA = 0.5522847498; // bezier circle approximation

export function rectShape(x: number, y: number, w: number, h: number) {
  return { vertices: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true };
}

export function ellipseShape(cx: number, cy: number, rx: number, ry: number) {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    vertices: [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]],
    inTangents: [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
    outTangents: [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
    closed: true,
  };
}

const point = z.array(z.number()).length(2);

export const maskAdd = definePlanTool({
  name: "ae_mask_add",
  description:
    "Add a mask to a layer: rect {x,y,width,height}, ellipse {cx,cy,rx,ry} or path {vertices,inTangents?,outTangents?,closed?}, all in LAYER pixels. " +
    "mode: MaskMode name (ADD default, SUBTRACT, INTERSECT, NONE...). Animate it later with keyframe.add on ['masks', index, 'ADBE Mask Shape'].",
  inputSchema: z.object({
    comp: compField,
    layer: layerField,
    rect: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).optional(),
    ellipse: z.object({ cx: z.number(), cy: z.number(), rx: z.number().positive(), ry: z.number().positive() }).optional(),
    path: z
      .object({ vertices: z.array(point).min(2), inTangents: z.array(point).optional(), outTangents: z.array(point).optional(), closed: z.boolean().default(true) })
      .optional(),
    mode: z.string().optional(),
    inverted: z.boolean().optional(),
    name: z.string().optional(),
  }),
  plan: (a) => {
    const shapes = [a.rect, a.ellipse, a.path].filter(Boolean);
    if (shapes.length !== 1) throw new Error("Provide exactly one of rect, ellipse, path");
    const shape = a.rect
      ? rectShape(a.rect.x, a.rect.y, a.rect.width, a.rect.height)
      : a.ellipse
        ? ellipseShape(a.ellipse.cx, a.ellipse.cy, a.ellipse.rx, a.ellipse.ry)
        : a.path!;
    const target = { ...(a.comp !== undefined ? { comp: a.comp } : {}), layer: a.layer };
    const steps: PlanStep[] = [
      { id: "mask", command: "property.addGroup", args: { ...target, path: ["masks"], matchName: MN.mask } },
      { id: "shape", command: "property.set", args: { ...target, path: ["masks", ref("mask.index"), MN.maskShape], value: shape } },
    ];
    const attributes: Record<string, unknown> = {};
    if (a.mode) attributes.maskMode = a.mode;
    if (a.inverted !== undefined) attributes.inverted = a.inverted;
    if (a.name) attributes.name = a.name;
    if (Object.keys(attributes).length) {
      steps.push({ id: "attributes", command: "property.setAttributes", args: { ...target, path: ["masks", ref("mask.index")], attributes } });
    }
    return { steps, undoGroup: "Roxy: mask", summary: { vertices: shape.vertices.length, maskIndexStep: "mask" } };
  },
});

/* ---------------------------------------------------------- text animators */

const ANIM_PROPS = {
  opacity: "ADBE Text Opacity",
  position: "ADBE Text Position 3D",
  scale: "ADBE Text Scale 3D",
  rotation: "ADBE Text Rotation",
  tracking: "ADBE Text Tracking Amount",
  blur: "ADBE Text Blur",
} as const;

export const textAnimatorSchema = z.object({
  comp: compField,
  layer: layerField,
  properties: z
    .object({
      opacity: z.number().min(0).max(100).optional(),
      position: z.array(z.number()).min(2).max(3).optional().describe("Offset per character [x,y] or [x,y,z]"),
      scale: z.union([z.number(), z.array(z.number()).min(2).max(3)]).optional(),
      rotation: z.number().optional(),
      tracking: z.number().optional(),
      blur: z.array(z.number()).length(2).optional(),
    })
    .describe("Values applied to the SELECTED characters (e.g. opacity 0 = hidden while selected)"),
  reveal: z
    .object({
      start: z.number().min(0).describe("Comp seconds"),
      duration: z.number().positive(),
      direction: z.enum(["in", "out"]).default("in").describe("in: characters appear left to right; out: disappear left to right"),
      ease: z.enum(["easyEase", "easeIn", "easeOut"]).optional(),
    })
    .optional()
    .describe("Animate the Range Selector Start so the effect sweeps across the characters"),
  name: z.string().optional(),
});

/** Steps that add one text animator (+ Range Selector) with the given properties; used by tools and mv plans. */
export function textAnimatorSteps(a: z.infer<typeof textAnimatorSchema>, prefix = "anim"): PlanStep[] {
  const target = { ...(a.comp !== undefined ? { comp: a.comp } : {}), layer: a.layer };
  const animPath = [MN.textProps, MN.animators, ref(`${prefix}.index`)];
  const steps: PlanStep[] = [
    { id: prefix, command: "property.addGroup", args: { ...target, path: [MN.textProps, MN.animators], matchName: MN.animator, ...(a.name ? { name: a.name } : {}) } },
    // AE 26.5 creates "Range Selector 1" together with the animator; reuseExisting picks it (and adds one if absent).
    { id: `${prefix}Sel`, command: "property.addGroup", args: { ...target, path: [...animPath, MN.selectors], matchName: MN.selector, reuseExisting: true } },
  ];
  for (const [key, mn] of Object.entries(ANIM_PROPS) as Array<[keyof typeof ANIM_PROPS, string]>) {
    const value = a.properties[key];
    if (value === undefined) continue;
    // Never reuse here: AE lists every possible animator property as a HIDDEN child (verified on AE 26.5);
    // reusing would pick the hidden one, which cannot be set. addProperty makes it visible.
    steps.push({ id: `${prefix}_${key}`, command: "property.addGroup", args: { ...target, path: [...animPath, MN.animProps], matchName: mn } });
    steps.push({ id: `${prefix}_${key}_set`, command: "property.set", args: { ...target, path: [...animPath, MN.animProps, mn], value } });
  }
  if (a.reveal) {
    const { start, duration, direction, ease } = a.reveal;
    // The animator values apply to SELECTED characters.
    //  in : Start 0 -> 100  (selection shrinks from the left: characters return to normal left to right)
    //  out: End   0 -> 100  (selection grows from the left: characters take the animator values left to right)
    const selectorProp = direction === "in" ? MN.selStart : MN.selEnd;
    const e = ease ? { ease } : {};
    steps.push({
      id: `${prefix}_reveal`,
      command: "keyframe.add",
      args: {
        ...target,
        path: [...animPath, MN.selectors, ref(`${prefix}Sel.index`), selectorProp],
        keys: [
          { time: start, value: 0, ...e },
          { time: start + duration, value: 100, ...e },
        ],
      },
    });
  }
  return steps;
}

export const textAnimatorAdd = definePlanTool({
  name: "ae_text_addAnimator",
  description:
    "Add a text animator to a text layer (per-character opacity/position/scale/rotation/tracking/blur) with a Range Selector. " +
    "With `reveal`, the selector is animated so the effect sweeps across the characters (typewriter / per-character pop-in).",
  inputSchema: textAnimatorSchema,
  plan: (a) => {
    if (Object.values(a.properties).every((v) => v === undefined)) throw new Error("Set at least one value in `properties`");
    return { steps: textAnimatorSteps(a), undoGroup: "Roxy: text animator", summary: { properties: Object.keys(a.properties), reveal: a.reveal ?? null } };
  },
});

export const COMPOSED_TOOLS = [shapeCreate, maskAdd, textAnimatorAdd];

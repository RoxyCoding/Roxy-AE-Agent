import { ErrorCode, RoxyError, normalizePropertyPath, type PropertyPath } from "@roxy/ae-protocol";
import { aeCall, hostClass, safeGet, type AE } from "./host.js";

/** Stable (unlocalized) matchNames of the standard layer groups and transform properties. */
export const MN = {
  transform: "ADBE Transform Group",
  effects: "ADBE Effect Parade",
  masks: "ADBE Mask Parade",
  text: "ADBE Text Properties",
  textDocument: "ADBE Text Document",
  anchorPoint: "ADBE Anchor Point",
  position: "ADBE Position",
  scale: "ADBE Scale",
  orientation: "ADBE Orientation",
  xRotation: "ADBE Rotate X",
  yRotation: "ADBE Rotate Y",
  rotation: "ADBE Rotate Z",
  opacity: "ADBE Opacity",
} as const;

const TOP_ALIASES: Record<string, string> = {
  transform: MN.transform,
  effects: MN.effects,
  effect: MN.effects,
  masks: MN.masks,
  text: MN.text,
};

export const TRANSFORM_KEYS = ["anchorPoint", "position", "scale", "orientation", "xRotation", "yRotation", "rotation", "opacity"] as const;
export type TransformKey = (typeof TRANSFORM_KEYS)[number];

const TRANSFORM_ALIASES: Record<string, string> = {
  anchorpoint: MN.anchorPoint,
  anchor: MN.anchorPoint,
  position: MN.position,
  scale: MN.scale,
  orientation: MN.orientation,
  xrotation: MN.xRotation,
  yrotation: MN.yRotation,
  rotation: MN.rotation,
  zrotation: MN.rotation,
  opacity: MN.opacity,
};

export function isGroup(p: AE): boolean {
  return typeof safeGet(() => p.numProperties, undefined) === "number";
}

/** Resolve a property path starting at `root` (a layer or a property group). */
export function resolvePropertyPath(root: AE, path: PropertyPath, rootLabel: string): AE {
  const segments = normalizePropertyPath(path);
  let cur: AE = root;
  const walked: string[] = [];
  segments.forEach((rawSeg, i) => {
    let seg: string | number = rawSeg;
    if (typeof seg === "string") {
      const lower = seg.toLowerCase();
      const rootIsLayer = safeGet(() => root.containingComp, undefined) !== undefined;
      if (i === 0 && rootIsLayer && TOP_ALIASES[lower]) seg = TOP_ALIASES[lower];
      else if (safeGet(() => cur.matchName, "") === MN.transform && TRANSFORM_ALIASES[lower.replace(/[\s_-]/g, "")]) {
        seg = TRANSFORM_ALIASES[lower.replace(/[\s_-]/g, "")];
      }
    }
    const next = safeGet(() => cur.property(seg), null);
    if (!next) {
      throw new RoxyError(ErrorCode.NOT_FOUND, `Property "${String(rawSeg)}" not found under ${[rootLabel, ...walked].join(" > ")}`, {
        details: { available: isGroup(cur) ? listChildren(cur, 60) : [] },
        hint: "Use matchName (stable across languages) or a 1-based index from `available`.",
      });
    }
    walked.push(String(safeGet(() => next.name, seg)));
    cur = next;
  });
  return cur;
}

export function listChildren(group: AE, limit: number): Array<{ index: number; name: string; matchName: string }> {
  const out: Array<{ index: number; name: string; matchName: string }> = [];
  const n: number = safeGet(() => group.numProperties, 0);
  for (let i = 1; i <= Math.min(n, limit); i++) {
    const c = safeGet(() => group.property(i), null);
    if (c) out.push({ index: i, name: safeGet(() => c.name, ""), matchName: safeGet(() => c.matchName, "") });
  }
  return out;
}

/** Make a host value JSON-safe. TextDocument -> plain object; unknown objects -> type tag. */
export function toJsonValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(toJsonValue);
  if (typeof v === "object") {
    const o = v as AE;
    if (typeof safeGet(() => o.text, undefined) === "string") {
      return {
        text: o.text,
        font: safeGet(() => o.font, undefined),
        fontSize: safeGet(() => o.fontSize, undefined),
        fillColor: safeGet(() => (o.applyFill ? o.fillColor : undefined), undefined),
        tracking: safeGet(() => o.tracking, undefined),
      };
    }
    if (Array.isArray(safeGet(() => o.vertices, undefined))) return { shape: { closed: o.closed, vertexCount: o.vertices.length } };
    return { type: "object" };
  }
  return String(v);
}

export interface PropertyInfo {
  name: string;
  matchName: string;
  index?: number;
  group?: boolean;
  value?: unknown;
  numKeys?: number;
  expression?: string;
  expressionEnabled?: boolean;
  expressionError?: string;
  min?: number;
  max?: number;
  units?: string;
  options?: string[];
  children?: PropertyInfo[];
  childCount?: number;
}

export function describeProperty(p: AE, opts: { depth: number; time?: number; index?: number }): PropertyInfo {
  const info: PropertyInfo = { name: safeGet(() => p.name, ""), matchName: safeGet(() => p.matchName, "") };
  if (opts.index !== undefined) info.index = opts.index;
  if (isGroup(p)) {
    info.group = true;
    const n: number = safeGet(() => p.numProperties, 0);
    info.childCount = n;
    if (opts.depth > 0) {
      info.children = [];
      for (let i = 1; i <= n; i++) {
        const c = safeGet(() => p.property(i), null);
        if (c) info.children.push(describeProperty(c, { depth: opts.depth - 1, time: opts.time, index: i }));
      }
    }
    return info;
  }
  const raw = opts.time !== undefined ? safeGet(() => p.valueAtTime(opts.time, false), undefined) : safeGet(() => p.value, undefined);
  if (raw !== undefined) info.value = toJsonValue(raw);
  const numKeys = safeGet(() => p.numKeys, 0);
  if (numKeys > 0) info.numKeys = numKeys;
  const expr = safeGet(() => p.expression, "");
  if (expr) {
    info.expression = expr.length > 500 ? expr.slice(0, 500) + "..." : expr;
    info.expressionEnabled = safeGet(() => p.expressionEnabled, false);
    const err = safeGet(() => p.expressionError, "");
    if (err) info.expressionError = err;
  }
  if (safeGet(() => p.hasMin, false)) info.min = safeGet(() => p.minValue, undefined);
  if (safeGet(() => p.hasMax, false)) info.max = safeGet(() => p.maxValue, undefined);
  const units = safeGet(() => p.unitsText, "");
  if (units) info.units = units;
  if (safeGet(() => p.isDropdownEffect, false)) info.options = safeGet(() => p.propertyParameters, undefined);
  return info;
}

/**
 * Adapt an AI-supplied value to the property's current value shape:
 *  - number for a vector property -> repeated on all axes (scale 120 -> [120,120(,120)])
 *  - [x,y] for a 3-axis property -> current z appended
 *  - string / {text} for a Source Text property -> applied onto the current TextDocument
 */
/** {vertices, inTangents?, outTangents?, closed?} -> host Shape (mask path / shape path values). */
export function toHostShape(v: { vertices: number[][]; inTangents?: number[][]; outTangents?: number[][]; closed?: boolean }): AE {
  const Shape = hostClass("Shape");
  const s = new Shape();
  const zeros = v.vertices.map(() => [0, 0]);
  s.vertices = v.vertices;
  s.inTangents = v.inTangents ?? zeros;
  s.outTangents = v.outTangents ?? zeros;
  s.closed = v.closed ?? true;
  return s;
}

function isShapeValue(v: unknown): v is { vertices: number[][] } {
  return !!v && typeof v === "object" && Array.isArray((v as { vertices?: unknown }).vertices);
}

export function coerceValue(prop: AE, value: unknown, warn: (m: string) => void): unknown {
  const current = safeGet(() => prop.value, undefined);
  // Mask Path / shape Path: the current value is a Shape (has vertices).
  if (isShapeValue(value) && current && typeof current === "object" && Array.isArray(safeGet(() => (current as AE).vertices, undefined))) {
    return toHostShape(value as never);
  }
  if (Array.isArray(current)) {
    if (typeof value === "number") return current.map(() => value);
    if (Array.isArray(value) && value.length < current.length) {
      warn(`Value had ${value.length} components, property has ${current.length}; missing components kept from the current value`);
      return [...value, ...current.slice(value.length)];
    }
    return value;
  }
  if (current && typeof current === "object" && typeof safeGet(() => (current as AE).text, undefined) === "string") {
    const doc = current as AE;
    if (typeof value === "string") {
      doc.text = value;
      return doc;
    }
    if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      for (const key of ["text", "font", "fontSize", "fillColor", "strokeColor", "strokeWidth", "tracking", "leading"]) {
        if (v[key] !== undefined) doc[key] = v[key];
      }
      return doc;
    }
  }
  return value;
}

export function setPropertyValue(prop: AE, value: unknown, time: number | undefined, warn: (m: string) => void): void {
  if (isGroup(prop)) throw new RoxyError(ErrorCode.INVALID_ARGS, `"${prop.name}" is a property group, not a property`);
  const v = coerceValue(prop, value, warn);
  if (time !== undefined) {
    aeCall(`setValueAtTime(${time}) on "${prop.name}"`, () => prop.setValueAtTime(time, v));
  } else {
    if (safeGet(() => prop.numKeys, 0) > 0) {
      throw new RoxyError(ErrorCode.INVALID_ARGS, `"${prop.name}" has keyframes; pass \`time\` to set a keyframe value`, {
        hint: "Use keyframe.add / time, or remove keyframes first.",
      });
    }
    aeCall(`setValue on "${prop.name}"`, () => prop.setValue(v));
  }
}

export function setExpression(prop: AE, expression: string): { expressionError?: string } {
  if (!safeGet(() => prop.canSetExpression, false)) {
    throw new RoxyError(ErrorCode.INVALID_ARGS, `"${prop.name}" does not accept expressions`);
  }
  aeCall(`set expression on "${prop.name}"`, () => {
    prop.expression = expression;
  });
  const err = safeGet(() => prop.expressionError, "");
  return err ? { expressionError: err } : {};
}

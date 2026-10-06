import {
  ErrorCode,
  RoxyError,
  normalizeCompSelector,
  normalizeLayerSelector,
  type CompSelector,
  type LayerSelector,
} from "@roxy/ae-protocol";
import { getProject, safeGet, type AE } from "./host.js";
import { readMetadata } from "./metadata.js";

const MAX_CANDIDATES = 20;

/** Duck-typed CompItem check (typeName is localized, so it is not used). */
export function isComp(item: AE): boolean {
  return !!item && typeof safeGet(() => item.numLayers, undefined) === "number" && !!safeGet(() => item.layers, null);
}

export function allComps(): AE[] {
  const project = getProject();
  const n: number = project.numItems;
  const comps: AE[] = [];
  for (let i = 1; i <= n; i++) {
    const item = safeGet(() => project.item(i), null);
    if (item && isComp(item)) comps.push(item);
  }
  return comps;
}

export function activeComp(): AE | null {
  const item = safeGet(() => getProject().activeItem, null);
  return item && isComp(item) ? item : null;
}

export function compRef(comp: AE): { id: number; name: string } {
  return { id: comp.id, name: comp.name };
}

export function resolveComp(selector: CompSelector | undefined): AE {
  const sel = normalizeCompSelector(selector);
  if (sel.active && sel.id === undefined && sel.name === undefined && sel.roxyId === undefined) {
    const comp = activeComp();
    if (!comp) {
      throw new RoxyError(ErrorCode.NOT_FOUND, "No active composition", {
        hint: "Pass `comp` (name or id), or open a composition in the viewer.",
        details: { available: allComps().slice(0, 30).map(compRef) },
      });
    }
    return comp;
  }

  if (sel.id !== undefined && sel.name === undefined && sel.roxyId === undefined) {
    const item = safeGet(() => getProject().itemByID(sel.id), null);
    if (item && isComp(item)) return item;
    throw new RoxyError(ErrorCode.NOT_FOUND, `No composition with id ${sel.id}`, {
      details: { available: allComps().slice(0, 30).map(compRef) },
    });
  }

  const active = sel.active ? activeComp() : null;
  const matches = allComps().filter((c) => {
    if (sel.id !== undefined && c.id !== sel.id) return false;
    if (sel.name !== undefined && c.name !== sel.name) return false;
    if (sel.roxyId !== undefined && readMetadata(c)?.roxyId !== sel.roxyId) return false;
    if (sel.active && (!active || active.id !== c.id)) return false;
    return true;
  });
  return pickOne(matches, "composition", sel, compRef, () => allComps().slice(0, 30).map(compRef));
}

export function layerType(layer: AE): string {
  const mn = safeGet<string>(() => layer.matchName, "");
  switch (mn) {
    case "ADBE Text Layer":
      return "text";
    case "ADBE Vector Layer":
      return "shape";
    case "ADBE Camera Layer":
      return "camera";
    case "ADBE Light Layer":
      return "light";
  }
  if (safeGet(() => layer.nullLayer, false)) return "null";
  if (safeGet(() => layer.adjustmentLayer, false)) return "adjustment";
  const source = safeGet(() => layer.source, null);
  if (source) {
    if (isComp(source)) return "precomp";
    // SolidSource exposes `color`; files expose `file`.
    const main = safeGet(() => source.mainSource, null);
    if (main && safeGet(() => main.color, undefined) !== undefined) return "solid";
    return "footage";
  }
  return mn === "ADBE AV Layer" ? "av" : "unknown";
}

export function layerRef(layer: AE): { id: number; index: number; name: string; type: string } {
  return { id: layer.id, index: layer.index, name: layer.name, type: layerType(layer) };
}

export function allLayers(comp: AE): AE[] {
  const n: number = comp.numLayers;
  const layers: AE[] = [];
  for (let i = 1; i <= n; i++) {
    const l = safeGet(() => comp.layer(i), null);
    if (l) layers.push(l);
  }
  return layers;
}

export function resolveLayer(comp: AE, selector: LayerSelector): AE {
  const sel = normalizeLayerSelector(selector);
  if (Object.keys(sel).length === 0) throw new RoxyError(ErrorCode.INVALID_ARGS, "Empty layer selector");
  const layers = allLayers(comp);
  const matches = layers.filter((l) => {
    if (sel.id !== undefined && l.id !== sel.id) return false;
    if (sel.index !== undefined && l.index !== sel.index) return false;
    if (sel.name !== undefined && l.name !== sel.name) return false;
    if (sel.type !== undefined && layerType(l) !== sel.type) return false;
    if (sel.roxyId !== undefined || sel.role !== undefined || sel.tag !== undefined) {
      const meta = readMetadata(l);
      if (sel.roxyId !== undefined && meta?.roxyId !== sel.roxyId) return false;
      if (sel.role !== undefined && meta?.role !== sel.role) return false;
      if (sel.tag !== undefined && !(meta?.tags ?? []).includes(sel.tag)) return false;
    }
    return true;
  });
  return pickOne(matches, `layer in comp "${comp.name}"`, sel, layerRef, () => layers.slice(0, 30).map(layerRef));
}

function pickOne<T>(
  matches: AE[],
  what: string,
  sel: unknown,
  ref: (x: AE) => T,
  available: () => T[],
): AE {
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new RoxyError(ErrorCode.NOT_FOUND, `No ${what} matches ${JSON.stringify(sel)}`, {
      details: { available: available() },
    });
  }
  throw new RoxyError(ErrorCode.AMBIGUOUS_SELECTOR, `${matches.length} ${what} candidates match ${JSON.stringify(sel)}`, {
    details: { candidates: matches.slice(0, MAX_CANDIDATES).map(ref), total: matches.length },
    hint: "Retry with a more specific selector (id is always unique).",
  });
}

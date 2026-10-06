import type { DiagComp, DiagLayer, DiagnosticsSnapshot } from "@roxy/ae-protocol";

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  rule: string;
  severity: Severity;
  message: string;
  comp?: { id: number; name: string };
  layer?: { id: number; name: string };
  details?: unknown;
}

export interface ValidationRule {
  id: string;
  description: string;
  check(snapshot: DiagnosticsSnapshot): ValidationIssue[];
}

const compRef = (c: DiagComp) => ({ id: c.id, name: c.name });
const layerRef = (l: DiagLayer) => ({ id: l.id, name: l.name });

export const missingAssets: ValidationRule = {
  id: "missing-assets",
  description: "Footage items whose source file cannot be found",
  check: (s) =>
    s.footage
      .filter((f) => f.missing)
      .map((f) => ({ rule: "missing-assets", severity: "error", message: `Footage "${f.name}" (id ${f.id}) is missing` })),
};

export const brokenExpressions: ValidationRule = {
  id: "broken-expressions",
  description: "Expressions reporting an error (transform + effect properties)",
  check: (s) =>
    s.comps.flatMap((c) =>
      c.layers.flatMap((l) =>
        l.expressionErrors.map((e) => ({
          rule: "broken-expressions",
          severity: "error" as const,
          message: `Expression error on ${e.path}: ${e.error}`,
          comp: compRef(c),
          layer: layerRef(l),
        })),
      ),
    ),
};

export const emptyComposition: ValidationRule = {
  id: "empty-composition",
  description: "Compositions without layers",
  check: (s) =>
    s.comps
      .filter((c) => c.layers.length === 0)
      .map((c) => ({ rule: "empty-composition", severity: "warning", message: `Composition "${c.name}" has no layers`, comp: compRef(c) })),
};

export const duplicateRoxyId: ValidationRule = {
  id: "duplicate-roxy-id",
  description: "The same roxyId used by more than one comp/layer",
  check: (s) => {
    const seen = new Map<string, Array<{ comp: DiagComp; layer?: DiagLayer }>>();
    const add = (id: string | undefined, entry: { comp: DiagComp; layer?: DiagLayer }) => {
      if (!id) return;
      seen.set(id, [...(seen.get(id) ?? []), entry]);
    };
    for (const c of s.comps) {
      add(c.roxy?.roxyId, { comp: c });
      for (const l of c.layers) add(l.roxy?.roxyId, { comp: c, layer: l });
    }
    return [...seen.entries()]
      .filter(([, uses]) => uses.length > 1)
      .map(([id, uses]) => ({
        rule: "duplicate-roxy-id",
        severity: "error" as const,
        message: `roxyId "${id}" is used ${uses.length} times`,
        details: uses.map((u) => ({ comp: compRef(u.comp), layer: u.layer ? layerRef(u.layer) : null })),
      }));
  },
};

export const brokenParent: ValidationRule = {
  id: "broken-parent",
  description: "Parent layer missing from the comp, or a parent cycle",
  check: (s) =>
    s.comps.flatMap((c) => {
      const byId = new Map(c.layers.map((l) => [l.id, l]));
      const issues: ValidationIssue[] = [];
      for (const l of c.layers) {
        if (l.parentId === null) continue;
        if (!byId.has(l.parentId)) {
          // Can be a false positive when the comp's layer list was truncated.
          if (!s.truncatedComps.includes(c.id)) {
            issues.push({ rule: "broken-parent", severity: "error", message: `Parent ${l.parentId} not found`, comp: compRef(c), layer: layerRef(l) });
          }
          continue;
        }
        const visited = new Set<number>([l.id]);
        let cur = byId.get(l.parentId);
        while (cur && cur.parentId !== null) {
          if (visited.has(cur.id)) {
            issues.push({ rule: "broken-parent", severity: "error", message: "Parent cycle detected", comp: compRef(c), layer: layerRef(l) });
            break;
          }
          visited.add(cur.id);
          cur = byId.get(cur.parentId);
        }
      }
      return issues;
    }),
};

export const offscreenLayer: ValidationRule = {
  id: "off-screen-layer",
  description: "Heuristic: 2D, unparented, enabled layer whose position at t=0 is far outside the frame",
  check: (s) =>
    s.comps.flatMap((c) =>
      c.layers
        .filter((l) => l.enabled && !l.threeD && l.parentId === null && l.position && !["camera", "light", "null", "adjustment"].includes(l.type))
        .filter((l) => {
          const [x, y] = l.position as number[];
          return x < -c.width * 0.25 || x > c.width * 1.25 || y < -c.height * 0.25 || y > c.height * 1.25;
        })
        .map((l) => ({
          rule: "off-screen-layer",
          severity: "warning" as const,
          message: `Layer position ${JSON.stringify(l.position)} is far outside the ${c.width}x${c.height} frame at t=0`,
          comp: compRef(c),
          layer: layerRef(l),
        })),
    ),
};

export const layerTiming: ValidationRule = {
  id: "layer-timing",
  description: "Layers never visible inside the comp duration",
  check: (s) =>
    s.comps.flatMap((c) =>
      c.layers
        .filter((l) => l.outPoint <= 0 || l.inPoint >= c.duration || l.outPoint <= l.inPoint)
        .map((l) => ({
          rule: "layer-timing",
          severity: "warning" as const,
          message: `Layer is never visible (in ${l.inPoint}s, out ${l.outPoint}s, comp ${c.duration}s)`,
          comp: compRef(c),
          layer: layerRef(l),
        })),
    ),
};

export const missingEffects: ValidationRule = {
  id: "missing-effects",
  description: "Effects applied to layers whose plugin is not installed (matchName absent from app.effects)",
  check: (s) => {
    if (!s.installedEffects || s.installedEffects.length === 0) return [];
    const installed = new Set(s.installedEffects);
    return s.comps.flatMap((c) =>
      c.layers.flatMap((l) =>
        l.effects
          .filter((e) => !installed.has(e.matchName))
          .map((e) => ({
            rule: "missing-effects",
            severity: "error" as const,
            message: `Effect "${e.name}" (${e.matchName}) is not installed`,
            comp: compRef(c),
            layer: layerRef(l),
          })),
      ),
    );
  },
};

export const PHASE1_RULES: ValidationRule[] = [
  missingAssets,
  brokenExpressions,
  emptyComposition,
  duplicateRoxyId,
  brokenParent,
  offscreenLayer,
  layerTiming,
  missingEffects,
];

/** Rules designed but not implemented yet (reported so the AI knows the coverage). */
export const PLANNED_RULES = [
  { id: "invalid-layer-reference", description: "Expressions/track mattes referencing non-existent layers" },
  { id: "render-settings", description: "Render queue / output module misconfiguration" },
  { id: "off-screen-bounds", description: "Exact on-screen test using transformed layer bounds over time" },
];

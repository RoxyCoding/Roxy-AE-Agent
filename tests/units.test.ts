import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  decodeComment,
  encodeComment,
  mergeMetadata,
  normalizeCompSelector,
  normalizePropertyPath,
  resolveRefs,
  type DiagnosticsSnapshot,
} from "@roxy/ae-protocol";
import { buildAeTools } from "@roxy/ae-tools";
import { createLyricAnimation } from "@roxy/mv-tools";
import { hasPngEnd, readPngSize } from "@roxy/preview-engine";
import { validateProject } from "@roxy/project-validator";
import { makePng } from "./fakes/png.js";

describe("protocol", () => {
  it("covers every Phase 1 command", () => {
    const required = [
      "project.getState", "project.save", "comp.create", "comp.get", "comp.list", "layer.list", "layer.get", "layer.delete",
      "layer.duplicate", "text.create", "text.setText", "transform.get", "transform.set", "property.get", "property.set",
      "keyframe.add", "keyframe.remove", "effect.listAvailable", "effect.listOnLayer", "effect.add", "effect.getProperties",
      "effect.setProperty", "preview.renderFrame", "undo.beginGroup", "undo.endGroup", "batch.execute",
    ];
    for (const c of required) expect(COMMANDS[c], c).toBeDefined();
  });

  it("tool names are MCP-safe and unique", () => {
    const names = buildAeTools().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(names).toContain("ae_get_project_state");
    expect(names).toContain("ae_preview_frameAtTime");
  });

  it("metadata round-trips and preserves the user comment", () => {
    const encoded = encodeComment("my note\nline2", { roxyId: "a", role: "lyrics" });
    const d = decodeComment(encoded);
    expect(d.userComment).toBe("my note\nline2");
    expect(d.metadata).toEqual({ roxyId: "a", role: "lyrics" });
    expect(decodeComment("#roxy:{broken").corrupt).toBe(true);
    expect(decodeComment("plain").metadata).toBeNull();
  });

  it("AI can lock but not unlock", () => {
    expect(mergeMetadata({ lockedForAI: true }, { lockedForAI: false })).toEqual({ merged: { lockedForAI: true }, refusedUnlock: true });
    expect(mergeMetadata(null, { lockedForAI: true }).merged.lockedForAI).toBe(true);
  });

  it("resolves batch refs", () => {
    expect(resolveRefs({ comp: { $ref: "a.comp.id" }, x: [1, { $ref: "a.n" }] }, { a: { comp: { id: 7 }, n: 3 } })).toEqual({ comp: 7, x: [1, 3] });
    expect(() => resolveRefs({ $ref: "missing.x" }, {})).toThrow();
  });

  it("normalizes selectors and paths", () => {
    expect(normalizeCompSelector(undefined)).toEqual({ active: true });
    expect(normalizeCompSelector("MASTER")).toEqual({ name: "MASTER" });
    expect(normalizeCompSelector(5)).toEqual({ id: 5 });
    expect(normalizePropertyPath("transform/ opacity")).toEqual(["transform", "opacity"]);
  });
});

describe("preview-engine png", () => {
  it("reads PNG size and detects completeness", () => {
    const png = makePng(32, 18);
    expect(readPngSize(png)).toEqual({ width: 32, height: 18 });
    expect(hasPngEnd(png)).toBe(true);
    expect(hasPngEnd(png.subarray(0, png.length - 4))).toBe(false);
    expect(readPngSize(Buffer.from("not a png at all, definitely"))).toBeNull();
  });
});

describe("project-validator", () => {
  const layer = (over: Record<string, unknown>) => ({
    id: 1, index: 1, name: "L", type: "text", enabled: true, threeD: false, inPoint: 0, outPoint: 5, parentId: null,
    position: [960, 540], sourceRect: null, roxy: null, expressionErrors: [], effects: [], ...over,
  });
  const snapshot: DiagnosticsSnapshot = {
    project: { name: "p", path: null },
    truncatedComps: [],
    footage: [{ id: 9, name: "bg.png", missing: true }],
    comps: [
      { id: 1, name: "EMPTY", width: 1920, height: 1080, duration: 5, fps: 30, roxy: null, layers: [] },
      {
        id: 2, name: "MAIN", width: 1920, height: 1080, duration: 5, fps: 30, roxy: { roxyId: "x" },
        layers: [
          layer({ id: 10, roxy: { roxyId: "x" } }),
          layer({ id: 11, parentId: 99 }),
          layer({ id: 12, position: [5000, 540] }),
          layer({ id: 13, inPoint: 6, outPoint: 8 }),
          layer({ id: 14, expressionErrors: [{ path: "Transform/Opacity", error: "ReferenceError" }] }),
        ],
      },
    ],
  };

  it("detects Phase 1 issue types", () => {
    const report = validateProject(snapshot);
    const rules = new Set(report.issues.map((i) => i.rule));
    for (const r of ["missing-assets", "empty-composition", "duplicate-roxy-id", "broken-parent", "off-screen-layer", "layer-timing", "broken-expressions"]) {
      expect(rules.has(r), r).toBe(true);
    }
    expect(report.ok).toBe(false);
    expect(report.rulesRun).toContain("missing-effects");
  });
});

describe("mv-tools plan", () => {
  it("compiles a lyric line into low-level steps", () => {
    const args = createLyricAnimation.inputSchema.parse({ text: "世界なんて嫌いだ", start: 12.5, duration: 2, entrance: "scale-pop" });
    const plan = createLyricAnimation.plan(args as never);
    expect(plan.steps.map((s) => s.command)).toEqual(["text.create", "keyframe.add", "keyframe.add"]);
    const opacityKeys = plan.steps[1].args.keys as Array<{ time: number; value: number }>;
    expect(opacityKeys[0]).toEqual({ time: 12.5, value: 0 });
    expect(opacityKeys[opacityKeys.length - 1]).toEqual({ time: 14.5, value: 0 });
    for (const step of plan.steps) expect(COMMANDS[step.command]).toBeDefined();
  });

  it("rejects options that are not implemented yet", () => {
    const args = createLyricAnimation.inputSchema.parse({ text: "x", start: 0, duration: 1, reveal: "character", exit: "glitch" });
    expect(() => createLyricAnimation.plan(args as never)).toThrow(/not implemented/);
  });
});

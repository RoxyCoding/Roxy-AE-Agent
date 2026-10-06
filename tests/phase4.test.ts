/**
 * Phase 4: review loop, objective frame checks, render verification, approval-based autofix.
 * Unit tests for the pure parts + end-to-end runs through both plugins (fake AE).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@roxy/shared";
import type { DiagnosticsSnapshot } from "@roxy/ae-protocol";
import { buildAeTools, checkExpectations, parseProbe, proposeFixes, type ToolContext, type ToolOutcome } from "@roxy/ae-tools";
import { analyzeFrame, decodePng, diffFrames, PreviewEngine } from "@roxy/preview-engine";
import { Connection, type PanelExecutor } from "@roxy/plugin-panel";
import { WsBridge } from "../apps/mcp-server/src/bridge/ws-bridge.js";
import { Dispatcher } from "../apps/ae-plugin/src/dispatcher.js";
import { HANDLERS } from "../apps/ae-plugin/src/commands/index.js";
import { UndoManager } from "../apps/ae-plugin/src/undo.js";
import { CepExecutor } from "../apps/ae-cep-plugin/src/cep-executor.js";
import { createCepEvalScript } from "./fakes/cep-runtime.js";
import { fake, installFakeAe, resetFake, type FakeComp, type FakeGroup, type FakeProperty } from "./fakes/fake-ae.js";
import { makePng } from "./fakes/png.js";

/* ---------------------------------------------------------------- unit */

describe("frame analysis", () => {
  const gradient = (x: number, y: number) => [x * 8, y * 8, 128];

  it.each([0, 1, 2] as const)("decodes PNG filter %i exactly", (filter) => {
    const img = decodePng(makePng(16, 12, gradient, filter));
    expect(img).not.toBeNull();
    expect([img!.width, img!.height]).toEqual([16, 12]);
    const px = (x: number, y: number) => Array.from(img!.data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4));
    expect(px(3, 5)).toEqual([24, 40, 128, 255]);
    expect(px(15, 11)).toEqual([120, 88, 128, 255]);
  });

  it("flags flat frames as blank and detects differences", () => {
    const black = decodePng(makePng(32, 18))!;
    const varied = decodePng(makePng(32, 18, gradient))!;
    expect(analyzeFrame(black)).toMatchObject({ blank: true, dark: true });
    expect(analyzeFrame(varied).blank).toBe(false);
    expect(diffFrames(black, black)).toMatchObject({ comparable: true, changedRatio: 0 });
    expect(diffFrames(black, varied).changedRatio).toBeGreaterThan(0.5);
    expect(diffFrames(black, decodePng(makePng(16, 9))!).comparable).toBe(false);
  });
});

describe("render verification (pure)", () => {
  const json = JSON.stringify({
    format: { duration: "2.000000" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001" },
      { codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" },
    ],
  });

  it("parses ffprobe output and checks expectations", () => {
    const p = parseProbe(json, 123456);
    expect(p).toMatchObject({ durationSec: 2, video: { width: 1920, height: 1080, fps: 29.97 }, audio: { channels: 2 } });
    const checks = checkExpectations(p, { durationSec: 2, width: 1920, height: 1080, hasAudio: false, fps: 29.97 });
    expect(Object.fromEntries(checks.map((c) => [c.check, c.pass]))).toEqual({
      duration: true,
      width: true,
      height: true,
      fps: true,
      hasAudio: false,
      minSize: true,
    });
  });
});

describe("autofix proposals (pure)", () => {
  const layer = (over: Record<string, unknown>) => ({
    id: 1, index: 1, name: "L", type: "text", enabled: true, threeD: false, inPoint: 0, outPoint: 5, parentId: null,
    position: [960, 540], sourceRect: null, roxy: null, expressionErrors: [], effects: [], ...over,
  });
  const snapshot: DiagnosticsSnapshot = {
    project: { name: "p", path: null },
    truncatedComps: [],
    footage: [],
    installedEffects: ["ADBE Glo2"],
    comps: [
      {
        id: 5, name: "MAIN", width: 1920, height: 1080, duration: 5, fps: 30, roxy: null,
        layers: [
          layer({ id: 10, name: "A", roxy: { roxyId: "lyric" } }),
          layer({ id: 11, name: "B", roxy: { roxyId: "lyric" } }),
          layer({ id: 12, name: "C", expressionErrors: [{ path: "Transform/Opacity", error: "ReferenceError" }] }),
          layer({ id: 13, name: "D", effects: [{ name: "Glow", matchName: "ADBE Glo2" }, { name: "X", matchName: "VENDOR X" }, { name: "Y", matchName: "VENDOR Y" }] }),
          layer({ id: 14, name: "E", position: [9000, 0] }),
        ],
      },
    ],
  };

  it("proposes mechanical fixes and lists the rest as manual", () => {
    const { proposals, manual } = proposeFixes(snapshot);
    const byRule = (r: string) => proposals.filter((p) => p.rule === r);
    expect(byRule("duplicate-roxy-id")[0].commands[0]).toMatchObject({ command: "metadata.set", args: { layer: 11, metadata: { roxyId: "lyric_2" } } });
    expect(byRule("broken-expressions")[0].commands[0].args).toMatchObject({ layer: 12, path: "Transform/Opacity", expressionEnabled: false });
    // missing effects removed from the highest index down
    expect(byRule("missing-effects").map((p) => (p.commands[0].args.path as unknown[])[1])).toEqual([3, 2]);
    expect(byRule("missing-effects").every((p) => p.destructive)).toBe(true);
    expect(manual.map((m) => m.rule)).toContain("off-screen-layer");
  });
});

/* --------------------------------------------------------- end-to-end */

const PORT = 48700 + Math.floor(Math.random() * 40);
const logger = new Logger({ level: "error", sink: () => {} });
installFakeAe();
const tools = new Map(buildAeTools().map((t) => [t.name, t]));
let bridge: WsBridge;
let conn: Connection;
let ctx: ToolContext;

async function call(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(tool.inputSchema.parse(args), ctx);
}

async function createExecutor(kind: "uxp" | "cep"): Promise<PanelExecutor> {
  if (kind === "uxp") {
    const undo = new UndoManager(() => fake);
    const dispatcher = new Dispatcher(HANDLERS, undo, logger);
    return { commandNames: () => dispatcher.commandNames, hostInfo: () => ({}), handle: (r) => dispatcher.handle(r), onDisconnect: () => undo.closeAll() };
  }
  const executor = new CepExecutor(createCepEvalScript(), logger);
  await executor.init();
  return executor;
}

describe.each(["uxp", "cep"] as const)("Phase 4 via %s plugin (fake AE)", (kind) => {
  const tmp = mkdtempSync(join(tmpdir(), `roxy-p4-${kind}-`));
  const comp = "P4";
  const p4 = () => fake.project.comps.find((c) => c.name === comp) as FakeComp;

  beforeAll(async () => {
    resetFake();
    const port = PORT + (kind === "cep" ? 1 : 0);
    bridge = new WsBridge({ host: "127.0.0.1", port, logger, serverInfo: { name: "t", version: "0" }, retryBindMs: 0 });
    bridge.start();
    ctx = { execute: (c, a, o) => bridge.request(c, a, o), preview: new PreviewEngine({ dir: join(tmp, "previews"), logger }), logger, status: () => bridge.status() };
    const executor = await createExecutor(kind);
    conn = new Connection({
      url: `ws://127.0.0.1:${port}`,
      log: logger,
      buildHello: () => ({ plugin: { name: kind, version: "t" }, host: {}, commands: executor.commandNames() }),
      onRequest: (r) => executor.handle(r),
      onStateChange: () => {},
      onDisconnect: () => executor.onDisconnect(),
    });
    conn.start();
    expect(await bridge.waitForConnection(5000)).toBe(true);
    await call("ae_comp_create", { name: comp, width: 640, height: 360, duration: 4, fps: 30 });
    await call("ae_text_create", { comp, text: "A", name: "A" });
    await call("ae_text_create", { comp, text: "B", name: "B" });
    const aep = join(tmp, "p4.aep");
    writeFileSync(aep, "project");
    fake.project.file = aep; // saved project -> checkpoints available
  });

  afterAll(async () => {
    conn.stop();
    await bridge.stop();
  });

  it("runs a review loop: blank detection, verdicts, iteration limit, rollback", async () => {
    const start = await call("ae_review_start", { comp, goal: "Title visible", criteria: ["title readable"], frameCount: 2, maxIterations: 1, returnImage: true });
    expect(start.ok).toBe(true);
    const d = start.data as { sessionId: string; frames: Array<{ time: number }>; autoIssues: string[] };
    expect(d.frames.map((f) => f.time)).toEqual([1, 3]);
    expect(start.images?.length).toBe(2);
    expect(d.autoIssues.some((i) => i.includes("single flat colour"))).toBe(true); // fake renders black frames

    const capturedTooEarly = await call("ae_review_capture", { sessionId: d.sessionId, returnImage: false });
    expect(capturedTooEarly.error?.code).toBe("CONFLICT");

    const fix = await call("ae_review_record", { sessionId: d.sessionId, verdict: "fix", evaluations: [{ criterion: "title readable", pass: false }], plannedChanges: "make text bigger" });
    expect(fix.ok).toBe(true);
    expect((fix.data as { checkpoint: string | null }).checkpoint).toMatch(/^p4__.*review-.*-it0\.aep$/);

    const again = await call("ae_review_capture", { sessionId: d.sessionId, returnImage: false });
    expect((again.data as { autoIssues: string[] }).autoIssues).toContain("No visible change compared with the previous capture at any sampled time");

    const limit = await call("ae_review_record", { sessionId: d.sessionId, verdict: "fix", evaluations: [{ criterion: "title readable", pass: false }], plannedChanges: "again" });
    expect((limit.data as { status: string }).status).toBe("limit-reached");

    const rollback = await call("ae_review_rollback", { sessionId: d.sessionId, iteration: 0 });
    expect(rollback.ok).toBe(true);
    expect(fake.opened.at(-1)).toBe(fake.project.file);
  });

  it("autofix proposes, then applies only approved fixes", async () => {
    await call("ae_metadata_set", { comp, layer: "A", metadata: { roxyId: "dup" } });
    await call("ae_metadata_set", { comp, layer: "B", metadata: { roxyId: "dup" } });
    const opacity = (p4().layerList.find((l) => l.name === "A")!.property("ADBE Transform Group") as FakeGroup).property("ADBE Opacity") as FakeProperty;
    opacity.expression = "thisComp.layer('nope').opacity";
    opacity.expressionEnabled = true;
    opacity.expressionError = "Layer 'nope' does not exist";

    const proposed = await call("ae_project_autofix", { comp });
    const proposals = (proposed.data as { proposals: Array<{ id: string; rule: string }> }).proposals;
    expect(proposals.map((p) => p.rule).sort()).toEqual(["broken-expressions", "duplicate-roxy-id"]);
    // Nothing applied yet.
    expect(opacity.expressionEnabled).toBe(true);

    const exprFix = proposals.find((p) => p.rule === "broken-expressions")!;
    const applied = await call("ae_project_autofix", { comp, apply: [exprFix.id] });
    expect(applied.ok).toBe(true);
    expect(opacity.expressionEnabled).toBe(false);
    expect(opacity.expression).toContain("nope"); // kept, only disabled
    const after = (applied.data as { validationAfter: { issues: Array<{ rule: string }> } }).validationAfter;
    expect(after.issues.some((i) => i.rule === "duplicate-roxy-id")).toBe(true); // not approved -> still there

    expect((await call("ae_project_autofix", { comp, apply: ["fix-999"] })).error?.code).toBe("NOT_FOUND");
  });

  it("render verify reports a missing file cleanly", async () => {
    const out = await call("ae_render_verify", { path: join(tmp, "none.mp4") });
    expect(out.error?.code).toBe("NOT_FOUND");
  });
});

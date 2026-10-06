/**
 * Phase 2 features end-to-end (minus After Effects), run once per plugin (UXP handlers / CEP ExtendScript):
 * footage import, layer create/set/reorder, shapes, masks, text animators, ease, render, checkpoints,
 * missing-effects validation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@roxy/shared";
import { buildAeTools, type ToolContext, type ToolOutcome } from "@roxy/ae-tools";
import { createLyricAnimation } from "@roxy/mv-tools";
import { PreviewEngine } from "@roxy/preview-engine";
import { Connection, type PanelExecutor } from "@roxy/plugin-panel";
import { WsBridge } from "../apps/mcp-server/src/bridge/ws-bridge.js";
import { Dispatcher } from "../apps/ae-plugin/src/dispatcher.js";
import { HANDLERS } from "../apps/ae-plugin/src/commands/index.js";
import { UndoManager } from "../apps/ae-plugin/src/undo.js";
import { CepExecutor } from "../apps/ae-cep-plugin/src/cep-executor.js";
import { createCepEvalScript } from "./fakes/cep-runtime.js";
import { fake, installFakeAe, resetFake, type FakeComp, type FakeGroup, type FakeProperty } from "./fakes/fake-ae.js";

const PORT = 48600 + Math.floor(Math.random() * 40);
const logger = new Logger({ level: "error", sink: () => {} });
installFakeAe();

const tools = new Map(buildAeTools().map((t) => [t.name, t]));
let bridge: WsBridge;
let conn: Connection;
let ctx: ToolContext;

async function call(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const tool = name === createLyricAnimation.name ? createLyricAnimation : tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(tool.inputSchema.parse(args), ctx);
}

async function createExecutor(kind: "uxp" | "cep"): Promise<PanelExecutor> {
  if (kind === "uxp") {
    const undo = new UndoManager(() => fake);
    const dispatcher = new Dispatcher(HANDLERS, undo, logger);
    return {
      commandNames: () => dispatcher.commandNames,
      hostInfo: () => ({ appName: fake.appName }),
      handle: (req) => dispatcher.handle(req),
      onDisconnect: () => undo.closeAll(),
    };
  }
  const executor = new CepExecutor(createCepEvalScript(), logger);
  await executor.init();
  return executor;
}

const mn = (p: unknown) => (p as FakeGroup | null)?.matchName;

describe.each(["uxp", "cep"] as const)("Phase 2 via %s plugin (fake AE)", (kind) => {
  const comp = "P2";
  const p2 = () => fake.project.comps.find((c) => c.name === comp) as FakeComp;
  const byName = (name: string) => {
    const l = p2().layerList.find((x) => x.name === name);
    if (!l) throw new Error(`layer ${name} missing`);
    return l;
  };
  const tmp = mkdtempSync(join(tmpdir(), `roxy-p2-${kind}-`));

  beforeAll(async () => {
    resetFake();
    const port = PORT + (kind === "cep" ? 1 : 0);
    bridge = new WsBridge({ host: "127.0.0.1", port, logger, serverInfo: { name: "test", version: "0" }, retryBindMs: 0 });
    bridge.start();
    const preview = new PreviewEngine({ dir: join(tmp, "previews"), logger });
    ctx = { execute: (c, a, o) => bridge.request(c, a, o), preview, logger, status: () => bridge.status() };
    const executor = await createExecutor(kind);
    conn = new Connection({
      url: `ws://127.0.0.1:${port}`,
      log: logger,
      buildHello: () => ({ plugin: { name: `roxy-${kind}`, version: "test" }, host: executor.hostInfo(), commands: executor.commandNames() }),
      onRequest: (req) => executor.handle(req),
      onStateChange: () => {},
      onDisconnect: () => executor.onDisconnect(),
    });
    conn.start();
    expect(await bridge.waitForConnection(5000)).toBe(true);
    expect((await call("ae_comp_create", { name: comp, width: 1920, height: 1080, duration: 10, fps: 30 })).ok).toBe(true);
  });

  afterAll(async () => {
    conn.stop();
    await bridge.stop();
  });

  it("imports an mp3 and places it as an audio layer", async () => {
    const mp3 = join(tmp, "コール.mp3");
    writeFileSync(mp3, "fake audio");
    const imp = await call("ae_footage_import", { path: mp3 });
    expect(imp.ok).toBe(true);
    const item = (imp.data as { item: { id: number; name: string; hasAudio: boolean } }).item;
    expect(item.name).toBe("コール.mp3");
    expect(item.hasAudio).toBe(true);
    const add = await call("ae_layer_addItem", { comp, item: item.id, startTime: 0.5, name: "MUSIC" });
    expect(add.ok).toBe(true);
    expect((add.data as { layer: { type: string } }).layer.type).toBe("audio");
    expect(byName("MUSIC").startTime).toBe(0.5);
    expect((await call("ae_footage_import", { path: join(tmp, "missing.mp3") })).ok).toBe(false);
  });

  it("creates solid/null layers, sets attributes and reorders", async () => {
    expect((await call("ae_layer_create", { comp, kind: "solid", name: "BG", color: [0, 0, 0.2] })).ok).toBe(true);
    expect((await call("ae_layer_create", { comp, kind: "null", name: "RIG" })).ok).toBe(true);
    const set = await call("ae_layer_set", { comp, layer: "BG", attributes: { parent: "RIG", blendingMode: "screen", inPoint: 1, label: 3 } });
    expect(set.ok).toBe(true);
    expect(byName("BG").parent?.name).toBe("RIG");
    expect(byName("BG").blendingMode).toBe(5222);
    const bad = await call("ae_layer_set", { comp, layer: "BG", attributes: { blendingMode: "NOPE" } });
    expect(bad.error?.code).toBe("INVALID_ARGS");
    expect(JSON.stringify(bad.error?.details)).toContain("SCREEN");
    expect((await call("ae_layer_reorder", { comp, layer: "BG", to: "bottom" })).ok).toBe(true);
    expect(byName("BG").index).toBe(p2().numLayers);
    expect((await call("ae_layer_reorder", { comp, layer: "BG", to: { above: "RIG" } })).ok).toBe(true);
    expect(byName("BG").index + 1).toBe(byName("RIG").index);
  });

  it("builds a shape layer from generic primitives", async () => {
    const out = await call("ae_shape_create", { comp, name: "BOX", type: "rect", size: [400, 200], fillColor: [1, 0, 0], strokeColor: [1, 1, 1], strokeWidth: 4 });
    expect(out.ok).toBe(true);
    const group = (byName("BOX").property("ADBE Root Vectors Group") as FakeGroup).property(1) as FakeGroup;
    const contents = group.property("ADBE Vectors Group") as FakeGroup;
    expect(contents.children.map(mn)).toEqual(["ADBE Vector Shape - Rect", "ADBE Vector Graphic - Stroke", "ADBE Vector Graphic - Fill"]);
    expect(((contents.property(1) as FakeGroup).property("ADBE Vector Rect Size") as FakeProperty).value).toEqual([400, 200]);
  });

  it("adds an ellipse mask and removes it again", async () => {
    const out = await call("ae_mask_add", { comp, layer: "BG", ellipse: { cx: 960, cy: 540, rx: 300, ry: 200 }, mode: "subtract", name: "HOLE" });
    expect(out.ok).toBe(true);
    const masks = byName("BG").property("ADBE Mask Parade") as FakeGroup;
    const mask = masks.property(1) as FakeGroup;
    expect(mask.name).toBe("HOLE");
    expect(mask.maskMode).toBe(6814);
    expect(((mask.property("ADBE Mask Shape") as FakeProperty).value as { vertices: number[][] }).vertices.length).toBe(4);
    const dry = await call("ae_property_remove", { comp, layer: "BG", path: ["masks", 1], dryRun: true });
    expect((dry.data as { dryRun: boolean }).dryRun).toBe(true);
    expect(masks.numProperties).toBe(1);
    expect((await call("ae_property_remove", { comp, layer: "BG", path: ["masks", 1] })).ok).toBe(true);
    expect(masks.numProperties).toBe(0);
  });

  it("adds a per-character text animator with a reveal", async () => {
    await call("ae_text_create", { comp, text: "夜を越えて", name: "LYRIC" });
    const out = await call("ae_text_addAnimator", {
      comp,
      layer: "LYRIC",
      properties: { opacity: 0, position: [0, 40] },
      reveal: { start: 1, duration: 1, ease: "easyEase" },
    });
    expect(out.ok).toBe(true);
    const anim = ((byName("LYRIC").property("ADBE Text Properties") as FakeGroup).property("ADBE Text Animators") as FakeGroup).property(1) as FakeGroup;
    const props = anim.property("ADBE Text Animator Properties") as FakeGroup;
    expect((props.property("ADBE Text Opacity") as FakeProperty).value).toBe(0);
    expect((props.property("ADBE Text Position 3D") as FakeProperty).value).toEqual([0, 40, 0]);
    const selector = (anim.property("ADBE Text Selectors") as FakeGroup).property(1) as FakeGroup;
    const start = selector.property("ADBE Text Percent Start") as FakeProperty;
    expect(start.keys.map((k) => [k.time, k.value])).toEqual([
      [1, 0],
      [2, 100],
    ]);
    expect(start.keys[0].outEase?.[0].influence).toBeCloseTo(33.33);
  });

  it("applies ease per dimension and keeps the other side for easeIn", async () => {
    const out = await call("ae_keyframe_add", {
      comp,
      layer: "LYRIC",
      path: ["transform", "scale"],
      keys: [
        { time: 0, value: 50, ease: "easyEase" },
        { time: 1, value: 100, ease: "easeIn" },
      ],
    });
    expect(out.ok).toBe(true);
    const keys = ((byName("LYRIC").property("ADBE Transform Group") as FakeGroup).property("ADBE Scale") as FakeProperty).keys;
    expect(keys[0].inEase?.length).toBe(2); // TwoD value -> 2 KeyframeEase objects
    expect(keys[1].inEase?.[0].influence).toBeCloseTo(33.33);
    expect(keys[1].outEase?.[0].influence).toBeCloseTo(16.67); // untouched side
  });

  it("mv_createLyricAnimation supports per-character reveal", async () => {
    const out = await call("mv_createLyricAnimation", { comp, text: "何度でも歌うよ", start: 2, duration: 3, reveal: "character", entrance: "slide-up" });
    expect(out.ok).toBe(true);
  });

  it("renders with a template chosen by substring", async () => {
    const outPath = join(tmp, "out.png");
    const out = await call("ae_render_comp", { comp, outputPath: outPath, template: "png", duration: 1 });
    expect(out.ok).toBe(true);
    expect((out.data as { template: string }).template).toBe("PNG Sequence");
    expect(readFileSync(outPath, "utf8")).toContain("PNG Sequence");
    expect(fake.project.renderQueue.numItems).toBe(0); // temporary item removed
  });

  it("creates, lists and restores checkpoints", async () => {
    const aep = join(tmp, "song.aep");
    writeFileSync(aep, "v1");
    fake.project.file = aep;
    const cp = await call("ae_checkpoint_create", { label: "before chorus" });
    expect(cp.ok).toBe(true);
    const cpFile = (cp.data as { checkpoint: string }).checkpoint;
    expect(cpFile).toMatch(/^song__\d{8}-\d{6}_before_chorus\.aep$/);
    writeFileSync(aep, "v2");
    fake.project.dirty = true;
    expect((await call("ae_checkpoint_restore", { checkpoint: cpFile })).error?.code).toBe("CONFLICT");
    const restored = await call("ae_checkpoint_restore", { checkpoint: cpFile, discardChanges: true });
    expect(restored.ok).toBe(true);
    expect(readFileSync(aep, "utf8")).toBe("v1");
    expect(fake.opened.at(-1)).toBe(aep);
    const list = await call("ae_checkpoint_list", {});
    expect((list.data as { checkpoints: unknown[] }).checkpoints.length).toBe(2); // + before-restore backup
    fake.project.dirty = false;
  });

  it("validator reports effects that are not installed", async () => {
    expect((await call("ae_effect_add", { comp, layer: "BG", matchName: "ADBE Glo2" })).ok).toBe(true);
    const saved = fake.effects.splice(0, 1); // pretend Glow was uninstalled
    try {
      const out = await call("ae_project_validate", { comp });
      expect(JSON.stringify(out.data)).toContain("missing-effects");
    } finally {
      fake.effects.unshift(...saved);
    }
    expect(existsSync(tmp)).toBe(true);
  });
});

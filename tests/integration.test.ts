/**
 * End-to-end (minus After Effects): real WsBridge <-WebSocket-> real panel Connection, run once per plugin:
 *  - uxp: Dispatcher + TS command handlers (apps/ae-plugin)
 *  - cep: CepExecutor -> ExtendScript host (apps/ae-cep-plugin/jsx) in an ES3-like vm
 * After Effects is replaced by tests/fakes/fake-ae.ts. Runs the Phase 1 scenario through the same
 * tool handlers the MCP server registers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@roxy/shared";
import { COMMANDS } from "@roxy/ae-protocol";
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
import { fake, installFakeAe, resetFake, undoLog, type FakeComp, type FakeGroup, type FakeProperty } from "./fakes/fake-ae.js";

const PORT = 47900 + Math.floor(Math.random() * 40);
const logger = new Logger({ level: "error", sink: () => {} });
installFakeAe();

let bridge: WsBridge;
let conn: Connection;
let ctx: ToolContext;
const tools = new Map(buildAeTools().map((t) => [t.name, t]));

async function call(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const tool = name === createLyricAnimation.name ? createLyricAnimation : tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.handler(tool.inputSchema.parse(args), ctx);
}

/** Plugin-side executor: UXP (TS handlers) or CEP (panel executor + ExtendScript host). */
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

describe.each(["uxp", "cep"] as const)("Phase 1 scenario via %s plugin (fake AE)", (kind) => {
  beforeAll(async () => {
    resetFake();
    const port = PORT + (kind === "cep" ? 1 : 0);
    bridge = new WsBridge({ host: "127.0.0.1", port, logger, serverInfo: { name: "test", version: "0" }, retryBindMs: 0 });
    bridge.start();
    const preview = new PreviewEngine({ dir: mkdtempSync(join(tmpdir(), "roxy-test-")), logger });
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
  });

  afterAll(async () => {
    conn.stop();
    await bridge.stop();
  });

  it("exposes every catalog command", () => {
    const missing = Object.keys(COMMANDS).filter((c) => !bridge.status().pluginCommands.includes(c));
    expect(missing).toEqual([]);
  });

  it("reports status", async () => {
    const out = await call("ae_status", {});
    expect(out.ok).toBe(true);
    expect((out.data as { connected: boolean }).connected).toBe(true);
    expect((out.data as { ping: { ok: boolean } }).ping.ok).toBe(true);
  });

  it("creates comp, text, keyframes, glow and a preview", async () => {
    const comp = { name: "TEST" };
    const layer = { name: "ROXY_TEXT" };

    const c = await call("ae_comp_create", { name: "TEST", width: 1920, height: 1080, duration: 5, fps: 60 });
    expect(c.ok).toBe(true);
    expect(typeof (c.data as { compId: number }).compId).toBe("number");

    const dup = await call("ae_comp_create", { name: "TEST", width: 100, height: 100, duration: 1, fps: 30 });
    expect(dup.error?.code).toBe("CONFLICT");

    const t = await call("ae_text_create", { comp, text: "ROXY", name: "ROXY_TEXT" });
    expect(t.ok).toBe(true);
    // UXP fake does not expose ParagraphJustification -> skipped with a warning (anchor still centered);
    // ExtendScript exposes it as a global, so the CEP host applies it without warning.
    expect(t.warnings?.some((w) => w.includes("ParagraphJustification")) ?? false).toBe(kind === "uxp");
    expect((t.data as { transform: { position: number[]; anchorPoint: number[] } }).transform.position).toEqual([960, 540]);
    expect((t.data as { transform: { anchorPoint: number[] } }).transform.anchorPoint).toEqual([150, -20]);

    const op = await call("ae_keyframe_add", {
      comp,
      layer,
      path: ["transform", "opacity"],
      keys: [
        { time: 0, value: 0 },
        { time: 1, value: 100 },
        { time: 4, value: 100 },
        { time: 5, value: 0 },
      ],
    });
    expect(op.ok).toBe(true);
    expect((op.data as { numKeys: number }).numKeys).toBe(4);

    const sc = await call("ae_keyframe_add", { comp, layer, path: "transform/scale", keys: [{ time: 1, value: 100 }, { time: 3, value: 120 }] });
    expect(sc.ok).toBe(true);

    const fx = await call("ae_effect_add", { comp, layer, displayName: "glow" });
    expect(fx.ok).toBe(true);
    expect((fx.data as { effect: { matchName: string } }).effect.matchName).toBe("ADBE Glo2");

    const tr = await call("ae_transform_get", { comp, layer, time: 2.5 });
    const v = (tr.data as { transform: { opacity: number; scale: number[] } }).transform;
    expect(v.opacity).toBe(100);
    expect(v.scale).toEqual([115, 115]); // linear: 1s=100 -> 3s=120

    const pv = await call("ae_preview_frameAtTime", { comp, time: 2.5, returnImage: true });
    expect(pv.ok).toBe(true);
    const d = pv.data as { imagePath: string; width: number; height: number; time: number; compName: string };
    expect(d.compName).toBe("TEST");
    expect(d.time).toBe(2.5);
    expect(d.width).toBeGreaterThan(0);
    expect(pv.images?.[0].mimeType).toBe("image/png");

    // Each mutating command got its own undo group.
    expect(undoLog.filter((u) => u === "begin:Roxy: keyframe.add").length).toBe(2);
  });

  it("returns AMBIGUOUS_SELECTOR instead of guessing", async () => {
    await call("ae_text_create", { comp: "TEST", text: "A", name: "DUP" });
    await call("ae_text_create", { comp: "TEST", text: "B", name: "DUP" });
    const out = await call("ae_layer_get", { comp: "TEST", layer: "DUP" });
    expect(out.error?.code).toBe("AMBIGUOUS_SELECTOR");
    expect((out.error?.details as { candidates: unknown[] }).candidates.length).toBe(2);
  });

  it("explains NOT_FOUND with available property names", async () => {
    const out = await call("ae_property_get", { comp: "TEST", layer: "ROXY_TEXT", path: ["transform", "nope"] });
    expect(out.error?.code).toBe("NOT_FOUND");
    expect(JSON.stringify(out.error?.details)).toContain("ADBE Opacity");
  });

  it("refuses changes to lockedForAI layers and never unlocks", async () => {
    const lock = await call("ae_metadata_set", { comp: "TEST", layer: "ROXY_TEXT", metadata: { lockedForAI: true, roxyId: "roxy_main" } });
    expect(lock.ok).toBe(true);
    const change = await call("ae_transform_set", { comp: "TEST", layer: "ROXY_TEXT", values: { rotation: 10 } });
    expect(change.error?.code).toBe("LOCKED_FOR_AI");
    const unlock = await call("ae_metadata_set", { comp: "TEST", layer: { roxyId: "roxy_main" }, metadata: { lockedForAI: false } });
    expect(unlock.error?.code).toBe("LOCKED_FOR_AI");
  });

  it("delete returns a snapshot, dryRun changes nothing", async () => {
    const before = (fake.project.comps[0] as FakeComp).numLayers;
    const dry = await call("ae_layer_delete", { comp: "TEST", layer: { name: "DUP", index: 1 }, dryRun: true });
    expect(dry.ok).toBe(true);
    expect((fake.project.comps[0] as FakeComp).numLayers).toBe(before);
    const del = await call("ae_layer_delete", { comp: "TEST", layer: { name: "DUP", index: 1 } });
    expect((del.data as { deleted: { layer: { name: string } } }).deleted.layer.name).toBe("DUP");
    expect((fake.project.comps[0] as FakeComp).numLayers).toBe(before - 1);
  });

  it("batch: one undo group, $ref between steps, stop on error", async () => {
    undoLog.length = 0;
    const out = await call("ae_batch_execute", {
      commands: [
        { id: "c", command: "comp.create", args: { name: "BATCH", width: 640, height: 360, duration: 2, fps: 30 } },
        { id: "t", command: "text.create", args: { comp: { $ref: "c.compId" }, text: "hi", name: "HI" } },
        { id: "bad", command: "layer.get", args: { comp: { $ref: "c.compId" }, layer: "MISSING" } },
        { id: "never", command: "layer.get", args: { comp: { $ref: "c.compId" }, layer: "HI" } },
      ],
    });
    expect(out.ok).toBe(true);
    const data = out.data as { executed: number; failed: number; stoppedAt: number; results: Array<{ success: boolean }> };
    expect(data.executed).toBe(3);
    expect(data.failed).toBe(1);
    expect(data.stoppedAt).toBe(2);
    expect(undoLog.filter((u) => u.startsWith("begin")).length).toBe(1);
  });

  it("batch is rejected up front when a step is invalid", async () => {
    const out = await call("ae_batch_execute", { commands: [{ command: "comp.create", args: { name: "X" } }] });
    expect(out.error?.code).toBe("INVALID_ARGS");
  });

  it("mv_createLyricAnimation compiles to one batch", async () => {
    const out = await call("mv_createLyricAnimation", { comp: "BATCH", text: "世界なんて嫌いだ", start: 0.5, duration: 1, entrance: "scale-pop" });
    expect(out.ok).toBe(true);
    const comp = fake.project.comps.find((c) => c.name === "BATCH") as FakeComp;
    const layer = comp.layer(1);
    const opacity = (layer.property("ADBE Transform Group") as FakeGroup).property("ADBE Opacity") as FakeProperty;
    expect(opacity.numKeys).toBeGreaterThanOrEqual(3);
  });

  it("keyframe.remove reports what was removed", async () => {
    const out = await call("ae_keyframe_remove", { comp: "TEST", layer: { name: "ROXY_TEXT" }, path: ["transform", "scale"], time: 3, dryRun: true });
    // ROXY_TEXT is locked by an earlier test -> refused even for dryRun of a destructive command.
    expect(out.error?.code).toBe("LOCKED_FOR_AI");
  });

  it("validate finds issues", async () => {
    const out = await call("ae_project_validate", {});
    expect(out.ok).toBe(true);
    expect((out.data as { rulesRun: string[] }).rulesRun).toContain("duplicate-roxy-id");
  });
});

describe("bridge failure modes", () => {
  it("returns AE_NOT_CONNECTED instead of throwing", async () => {
    const b = new WsBridge({ host: "127.0.0.1", port: PORT + 60, logger, serverInfo: { name: "t", version: "0" }, retryBindMs: 0 });
    b.start();
    await new Promise((r) => setTimeout(r, 100));
    const res = await b.request("comp.list", {});
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("AE_NOT_CONNECTED");
    await b.stop();
  });

  it("times out / reports CONNECTION_LOST when the plugin does not answer", async () => {
    const port = PORT + 61;
    const b = new WsBridge({ host: "127.0.0.1", port, logger, serverInfo: { name: "t", version: "0" }, retryBindMs: 0 });
    b.start();
    await new Promise((r) => setTimeout(r, 100));
    // A "plugin" that completes the handshake but never answers requests.
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, "roxy-ae.v1");
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ type: "hello", protocolVersion: 1, plugin: { name: "mute", version: "0" }, host: {}, commands: [] }));
    expect(await b.waitForConnection(2000)).toBe(true);

    const timedOut = await b.request("comp.list", {}, { timeoutMs: 200 });
    expect(timedOut.error?.code).toBe("TIMEOUT");

    const pending = b.request("comp.list", {}, { timeoutMs: 5000 });
    ws.close();
    expect((await pending).error?.code).toBe("CONNECTION_LOST");
    await b.stop();
  });

  it("rejects a plugin with a different protocol version", async () => {
    const port = PORT + 62;
    const b = new WsBridge({ host: "127.0.0.1", port, logger, serverInfo: { name: "t", version: "0" }, retryBindMs: 0 });
    b.start();
    await new Promise((r) => setTimeout(r, 100));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, "roxy-ae.v1");
    await new Promise((r) => (ws.onopen = r));
    const ack = new Promise<{ accepted: boolean }>((r) => (ws.onmessage = (e) => r(JSON.parse(String(e.data)))));
    ws.send(JSON.stringify({ type: "hello", protocolVersion: 999, plugin: { name: "old", version: "0" }, host: {}, commands: [] }));
    expect((await ack).accepted).toBe(false);
    expect(b.isConnected()).toBe(false);
    await b.stop();
  });
});

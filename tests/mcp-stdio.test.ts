/**
 * Spawns the BUILT MCP server (apps/mcp-server/dist/index.js) and talks MCP JSON-RPC over stdio,
 * like Claude Code / Codex do. Requires `npm run build:server` first (skipped otherwise).
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const entry = join(__dirname, "..", "apps", "mcp-server", "dist", "index.js");

describe.skipIf(!existsSync(entry))("MCP server over stdio (built)", () => {
  it("initializes, lists tools and answers ae_status without AE", async () => {
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, ROXY_AE_PORT: String(48000 + Math.floor(Math.random() * 500)), ROXY_LOG_LEVEL: "error" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const responses = new Map<number, any>();
    const waiters = new Map<number, (v: any) => void>();
    createInterface({ input: child.stdout }).on("line", (line) => {
      const msg = JSON.parse(line);
      if (typeof msg.id === "number") {
        responses.set(msg.id, msg);
        waiters.get(msg.id)?.(msg);
      }
    });
    const rpc = (id: number, method: string, params: unknown) =>
      new Promise<any>((resolve) => {
        waiters.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });

    try {
      const init = await rpc(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "roxy-test", version: "0" },
      });
      expect(init.result.serverInfo.name).toBe("roxy-ae-agent");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

      const list = await rpc(2, "tools/list", {});
      const names: string[] = list.result.tools.map((t: { name: string }) => t.name);
      for (const n of ["ae_status", "ae_comp_create", "ae_text_create", "ae_keyframe_add", "ae_effect_add", "ae_preview_frameAtTime", "ae_batch_execute", "ae_get_project_state"]) {
        expect(names).toContain(n);
      }

      for (const n of ["ae_review_start", "ae_review_record", "ae_project_autofix", "ae_render_verify"]) expect(names).toContain(n);
      const prompts = await rpc(9, "prompts/list", {});
      expect(prompts.result.prompts.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(["review_loop", "autofix"]));

      // Without After Effects: status works, commands fail cleanly (no crash).
      const status = await rpc(3, "tools/call", { name: "ae_status", arguments: {} });
      expect(JSON.parse(status.result.content[0].text).data.connected).toBe(false);

      const create = await rpc(4, "tools/call", {
        name: "ae_comp_create",
        arguments: { name: "X", width: 1920, height: 1080, duration: 5, fps: 60 },
      });
      expect(create.result.isError).toBe(true);
      expect(JSON.parse(create.result.content[0].text).error.code).toBe("AE_NOT_CONNECTED");
    } finally {
      child.kill();
    }
  }, 20000);
});

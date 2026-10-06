import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Logger } from "@roxy/shared";
import { hasPngEnd, readPngSize } from "./png.js";

export interface PreviewEngineOptions {
  /** Directory where preview PNGs are written (created if missing). */
  dir: string;
  logger: Logger;
  /** Keep at most this many preview PNGs; older ones (created by Roxy) are deleted. */
  maxFiles?: number;
}

export interface FrameFile {
  path: string;
  width: number;
  height: number;
  bytes: number;
}

const FILE_PREFIX = "roxy_";

/**
 * Server-side half of the preview pipeline.
 *
 * Phase 1 backend: the AE extension renders with CompItem.saveFrameToPng (or a one-frame Render Queue job) into a
 * path chosen here; this engine waits until the PNG is completely written and validates it.
 * Future backends (aerender / Render Queue for sequences & video) plug in behind the same
 * `framePath` -> render -> `waitForFrame` flow.
 */
export class PreviewEngine {
  readonly dir: string;
  private readonly maxFiles: number;

  constructor(private readonly opts: PreviewEngineOptions) {
    this.dir = resolve(opts.dir);
    this.maxFiles = opts.maxFiles ?? 200;
    mkdirSync(this.dir, { recursive: true });
  }

  framePath(compName: string, time: number): string {
    const safe = compName.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "comp";
    const t = time.toFixed(3).replace(".", "s");
    return join(this.dir, `${FILE_PREFIX}${safe}_${t}_${Date.now().toString(36)}.png`);
  }

  /** Poll until the PNG exists, is complete (IEND) and its size is stable. */
  async waitForFrame(path: string, timeoutMs: number): Promise<FrameFile> {
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;
    while (Date.now() < deadline) {
      try {
        const st = await stat(path);
        if (st.size > 0 && st.size === lastSize) {
          const buf = new Uint8Array(await readFile(path));
          const size = readPngSize(buf);
          if (size && hasPngEnd(buf)) return { path, ...size, bytes: st.size };
        }
        lastSize = st.size;
      } catch {
        // not there yet
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Preview file was not written within ${timeoutMs}ms: ${path}`);
  }

  async readBase64(path: string): Promise<string> {
    return (await readFile(path)).toString("base64");
  }

  /** Delete the oldest Roxy preview files beyond maxFiles. Only touches files Roxy created. */
  prune(): void {
    try {
      const files = readdirSync(this.dir)
        .filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith(".png"))
        .map((f) => ({ f, t: statSync(join(this.dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const { f } of files.slice(this.maxFiles)) unlinkSync(join(this.dir, f));
    } catch (e) {
      this.opts.logger.warn("PREVIEW", `prune failed: ${(e as Error).message}`);
    }
  }
}

/**
 * Phase 4: verify a rendered file with ffprobe (duration, resolution, frame rate, audio).
 * ffprobe lookup: ROXY_FFPROBE env -> "ffprobe" on PATH -> C:\ffmpeg\bin\ffprobe.exe.
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import * as z from "zod/v4";
import { ErrorCode } from "@roxy/ae-protocol";
import type { ToolDefinition } from "./types.js";

export interface ProbeResult {
  durationSec: number | null;
  sizeBytes: number;
  video: { codec: string; width: number; height: number; fps: number | null } | null;
  audio: { codec: string; channels: number; sampleRate: number } | null;
}

const CANDIDATES = ["ffprobe", "C:\\ffmpeg\\bin\\ffprobe.exe"];

export function findFfprobe(env: NodeJS.ProcessEnv = process.env): string | null {
  const list = env.ROXY_FFPROBE ? [env.ROXY_FFPROBE] : CANDIDATES;
  for (const cmd of list) {
    try {
      const r = spawnSync(cmd, ["-version"], { encoding: "utf8", timeout: 10_000 });
      if (r.status === 0) return cmd;
    } catch {
      /* not found */
    }
  }
  return null;
}

function parseRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [n, d] = rate.split("/").map(Number);
  if (!n || !d) return null;
  return Math.round((n / d) * 1000) / 1000;
}

/** Pure: ffprobe -show_format -show_streams JSON -> ProbeResult. */
export function parseProbe(json: string, sizeBytes: number): ProbeResult {
  const data = JSON.parse(json) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; channels?: number; sample_rate?: string; duration?: string }>;
  };
  const v = data.streams?.find((s) => s.codec_type === "video");
  const a = data.streams?.find((s) => s.codec_type === "audio");
  const dur = Number(data.format?.duration ?? v?.duration ?? a?.duration);
  return {
    durationSec: Number.isFinite(dur) ? Math.round(dur * 1000) / 1000 : null,
    sizeBytes,
    video: v ? { codec: v.codec_name ?? "?", width: v.width ?? 0, height: v.height ?? 0, fps: parseRate(v.avg_frame_rate) ?? parseRate(v.r_frame_rate) } : null,
    audio: a ? { codec: a.codec_name ?? "?", channels: a.channels ?? 0, sampleRate: Number(a.sample_rate ?? 0) } : null,
  };
}

export interface Expectations {
  durationSec?: number;
  durationToleranceSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  minSizeBytes?: number;
}

/** Pure: compare a probe with expectations. */
export function checkExpectations(p: ProbeResult, e: Expectations): Array<{ check: string; pass: boolean; expected: unknown; actual: unknown }> {
  const out: Array<{ check: string; pass: boolean; expected: unknown; actual: unknown }> = [];
  if (e.durationSec !== undefined) {
    const tol = e.durationToleranceSec ?? 0.1;
    out.push({ check: "duration", pass: p.durationSec !== null && Math.abs(p.durationSec - e.durationSec) <= tol, expected: `${e.durationSec}±${tol}s`, actual: p.durationSec });
  }
  if (e.width !== undefined) out.push({ check: "width", pass: p.video?.width === e.width, expected: e.width, actual: p.video?.width ?? null });
  if (e.height !== undefined) out.push({ check: "height", pass: p.video?.height === e.height, expected: e.height, actual: p.video?.height ?? null });
  if (e.fps !== undefined) out.push({ check: "fps", pass: p.video?.fps !== null && p.video !== null && Math.abs((p.video.fps ?? 0) - e.fps) < 0.01, expected: e.fps, actual: p.video?.fps ?? null });
  if (e.hasAudio !== undefined) out.push({ check: "hasAudio", pass: (p.audio !== null) === e.hasAudio, expected: e.hasAudio, actual: p.audio !== null });
  out.push({ check: "minSize", pass: p.sizeBytes >= (e.minSizeBytes ?? 1), expected: `>= ${e.minSizeBytes ?? 1} bytes`, actual: p.sizeBytes });
  return out;
}

export const renderVerify: ToolDefinition = {
  name: "ae_render_verify",
  description:
    "Check a rendered file with ffprobe: duration, resolution, fps, audio presence, size. Pass `expect` (e.g. the comp settings) to get pass/fail per check.",
  inputSchema: z.object({
    path: z.string().min(1),
    expect: z
      .object({
        durationSec: z.number().positive().optional(),
        durationToleranceSec: z.number().min(0).optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        fps: z.number().positive().optional(),
        hasAudio: z.boolean().optional(),
        minSizeBytes: z.number().int().min(0).optional(),
      })
      .default({}),
  }),
  readOnly: true,
  handler: async (args) => {
    if (!existsSync(args.path)) return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: `File not found: ${args.path}` } };
    const ffprobe = findFfprobe();
    if (!ffprobe) {
      return {
        ok: false,
        error: { code: ErrorCode.UNSUPPORTED, message: "ffprobe was not found", hint: "Install FFmpeg or set ROXY_FFPROBE to the ffprobe.exe path in the MCP server environment." },
      };
    }
    const r = spawnSync(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", args.path], { encoding: "utf8", timeout: 60_000 });
    if (r.status !== 0) return { ok: false, error: { code: ErrorCode.AE_ERROR, message: `ffprobe failed: ${(r.stderr || "").trim().slice(0, 500)}` } };
    const probe = parseProbe(r.stdout, statSync(args.path).size);
    const checks = checkExpectations(probe, args.expect);
    return { ok: true, data: { path: args.path, ok: checks.every((c) => c.pass), probe, checks } };
  },
};

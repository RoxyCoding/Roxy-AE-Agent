/**
 * Phase 4: review loop tools. The vision model is the MCP client itself (it looks at the returned frames);
 * Roxy provides the scaffolding around it:
 *   start -> capture frames + objective checks -> AI evaluates against the criteria -> record verdict
 *   -> (checkpoint) -> AI applies fixes with normal tools -> capture again (with diff) -> ... until pass / limit.
 * Every iteration is logged to <preview dir>/../reviews/<id>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as z from "zod/v4";
import { compField, ErrorCode, type DiagnosticsSnapshot } from "@roxy/ae-protocol";
import { analyzeFrame, decodePng, diffFrames, type FrameStats } from "@roxy/preview-engine";
import { validateProject } from "@roxy/project-validator";
import { createOperationId } from "@roxy/shared";
import { checkpointCreate, checkpointRestore } from "./checkpoint.js";
import { renderFrame } from "./preview.js";
import type { ToolContext, ToolDefinition, ToolImage, ToolOutcome } from "./types.js";

interface CapturedFrame {
  time: number;
  imagePath: string;
  stats: FrameStats | null;
  diffVsPrevious?: { meanAbsDiff: number; changedRatio: number } | null;
}

interface Iteration {
  index: number;
  capturedAt: string;
  frames: CapturedFrame[];
  autoIssues: string[];
  validation: { ok: boolean; counts: Record<string, number>; issues: unknown[] } | null;
  verdict?: "pass" | "fix" | "stop";
  evaluations?: Array<{ criterion: string; pass: boolean; note?: string }>;
  plannedChanges?: string;
  /** Checkpoint taken BEFORE the fixes of this iteration were applied (rollback target). */
  checkpointBeforeFix?: string | null;
}

interface ReviewSession {
  id: string;
  comp: { id: number; name: string };
  goal: string;
  criteria: string[];
  times: number[];
  maxIterations: number;
  createdAt: string;
  status: "open" | "passed" | "stopped" | "limit-reached";
  baselineCheckpoint: string | null;
  iterations: Iteration[];
}

const sessions = new Map<string, ReviewSession>();

function reviewDir(ctx: ToolContext): string {
  return join(dirname(ctx.preview.dir), "reviews");
}

function persist(ctx: ToolContext, s: ReviewSession): string {
  const dir = reviewDir(ctx);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${s.id}.json`);
  writeFileSync(file, JSON.stringify(s, null, 2));
  return file;
}

function getSession(id: string): ReviewSession | ToolOutcome {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: `No review session "${id}" in this MCP server process`, details: { sessions: [...sessions.keys()] } } };
  return s;
}

const isOutcome = (v: unknown): v is ToolOutcome => !!v && typeof v === "object" && "ok" in v;

/** Take a checkpoint if possible; returns its file name or null (+ warning) when the project was never saved. */
async function tryCheckpoint(ctx: ToolContext, label: string, warnings: string[]): Promise<string | null> {
  const res = await checkpointCreate.handler({ label }, ctx);
  if (res.ok) return (res.data as { checkpoint: string }).checkpoint;
  warnings.push(`No checkpoint (${res.error?.message}). Rollback will not be available; save the project with ae_project_save to enable it.`);
  return null;
}

async function capture(ctx: ToolContext, s: ReviewSession, returnImage: boolean): Promise<{ iteration?: Iteration; images: ToolImage[]; fail?: ToolOutcome }> {
  const prev = s.iterations[s.iterations.length - 1];
  const frames: CapturedFrame[] = [];
  const images: ToolImage[] = [];
  for (const time of s.times) {
    const out = await renderFrame(ctx, { comp: s.comp.id, time, draft: false, returnImage });
    if (!out.ok) return { images, fail: out };
    const imagePath = (out.data as { imagePath: string }).imagePath;
    const img = decodePng(new Uint8Array(readFileSync(imagePath)));
    const frame: CapturedFrame = { time, imagePath, stats: img ? analyzeFrame(img) : null };
    const before = prev?.frames.find((f) => f.time === time);
    if (before && img) {
      const old = decodePng(new Uint8Array(readFileSync(before.imagePath)));
      const d = old ? diffFrames(old, img) : null;
      frame.diffVsPrevious = d && d.comparable ? { meanAbsDiff: d.meanAbsDiff, changedRatio: d.changedRatio } : null;
    }
    frames.push(frame);
    if (out.images) images.push(...out.images);
  }

  const autoIssues: string[] = [];
  for (const f of frames) {
    if (f.stats?.blank) autoIssues.push(`t=${f.time}s: frame is a single flat colour (nothing visible?)`);
    else if (f.stats?.dark) autoIssues.push(`t=${f.time}s: frame is very dark (mean luma ${f.stats.meanLuma})`);
  }
  if (prev && frames.every((f) => f.diffVsPrevious && f.diffVsPrevious.changedRatio < 0.001)) {
    autoIssues.push("No visible change compared with the previous capture at any sampled time");
  }

  let validation: Iteration["validation"] = null;
  const diag = await ctx.execute("project.collectDiagnostics", { comp: s.comp.id }, { source: "review" });
  if (diag.success) {
    const report = validateProject(diag.data as DiagnosticsSnapshot, { maxIssues: 20 });
    validation = { ok: report.ok, counts: report.counts, issues: report.issues };
    for (const i of report.issues.filter((x) => x.severity === "error")) autoIssues.push(`validator: ${i.message}`);
  }

  const iteration: Iteration = { index: s.iterations.length, capturedAt: new Date().toISOString(), frames, autoIssues, validation };
  s.iterations.push(iteration);
  return { iteration, images };
}

function nextStepText(s: ReviewSession): string {
  return (
    `Look at the frames and evaluate EACH criterion (${s.criteria.length}). Then call ae_review_record with ` +
    `verdict "pass" (all criteria met), "fix" (describe plannedChanges, then apply them with the normal tools and call ae_review_capture), ` +
    `or "stop". Iterations used: ${Math.max(0, s.iterations.length - 1)}/${s.maxIterations}.`
  );
}

function captureOutcome(s: ReviewSession, iteration: Iteration, images: ToolImage[], warnings: string[], file: string): ToolOutcome {
  return {
    ok: true,
    data: {
      sessionId: s.id,
      iteration: iteration.index,
      goal: s.goal,
      criteria: s.criteria,
      frames: iteration.frames.map((f) => ({ time: f.time, imagePath: f.imagePath, stats: f.stats, diffVsPrevious: f.diffVsPrevious })),
      autoIssues: iteration.autoIssues,
      validation: iteration.validation && { ok: iteration.validation.ok, counts: iteration.validation.counts },
      next: nextStepText(s),
      log: file,
    },
    images: images.length ? images : undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const reviewStart: ToolDefinition = {
  name: "ae_review_start",
  description:
    "Start a review loop for a comp: takes a baseline checkpoint (if the project is saved), renders sample frames, runs objective checks " +
    "(blank/dark frames, validator) and returns everything for YOU to evaluate against the given criteria. Follow `next` in the response.",
  inputSchema: z.object({
    comp: compField,
    goal: z.string().min(1).describe("What the result should achieve, in the user's words"),
    criteria: z.array(z.string().min(1)).min(1).max(12).describe("Checkable criteria, e.g. 'title is readable at 1s'"),
    times: z.array(z.number().min(0)).max(12).optional().describe("Times to inspect (seconds). Default: evenly spaced"),
    frameCount: z.number().int().min(1).max(12).default(4),
    maxIterations: z.number().int().min(1).max(10).default(3),
    returnImage: z.boolean().default(true),
  }),
  handler: async (args, ctx) => {
    const info = await ctx.execute("comp.get", { comp: args.comp, includeLayers: false }, { source: "review" });
    if (!info.success) return { ok: false, opId: info.id, error: info.error };
    const comp = info.data as { id: number; name: string; duration: number };
    const times: number[] =
      args.times && args.times.length
        ? [...new Set(args.times as number[])].sort((a, b) => a - b)
        : Array.from({ length: args.frameCount }, (_, i) => Math.round(((comp.duration * (i + 0.5)) / args.frameCount) * 1000) / 1000);
    const warnings: string[] = [];
    const s: ReviewSession = {
      id: createOperationId("review"),
      comp: { id: comp.id, name: comp.name },
      goal: args.goal,
      criteria: args.criteria,
      times,
      maxIterations: args.maxIterations,
      createdAt: new Date().toISOString(),
      status: "open",
      baselineCheckpoint: null,
      iterations: [],
    };
    s.baselineCheckpoint = await tryCheckpoint(ctx, `review-${s.id.slice(-6)}-start`, warnings);
    sessions.set(s.id, s);
    const { iteration, images, fail } = await capture(ctx, s, args.returnImage);
    if (fail || !iteration) return fail ?? { ok: false, error: { code: ErrorCode.INTERNAL, message: "capture failed" } };
    return captureOutcome(s, iteration, images, warnings, persist(ctx, s));
  },
};

export const reviewCapture: ToolDefinition = {
  name: "ae_review_capture",
  description:
    "After applying fixes, render the same sample times again. Returns frames, objective checks and the per-frame difference to the previous capture.",
  inputSchema: z.object({ sessionId: z.string(), returnImage: z.boolean().default(true) }),
  readOnly: true,
  handler: async (args, ctx) => {
    const s = getSession(args.sessionId);
    if (isOutcome(s)) return s;
    if (s.status !== "open") return { ok: false, error: { code: ErrorCode.CONFLICT, message: `Session is ${s.status}` } };
    const last = s.iterations[s.iterations.length - 1];
    if (last && last.verdict !== "fix") {
      return { ok: false, error: { code: ErrorCode.CONFLICT, message: "Record a verdict for the current capture first (ae_review_record)" } };
    }
    const { iteration, images, fail } = await capture(ctx, s, args.returnImage);
    if (fail || !iteration) return fail ?? { ok: false, error: { code: ErrorCode.INTERNAL, message: "capture failed" } };
    return captureOutcome(s, iteration, images, [], persist(ctx, s));
  },
};

export const reviewRecord: ToolDefinition = {
  name: "ae_review_record",
  description:
    "Record your evaluation of the latest capture. verdict: pass | fix | stop. For 'fix' a checkpoint is taken first (rollback point), then apply your " +
    "planned changes and call ae_review_capture. When the iteration limit is reached the loop stops and you must ask the user how to continue.",
  inputSchema: z.object({
    sessionId: z.string(),
    verdict: z.enum(["pass", "fix", "stop"]),
    evaluations: z.array(z.object({ criterion: z.string(), pass: z.boolean(), note: z.string().optional() })).min(1),
    plannedChanges: z.string().optional().describe("Required for verdict=fix: what you will change and why"),
  }),
  handler: async (args, ctx) => {
    const s = getSession(args.sessionId);
    if (isOutcome(s)) return s;
    if (s.status !== "open") return { ok: false, error: { code: ErrorCode.CONFLICT, message: `Session is ${s.status}` } };
    const it = s.iterations[s.iterations.length - 1];
    if (it.verdict) return { ok: false, error: { code: ErrorCode.CONFLICT, message: "This capture already has a verdict; call ae_review_capture first" } };
    if (args.verdict === "fix" && !args.plannedChanges) {
      return { ok: false, error: { code: ErrorCode.INVALID_ARGS, message: "plannedChanges is required for verdict=fix" } };
    }
    const warnings: string[] = [];
    it.verdict = args.verdict;
    it.evaluations = args.evaluations;
    it.plannedChanges = args.plannedChanges;
    let next: string;
    if (args.verdict === "pass") {
      s.status = "passed";
      next = "Done. Summarise the result for the user and ask them to check it in After Effects.";
    } else if (args.verdict === "stop") {
      s.status = "stopped";
      next = "Stopped. Explain to the user why and what remains.";
    } else if (it.index >= s.maxIterations) {
      s.status = "limit-reached";
      it.verdict = "stop";
      next = `Iteration limit (${s.maxIterations}) reached. Do not change anything else: report the remaining problems to the user and ask how to proceed.`;
    } else {
      it.checkpointBeforeFix = await tryCheckpoint(ctx, `review-${s.id.slice(-6)}-it${it.index}`, warnings);
      next = "Apply the planned changes now with the normal tools, then call ae_review_capture.";
    }
    const file = persist(ctx, s);
    return {
      ok: true,
      data: { sessionId: s.id, status: s.status, iteration: it.index, checkpoint: it.checkpointBeforeFix ?? null, next, log: file },
      warnings: warnings.length ? warnings : undefined,
    };
  },
};

export const reviewRollback: ToolDefinition = {
  name: "ae_review_rollback",
  description:
    "Undo the fixes of a review iteration by restoring the checkpoint taken before them (or the baseline with iteration=-1). " +
    "Unsaved changes made after that checkpoint are discarded. Use when a fix made things worse.",
  inputSchema: z.object({ sessionId: z.string(), iteration: z.number().int().min(-1) }),
  destructive: true,
  handler: async (args, ctx) => {
    const s = getSession(args.sessionId);
    if (isOutcome(s)) return s;
    const target = args.iteration === -1 ? s.baselineCheckpoint : s.iterations[args.iteration]?.checkpointBeforeFix;
    if (!target) {
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: `No checkpoint for iteration ${args.iteration}`, hint: "Checkpoints exist only when the project was saved." } };
    }
    const res = await checkpointRestore.handler({ checkpoint: target, discardChanges: true }, ctx);
    if (res.ok) {
      s.iterations.push({
        index: s.iterations.length,
        capturedAt: new Date().toISOString(),
        frames: [],
        autoIssues: [`rolled back to ${target}`],
        validation: null,
        verdict: "fix",
        plannedChanges: `rollback to ${target}`,
      });
      persist(ctx, s);
    }
    return res;
  },
};

export const reviewStatus: ToolDefinition = {
  name: "ae_review_status",
  description: "Show a review session log (or list sessions of this server process when sessionId is omitted).",
  inputSchema: z.object({ sessionId: z.string().optional() }),
  readOnly: true,
  handler: async (args) => {
    if (!args.sessionId) {
      return { ok: true, data: { sessions: [...sessions.values()].map((s) => ({ id: s.id, comp: s.comp.name, status: s.status, iterations: s.iterations.length })) } };
    }
    const s = getSession(args.sessionId);
    if (isOutcome(s)) return s;
    return { ok: true, data: s };
  },
};

export const REVIEW_TOOLS = [reviewStart, reviewCapture, reviewRecord, reviewRollback, reviewStatus];

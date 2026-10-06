/**
 * Checkpoints: copies of the saved .aep kept in "<project folder>/roxy_checkpoints/".
 * Server-side (Node fs) + plugin commands project.getState / project.save / project.open.
 * Nothing is ever deleted; restoring first backs up the current file as another checkpoint.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import * as z from "zod/v4";
import { ErrorCode } from "@roxy/ae-protocol";
import { fromResponse, type ToolContext, type ToolDefinition, type ToolOutcome } from "./types.js";

export const CHECKPOINT_DIR = "roxy_checkpoints";

interface ProjectInfo {
  name: string;
  path: string | null;
  dirty?: boolean;
}

async function projectInfo(ctx: ToolContext): Promise<{ info?: ProjectInfo; fail?: ToolOutcome }> {
  const res = await ctx.execute("project.getState", { detail: "summary" }, { source: "checkpoint" });
  if (!res.success) return { fail: fromResponse(res) };
  return { info: (res.data as { project: ProjectInfo }).project };
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const safeLabel = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40);

function checkpointDir(projectPath: string): string {
  return join(dirname(projectPath), CHECKPOINT_DIR);
}

function projectBase(projectPath: string): string {
  return basename(projectPath).replace(/\.aep$/i, "");
}

/** Copy the on-disk project file into the checkpoint folder. */
export function copyCheckpoint(projectPath: string, label?: string): string {
  const dir = checkpointDir(projectPath);
  mkdirSync(dir, { recursive: true });
  const file = `${projectBase(projectPath)}__${stamp()}${label ? `_${safeLabel(label)}` : ""}.aep`;
  copyFileSync(projectPath, join(dir, file));
  return join(dir, file);
}

export function listCheckpoints(projectPath: string): Array<{ file: string; path: string; bytes: number; modified: string }> {
  const dir = checkpointDir(projectPath);
  if (!existsSync(dir)) return [];
  const prefix = `${projectBase(projectPath)}__`;
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.toLowerCase().endsWith(".aep"))
    .map((f) => {
      const st = statSync(join(dir, f));
      return { file: f, path: join(dir, f), bytes: st.size, modified: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

const notSaved: ToolOutcome = {
  ok: false,
  error: {
    code: ErrorCode.INVALID_ARGS,
    message: "The project has never been saved, so there is no file to checkpoint",
    hint: "Save it first with ae_project_save { path: \"C:\\\\...\\\\name.aep\" }.",
  },
};

export const checkpointCreate: ToolDefinition = {
  name: "ae_checkpoint_create",
  description:
    "Save the project and keep a copy in <project folder>/roxy_checkpoints/ (use before risky edits). The project must have been saved once (ae_project_save with path).",
  inputSchema: z.object({ label: z.string().max(40).optional().describe("Short label, e.g. before-chorus") }),
  handler: async (args, ctx) => {
    const { info, fail } = await projectInfo(ctx);
    if (fail) return fail;
    if (!info?.path) return notSaved;
    const saved = await ctx.execute("project.save", {}, { source: "checkpoint" });
    if (!saved.success) return fromResponse(saved);
    try {
      const path = copyCheckpoint(info.path, args.label);
      return { ok: true, opId: saved.id, data: { checkpoint: basename(path), path, project: info.path } };
    } catch (e) {
      return { ok: false, error: { code: ErrorCode.INTERNAL, message: `Could not copy the project file: ${(e as Error).message}` } };
    }
  },
};

export const checkpointList: ToolDefinition = {
  name: "ae_checkpoint_list",
  description: "List checkpoints of the current project (newest first).",
  inputSchema: z.object({}),
  readOnly: true,
  handler: async (_args, ctx) => {
    const { info, fail } = await projectInfo(ctx);
    if (fail) return fail;
    if (!info?.path) return notSaved;
    return { ok: true, data: { project: info.path, checkpoints: listCheckpoints(info.path) } };
  },
};

export const checkpointRestore: ToolDefinition = {
  name: "ae_checkpoint_restore",
  description:
    "Restore a checkpoint: the current saved project file is first backed up as a 'before-restore' checkpoint, then the checkpoint is copied over the project file and reopened. " +
    "Refuses when there are unsaved changes unless discardChanges=true (unsaved changes are then lost). Ask the user before using discardChanges.",
  inputSchema: z.object({
    checkpoint: z.string().describe("Checkpoint file name from ae_checkpoint_list"),
    discardChanges: z.boolean().default(false),
  }),
  destructive: true,
  handler: async (args, ctx) => {
    const { info, fail } = await projectInfo(ctx);
    if (fail) return fail;
    if (!info?.path) return notSaved;
    if (info.dirty && !args.discardChanges) {
      return {
        ok: false,
        error: { code: ErrorCode.CONFLICT, message: "The project has unsaved changes", hint: "Create a checkpoint first, or pass discardChanges=true." },
      };
    }
    const match = listCheckpoints(info.path).find((c) => c.file === basename(args.checkpoint));
    if (!match) {
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: `No checkpoint "${args.checkpoint}"`, details: { available: listCheckpoints(info.path).map((c) => c.file) } } };
    }
    let backup: string;
    try {
      backup = copyCheckpoint(info.path, "before-restore");
      copyFileSync(match.path, info.path);
    } catch (e) {
      return { ok: false, error: { code: ErrorCode.INTERNAL, message: `Could not restore the file: ${(e as Error).message}` } };
    }
    const opened = await ctx.execute("project.open", { path: info.path, discardChanges: true }, { source: "checkpoint" });
    if (!opened.success) return { ...fromResponse(opened), data: { backup } };
    return { ok: true, opId: opened.id, data: { restored: match.file, project: info.path, backupOfPreviousState: basename(backup) } };
  },
};

export const CHECKPOINT_TOOLS = [checkpointCreate, checkpointList, checkpointRestore];

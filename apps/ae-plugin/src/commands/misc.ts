import { ErrorCode, RoxyError, getCommand, resolveRefs } from "@roxy/ae-protocol";
import { aeCall, settleDeferred, safeGet } from "../ae/host.js";
import { compRef, resolveComp } from "../ae/resolve.js";
import type { Handler } from "./context.js";

interface BatchArgs {
  commands: Array<{ id?: string; command: string; args: Record<string, unknown> }>;
  onError: "stop" | "continue";
  undoGroup: string;
}

export const miscHandlers: Record<string, Handler> = {
  "preview.renderFrame": async (args: { comp?: unknown; time?: number; outputPath: string; draft: boolean }) => {
    const comp = resolveComp(args.comp as never);
    const time = args.time ?? safeGet(() => comp.time, 0);
    if (time > comp.duration + 1e-6) {
      throw new RoxyError(ErrorCode.INVALID_ARGS, `time ${time}s is beyond the comp duration (${comp.duration}s)`);
    }
    const started = Date.now();
    // CompItem.saveFrameToPng / saveDraftFrameToPng (AE 27.0) return a DeferredCall.
    const dc = aeCall(args.draft ? "saveDraftFrameToPng" : "saveFrameToPng", () =>
      args.draft ? comp.saveDraftFrameToPng(time, args.outputPath) : comp.saveFrameToPng(time, args.outputPath),
    );
    const settled = await settleDeferred(dc);
    return {
      comp: compRef(comp),
      time,
      outputPath: args.outputPath,
      compWidth: comp.width,
      compHeight: comp.height,
      draft: args.draft,
      // false => the host returned a non-thenable DeferredCall; the server waits for the file.
      awaited: settled.awaited,
      elapsedMs: Date.now() - started,
    };
  },

  "undo.beginGroup": (args: { name: string }, ctx) => {
    ctx.undo.beginExplicit(args.name);
    return { open: true, name: args.name };
  },

  "undo.endGroup": (_args, ctx) => {
    const name = ctx.undo.endExplicit();
    return { closed: name !== null, name };
  },

  "batch.execute": async (args: BatchArgs, ctx) => {
    // Validate every step name up front so nothing runs if the batch is malformed.
    args.commands.forEach((step, i) => {
      const spec = getCommand(step.command);
      if (!spec) throw new RoxyError(ErrorCode.UNKNOWN_COMMAND, `Step ${i} ("${step.id ?? i}"): unknown command "${step.command}"`);
      if (spec.batchable === false) {
        throw new RoxyError(ErrorCode.INVALID_ARGS, `Step ${i}: "${step.command}" is not allowed inside batch.execute`);
      }
    });

    return ctx.undo.runGrouped(args.undoGroup, async () => {
      const stepResults: Record<string, unknown> = {};
      const results: Array<Record<string, unknown>> = [];
      let failed = 0;
      let stoppedAt: number | null = null;
      for (let i = 0; i < args.commands.length; i++) {
        const step = args.commands[i];
        const stepId = step.id ?? String(i);
        let stepArgs: unknown;
        try {
          stepArgs = resolveRefs(step.args, stepResults);
        } catch (e) {
          results.push({ id: stepId, command: step.command, success: false, error: { code: ErrorCode.INVALID_ARGS, message: (e as Error).message } });
          failed++;
          if (args.onError === "stop") {
            stoppedAt = i;
            break;
          }
          continue;
        }
        const res = await ctx.executeNested(step.command, stepArgs);
        const entry: Record<string, unknown> = { id: stepId, command: step.command, success: res.success };
        if (res.success) {
          entry.data = res.data;
          stepResults[stepId] = res.data;
        } else {
          entry.error = res.error;
          failed++;
        }
        if (res.warnings?.length) entry.warnings = res.warnings;
        results.push(entry);
        if (!res.success && args.onError === "stop") {
          stoppedAt = i;
          break;
        }
      }
      return {
        total: args.commands.length,
        executed: results.length,
        succeeded: results.length - failed,
        failed,
        stoppedAt,
        rolledBack: false,
        results,
      };
    });
  },
};

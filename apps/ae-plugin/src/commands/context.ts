import type { CommandResponse } from "@roxy/ae-protocol";
import type { UndoManager } from "../undo.js";
import { resolveComp, resolveLayer } from "../ae/resolve.js";
import { assertNotLocked } from "../ae/metadata.js";
import type { AE } from "../ae/host.js";

export interface HandlerContext {
  warn(message: string): void;
  undo: UndoManager;
  /** Execute another command through the dispatcher (used by batch.execute). */
  executeNested(command: string, args: unknown): Promise<CommandResponse>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (args: any, ctx: HandlerContext) => unknown | Promise<unknown>;

/** Resolve comp + layer from args; when `forWrite`, refuse targets locked for AI. */
export function target(args: { comp?: unknown; layer: unknown }, forWrite: boolean): { comp: AE; layer: AE } {
  const comp = resolveComp(args.comp as never);
  const layer = resolveLayer(comp, args.layer as never);
  if (forWrite) {
    assertNotLocked(comp, `Composition "${comp.name}"`);
    assertNotLocked(layer, `Layer "${layer.name}"`);
  }
  return { comp, layer };
}

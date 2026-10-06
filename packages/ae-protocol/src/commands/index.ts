import type { CommandSpec } from "./define.js";
import * as project from "./project.js";
import * as comp from "./comp.js";
import * as layer from "./layer.js";
import * as effect from "./effect.js";
import * as misc from "./misc.js";
import * as footage from "./footage.js";
import * as structure from "./structure.js";

export * from "./define.js";
export * from "./project.js";
export * from "./comp.js";
export * from "./layer.js";
export * from "./effect.js";
export * from "./misc.js";
export * from "./footage.js";
export * from "./structure.js";

function isSpec(v: unknown): v is CommandSpec {
  return !!v && typeof v === "object" && "name" in v && "args" in v && "mutates" in v;
}

/** Catalog of every command the plugin understands, keyed by name. */
export const COMMANDS: Record<string, CommandSpec> = Object.fromEntries(
  [project, comp, layer, effect, misc, footage, structure]
    .flatMap((m) => Object.values(m))
    .filter(isSpec)
    .map((spec) => [spec.name, spec]),
);

export const DEFAULT_TIMEOUT_MS = 30_000;

export function getCommand(name: string): CommandSpec | undefined {
  return COMMANDS[name];
}

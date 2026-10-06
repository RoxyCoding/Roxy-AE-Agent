import * as z from "zod/v4";
import { defineCommand } from "./define.js";
import { compField, layerField } from "../selectors.js";
import { RoxyMetadata } from "../metadata.js";

export const systemPing = defineCommand({
  name: "system.ping",
  description: "Round-trip check to the AE plugin. Returns host app/version info.",
  args: z.object({}),
  mutates: false,
  internal: true, // exposed through ae_status
});

export const projectGetState = defineCommand({
  name: "project.getState",
  description:
    "Get project state. detail='summary' (default, small: project info, active comp, comp list) or 'detailed' " +
    "(adds comp settings and the layer list of ONE comp: `comp` or the active comp). Use this instead of dumping everything.",
  args: z.object({
    detail: z.enum(["summary", "detailed"]).default("summary"),
    comp: compField.describe("Comp whose layers are listed in 'detailed' mode (default: active comp)"),
    compLimit: z.number().int().min(1).max(500).default(100),
  }),
  mutates: false,
});

export const projectSave = defineCommand({
  name: "project.save",
  description:
    "Save the project. If the project has never been saved, `path` (absolute .aep path) is required (avoids a blocking Save dialog).",
  args: z.object({
    path: z.string().optional().describe("Absolute path for Save As (.aep)"),
  }),
  mutates: false,
  timeoutMs: 120_000,
});

export const projectCollectDiagnostics = defineCommand({
  name: "project.collectDiagnostics",
  description: "Internal: collect a lightweight snapshot used by the project validator.",
  args: z.object({
    comp: compField.describe("Limit to one comp (default: all comps)"),
    maxLayersPerComp: z.number().int().min(1).max(2000).default(500),
  }),
  mutates: false,
  internal: true,
  timeoutMs: 120_000,
});

export const metadataGet = defineCommand({
  name: "metadata.get",
  description: "Read Roxy metadata of a comp (omit `layer`) or a layer.",
  args: z.object({
    comp: compField,
    layer: layerField.optional(),
  }),
  mutates: false,
});

export const metadataSet = defineCommand({
  name: "metadata.set",
  description:
    "Merge Roxy metadata into a comp (omit `layer`) or a layer. lockedForAI can be set to true but never back to false (user only).",
  args: z.object({
    comp: compField,
    layer: layerField.optional(),
    metadata: RoxyMetadata,
  }),
  mutates: true,
});

import * as z from "zod/v4";
import { defineCommand } from "./define.js";
import { compField } from "../selectors.js";
import { RoxyMetadata } from "../metadata.js";

/** Project item (footage or comp) selector: name string, id number, or {id|name}. */
export const ItemSelector = z
  .union([z.string(), z.number().int(), z.object({ id: z.number().int().optional(), name: z.string().optional() })])
  .describe("Project item (footage / comp): name string, id number, or {id|name}");

export const footageImport = defineCommand({
  name: "footage.import",
  description:
    "Import a file (audio, video, image) into the project, like File > Import. Returns the item id, duration and whether it has audio/video. " +
    "Use layer.addItem to place it in a composition.",
  args: z.object({
    path: z.string().min(1).describe("Absolute file path, e.g. C:\\Users\\me\\Music\\song.mp3"),
    name: z.string().optional().describe("Rename the project item"),
  }),
  mutates: true,
  timeoutMs: 120_000,
});

export const layerAddItem = defineCommand({
  name: "layer.addItem",
  description: "Add a project item (imported footage/audio or another comp) to a composition as a new layer.",
  args: z.object({
    comp: compField,
    item: ItemSelector,
    startTime: z.number().optional().describe("Layer start time in comp seconds (default 0)"),
    name: z.string().optional().describe("Layer name"),
    roxy: RoxyMetadata.optional(),
  }),
  mutates: true,
});

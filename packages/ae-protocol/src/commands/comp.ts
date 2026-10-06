import * as z from "zod/v4";
import { defineCommand } from "./define.js";
import { compField } from "../selectors.js";
import { RoxyMetadata } from "../metadata.js";

export const compCreate = defineCommand({
  name: "comp.create",
  description: "Create a composition. Fails with CONFLICT if a comp with the same name exists (unless allowDuplicateName).",
  args: z.object({
    name: z.string().min(1),
    width: z.number().int().min(4).max(30000),
    height: z.number().int().min(4).max(30000),
    duration: z.number().positive().max(10800).describe("Seconds"),
    fps: z.number().positive().max(999),
    pixelAspect: z.number().positive().default(1),
    bgColor: z.array(z.number().min(0).max(1)).length(3).optional().describe("[r,g,b] 0..1"),
    open: z.boolean().default(true).describe("Open the comp in the viewer (makes it the active comp)"),
    allowDuplicateName: z.boolean().default(false),
    roxy: RoxyMetadata.optional(),
  }),
  mutates: true,
});

export const compGet = defineCommand({
  name: "comp.get",
  description: "Get composition settings and (optionally) its layer list.",
  args: z.object({
    comp: compField,
    includeLayers: z.boolean().default(true),
  }),
  mutates: false,
});

export const compList = defineCommand({
  name: "comp.list",
  description: "List compositions (id, name, size, fps, duration, layer count).",
  args: z.object({
    filter: z.string().optional().describe("Case-insensitive substring of the comp name"),
    limit: z.number().int().min(1).max(1000).default(200),
  }),
  mutates: false,
});

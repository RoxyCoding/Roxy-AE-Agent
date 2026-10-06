import * as z from "zod/v4";

/**
 * Roxy Metadata - attached to comps/layers that Roxy creates or manages.
 *
 * Persistence (Phase 1): stored inside the AE `comment` attribute of the CompItem / Layer
 * (documented RW string in the AE UXP API, saved with the .aep, survives restarts).
 * The metadata lives on a single dedicated line so any user-written comment is preserved:
 *
 *   <user comment...>
 *   #roxy:{"roxyId":"lyrics_main_001","role":"lyrics",...}
 *
 * The codec below is pure so it can be unit-tested and swapped (e.g. for project XMP) later.
 */

export const RoxyMetadata = z
  .object({
    roxyId: z.string().min(1).optional(),
    role: z.string().optional().describe("Semantic role, e.g. lyrics, background, camera_rig"),
    scene: z.string().optional().describe("Scene id, e.g. chorus_01"),
    tags: z.array(z.string()).optional(),
    managedBy: z.string().optional().describe("'roxy' when created by Roxy"),
    lockedForAI: z.boolean().optional().describe("When true, AI mutations on this element are refused"),
  })
  .catchall(z.unknown())
  .describe("Roxy metadata");
export type RoxyMetadata = z.infer<typeof RoxyMetadata>;

export const METADATA_LINE_PREFIX = "#roxy:";

export interface DecodedComment {
  /** User-visible part of the comment (without the Roxy line). */
  userComment: string;
  metadata: RoxyMetadata | null;
  /** True if a Roxy line existed but could not be parsed. */
  corrupt: boolean;
}

export function decodeComment(comment: string | null | undefined): DecodedComment {
  const text = comment ?? "";
  const lines = text.split(/\r\n|\r|\n/);
  let metadata: RoxyMetadata | null = null;
  let corrupt = false;
  const rest: string[] = [];
  for (const line of lines) {
    if (line.startsWith(METADATA_LINE_PREFIX)) {
      try {
        const parsed = RoxyMetadata.safeParse(JSON.parse(line.slice(METADATA_LINE_PREFIX.length)));
        if (parsed.success) metadata = parsed.data;
        else corrupt = true;
      } catch {
        corrupt = true;
      }
    } else {
      rest.push(line);
    }
  }
  return { userComment: rest.join("\n").replace(/\n+$/, ""), metadata, corrupt };
}

export function encodeComment(userComment: string, metadata: RoxyMetadata | null): string {
  const base = userComment.replace(/\n+$/, "");
  if (!metadata || Object.keys(metadata).length === 0) return base;
  const line = METADATA_LINE_PREFIX + JSON.stringify(metadata);
  return base.length > 0 ? `${base}\n${line}` : line;
}

/**
 * Merge a metadata patch. `lockedForAI` can be raised by the AI but never lowered:
 * unlocking is reserved for the user (by editing the comment in AE).
 */
export function mergeMetadata(
  current: RoxyMetadata | null,
  patch: RoxyMetadata,
): { merged: RoxyMetadata; refusedUnlock: boolean } {
  const merged: RoxyMetadata = { ...(current ?? {}), ...patch };
  let refusedUnlock = false;
  if (current?.lockedForAI === true && patch.lockedForAI === false) {
    merged.lockedForAI = true;
    refusedUnlock = true;
  }
  return { merged, refusedUnlock };
}

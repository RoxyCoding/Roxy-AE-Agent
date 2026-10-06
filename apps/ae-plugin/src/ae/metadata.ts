import { decodeComment, encodeComment, mergeMetadata, ErrorCode, RoxyError, type RoxyMetadata } from "@roxy/ae-protocol";
import { safeGet, type AE } from "./host.js";

/** Metadata store backed by the `comment` attribute of CompItem / Layer (see ae-protocol/metadata.ts). */
export function readMetadata(target: AE): RoxyMetadata | null {
  const comment = safeGet<string>(() => target.comment, "");
  return decodeComment(comment).metadata;
}

export function writeMetadata(target: AE, patch: RoxyMetadata, warn: (m: string) => void): RoxyMetadata {
  const decoded = decodeComment(safeGet<string>(() => target.comment, ""));
  if (decoded.corrupt) warn("Existing Roxy metadata line was unreadable and has been replaced");
  const { merged, refusedUnlock } = mergeMetadata(decoded.metadata, patch);
  if (refusedUnlock) warn("lockedForAI cannot be cleared by the AI; it stays true (the user must unlock it in AE)");
  target.comment = encodeComment(decoded.userComment, merged);
  return merged;
}

/** Replace metadata entirely (used to strip roxyId from duplicates). */
export function replaceMetadata(target: AE, metadata: RoxyMetadata | null): void {
  const decoded = decodeComment(safeGet<string>(() => target.comment, ""));
  target.comment = encodeComment(decoded.userComment, metadata);
}

export function assertNotLocked(target: AE, label: string): void {
  const meta = readMetadata(target);
  if (meta?.lockedForAI) {
    throw new RoxyError(ErrorCode.LOCKED_FOR_AI, `${label} is locked for AI (Roxy metadata lockedForAI=true)`, {
      details: { roxyId: meta.roxyId ?? null },
      hint: "Ask the user to unlock it, or work on another element.",
    });
  }
}

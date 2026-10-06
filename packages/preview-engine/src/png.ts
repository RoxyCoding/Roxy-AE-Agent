const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Read width/height from the IHDR chunk. Returns null if the buffer is not a complete PNG header. */
export function readPngSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (buf[i] !== PNG_SIGNATURE[i]) return null;
  // bytes 12..15 must be "IHDR"
  if (String.fromCharCode(buf[12], buf[13], buf[14], buf[15]) !== "IHDR") return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A complete PNG ends with the IEND chunk (used to detect files still being written). */
export function hasPngEnd(buf: Uint8Array): boolean {
  if (buf.length < 12) return false;
  const s = buf.length - 8;
  return String.fromCharCode(buf[s], buf[s + 1], buf[s + 2], buf[s + 3]) === "IEND";
}

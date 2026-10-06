/**
 * Objective frame checks for the review loop (Phase 4) - no AI involved:
 *  - decodePng: minimal PNG decoder (8/16-bit gray, gray+alpha, RGB, RGBA; non-interlaced)
 *  - analyzeFrame: brightness statistics -> "blank" (flat single colour) / "dark" detection
 *  - diffFrames: how much two renders of the same time differ (did the fix change anything?)
 */
import { inflateSync } from "node:zlib";

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel. */
  data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Returns null for PNG variants this decoder does not support (palette, interlaced, < 8 bit). */
export function decodePng(buf: Uint8Array): DecodedImage | null {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIGNATURE[i]) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= buf.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const channels = CHANNELS[colorType];
  if (!channels || interlace !== 0 || (bitDepth !== 8 && bitDepth !== 16) || width === 0 || height === 0) return null;

  const raw = inflateSync(Buffer.concat(idat.map((b) => Buffer.from(b))));
  const bytesPerPixel = channels * (bitDepth / 8);
  const stride = width * bytesPerPixel;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bytesPerPixel ? out[x - bytesPerPixel] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0;
      const v = src[x];
      out[x] =
        filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c);
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  const step = bitDepth / 8; // 16-bit: use the high byte
  for (let i = 0; i < width * height; i++) {
    const base = i * bytesPerPixel;
    const ch = (n: number) => pixels[base + n * step];
    let r: number, g: number, bl: number, al: number;
    if (colorType === 0) [r, g, bl, al] = [ch(0), ch(0), ch(0), 255];
    else if (colorType === 4) [r, g, bl, al] = [ch(0), ch(0), ch(0), ch(1)];
    else if (colorType === 2) [r, g, bl, al] = [ch(0), ch(1), ch(2), 255];
    else [r, g, bl, al] = [ch(0), ch(1), ch(2), ch(3)];
    rgba.set([r, g, bl, al], i * 4);
  }
  return { width, height, data: rgba };
}

export interface FrameStats {
  width: number;
  height: number;
  /** Mean luminance 0..255 (transparent pixels count as black, like an AE comp on black). */
  meanLuma: number;
  /** Standard deviation of luminance; ~0 means a flat single-colour frame. */
  lumaStdDev: number;
  /** Share of sampled pixels that are (almost) fully transparent. */
  transparentRatio: number;
  blank: boolean;
  dark: boolean;
}

/** Visit up to ~maxSamples pixels on a regular grid. */
function sampleGrid(img: DecodedImage, maxSamples: number, fn: (index: number) => void): void {
  const stepPx = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / maxSamples)));
  for (let y = 0; y < img.height; y += stepPx) {
    for (let x = 0; x < img.width; x += stepPx) fn((y * img.width + x) * 4);
  }
}

const luma = (d: Uint8Array, i: number) => {
  const a = d[i + 3] / 255;
  return (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * a;
};

export function analyzeFrame(img: DecodedImage): FrameStats {
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let transparent = 0;
  sampleGrid(img, 40_000, (i) => {
    const l = luma(img.data, i);
    sum += l;
    sumSq += l * l;
    if (img.data[i + 3] < 8) transparent++;
    n++;
  });
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  return {
    width: img.width,
    height: img.height,
    meanLuma: Math.round(mean * 10) / 10,
    lumaStdDev: Math.round(std * 10) / 10,
    transparentRatio: Math.round((transparent / n) * 1000) / 1000,
    blank: std < 1.5,
    dark: mean < 12,
  };
}

/** Mean absolute RGB difference (0..255) and share of sampled pixels that changed noticeably. */
export function diffFrames(a: DecodedImage, b: DecodedImage): { comparable: boolean; meanAbsDiff: number; changedRatio: number } {
  if (a.width !== b.width || a.height !== b.height) return { comparable: false, meanAbsDiff: 0, changedRatio: 0 };
  let n = 0;
  let sum = 0;
  let changed = 0;
  sampleGrid(a, 40_000, (i) => {
    const d = (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) + Math.abs(a.data[i + 3] - b.data[i + 3])) / 4;
    sum += d;
    if (d > 8) changed++;
    n++;
  });
  return { comparable: true, meanAbsDiff: Math.round((sum / n) * 10) / 10, changedRatio: Math.round((changed / n) * 1000) / 1000 };
}

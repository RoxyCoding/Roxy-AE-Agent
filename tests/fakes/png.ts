import { deflateSync } from "node:zlib";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Minimal valid black RGB PNG of the given size. */
/**
 * Valid RGB PNG. Default: black. `pixel(x, y)` returns [r,g,b]; `filter` 0 (None), 1 (Sub) or 2 (Up)
 * exercises the decoder's unfiltering.
 */
export function makePng(width: number, height: number, pixel?: (x: number, y: number) => number[], filter: 0 | 1 | 2 = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height); // filter byte + pixels (black by default)
  if (pixel) {
    const rows: Buffer[] = [];
    for (let y = 0; y < height; y++) {
      const row = Buffer.alloc(stride);
      for (let x = 0; x < width; x++) row.set(pixel(x, y).map((v) => v & 255), x * 3);
      rows.push(row);
    }
    for (let y = 0; y < height; y++) {
      const off = y * (stride + 1);
      raw[off] = filter;
      for (let i = 0; i < stride; i++) {
        const left = i >= 3 ? rows[y][i - 3] : 0;
        const up = y > 0 ? rows[y - 1][i] : 0;
        raw[off + 1 + i] = (rows[y][i] - (filter === 1 ? left : filter === 2 ? up : 0)) & 255;
      }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

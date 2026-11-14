#!/usr/bin/env node
// Draws the 512 x 512 plugin icon (.claude-plugin/icon.png) with no dependencies: a rounded blue square with
// three list rows, the top one highlighted like a quoted flag on the board. Deterministic: same bytes every run.
//   node scripts/draw-icon.js [out.png]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;
const SS = 4; // 4 x 4 samples per pixel for anti-aliased edges

/** Signed-distance-free coverage test for a rounded rectangle. */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(x, y, ax, ay, bx, by);
  const d2 = s(x, y, bx, by, cx, cy);
  const d3 = s(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// Layers, painted in order: [test(x, y), [r, g, b, a]]
const BLUE = [0x00, 0x65, 0xfd, 255];
const MARK = [0xff, 0xd2, 0x3f, 255];
const layers = [
  [(x, y) => inRoundRect(x, y, 0, 0, SIZE, SIZE, 112), BLUE],
  // Top row: highlighted, with an up arrow in front of it.
  [(x, y) => inTriangle(x, y, [118, 118], [80, 168], [156, 168]), [255, 255, 255, 255]],
  [(x, y) => inRoundRect(x, y, 108, 162, 128, 206, 4), [255, 255, 255, 255]],
  [(x, y) => inRoundRect(x, y, 180, 128, 432, 200, 36), MARK],
  // The rest of the list, in original order and quieter.
  [(x, y) => inRoundRect(x, y, 80, 252, 432, 300, 24), [255, 255, 255, 215]],
  [(x, y) => inRoundRect(x, y, 80, 340, 432, 388, 24), [255, 255, 255, 150]],
];

function over(dst, src) {
  const a = src[3] / 255;
  const da = dst[3] / 255;
  const oa = a + da * (1 - a);
  if (oa === 0) return [0, 0, 0, 0];
  return [0, 1, 2].map((i) => (src[i] * a + dst[i] * da * (1 - a)) / oa).concat(oa * 255);
}

function render() {
  const px = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    px[y * (SIZE * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          let c = [0, 0, 0, 0];
          for (const [test, colour] of layers) if (test(fx, fy)) c = over(c, colour);
          // Premultiplied accumulation keeps edges against transparency clean.
          acc[0] += c[0] * c[3];
          acc[1] += c[1] * c[3];
          acc[2] += c[2] * c[3];
          acc[3] += c[3];
        }
      }
      const o = y * (SIZE * 4 + 1) + 1 + x * 4;
      const a = acc[3] / (SS * SS);
      px[o] = acc[3] ? Math.round(acc[0] / acc[3]) : 0;
      px[o + 1] = acc[3] ? Math.round(acc[1] / acc[3]) : 0;
      px[o + 2] = acc[3] ? Math.round(acc[2] / acc[3]) : 0;
      px[o + 3] = Math.round(a);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function drawIcon() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(render(), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || path.join(ROOT, '.claude-plugin', 'icon.png');
  fs.writeFileSync(out, drawIcon());
  process.stdout.write(`Wrote ${out}\n`);
}

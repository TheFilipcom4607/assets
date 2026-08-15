/* Generates the PWA icons. Run with: node tools/make-icons.mjs
 *
 * No image libraries are available in this environment, so this rasterises the
 * artwork by hand (4x supersampled) and writes the PNGs with zlib, which ships
 * with Node.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

/* ── Minimal PNG writer (8-bit RGBA, no interlacing) ──────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── Artwork ──────────────────────────────────────────────────────────────── */

const BG_TOP = [0x24, 0x1a, 0x10];
const BG_BOTTOM = [0x13, 0x0e, 0x08];
const GLOW = [0xf5, 0xb6, 0x42];
const CREAM = [0xff, 0xf5, 0xdd];
const BUTTER = [0xff, 0xcf, 0x7a];
const AMBER = [0xf5, 0xb6, 0x42];

// Popcorn puff: back layer (buttery) then front layer (cream), in units where
// 1.0 is the cluster radius.
const PUFFS_BACK = [
  [-0.34, 0.10, 0.30], [0.36, 0.04, 0.30], [0.06, 0.40, 0.30], [-0.06, -0.44, 0.26],
];
const PUFFS_FRONT = [
  [-0.42, -0.16, 0.34], [0.38, -0.24, 0.32], [0.00, -0.52, 0.32],
  [-0.26, 0.36, 0.32], [0.32, 0.32, 0.30], [0.00, 0.04, 0.42],
];

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/* Colour of one sub-sample at normalised coords (0..1). `content` scales the
   artwork down for maskable icons; `round` cuts the rounded-square corners. */
function sample(u, v, { content, round }) {
  // Outside the rounded square → transparent.
  if (round > 0) {
    const dx = Math.max(Math.abs(u - 0.5) - (0.5 - round), 0);
    const dy = Math.max(Math.abs(v - 0.5) - (0.5 - round), 0);
    if (Math.hypot(dx, dy) > round) return null;
  }

  let col = mix(BG_TOP, BG_BOTTOM, v);

  // Warm glow behind the popcorn.
  const gd = Math.hypot(u - 0.5, v - 0.5) / (0.5 * content);
  if (gd < 1) col = mix(col, GLOW, 0.16 * Math.pow(1 - gd, 2.2));

  const R = 0.30 * content;         // cluster radius
  const cx = 0.5;
  const cy = 0.5;
  const px = (u - cx) / R;
  const py = (v - cy) / R;

  // Listening arcs, left and right of the cluster.
  const ad = Math.hypot(px, py);
  const ang = Math.abs(Math.atan2(py, px));
  const horizontal = ang < 0.55 || ang > Math.PI - 0.55;
  for (const [inner, outer] of [[1.28, 1.40], [1.58, 1.70]]) {
    if (horizontal && ad > inner && ad < outer) col = mix(col, AMBER, 0.85);
  }

  for (const [qx, qy, qr] of PUFFS_BACK) {
    if (Math.hypot(px - qx, py - qy) < qr) col = BUTTER.slice();
  }
  for (const [qx, qy, qr] of PUFFS_FRONT) {
    const d = Math.hypot(px - qx, py - qy);
    if (d < qr) {
      // A touch of shading so overlapping puffs stay readable.
      col = mix(CREAM, BUTTER, Math.min(1, Math.pow(d / qr, 3) * 0.55));
    }
  }

  return col;
}

function render(size, opts) {
  const SS = 4; // supersampling factor
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, opts);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      // Straight (non-premultiplied) alpha: average colour over covered samples.
      const cov = a / n;
      const k = a > 0 ? n / (a / 255) : 0;
      out[i] = Math.round(Math.min(255, r / n * k));
      out[i + 1] = Math.round(Math.min(255, g / n * k));
      out[i + 2] = Math.round(Math.min(255, b / n * k));
      out[i + 3] = Math.round(cov);
    }
  }
  return out;
}

mkdirSync(OUT, { recursive: true });

const jobs = [
  // iOS masks apple-touch-icon itself, so it wants square edges.
  ['icon-180.png', 180, { content: 1.0, round: 0 }],
  ['icon-192.png', 192, { content: 1.0, round: 0.22 }],
  ['icon-512.png', 512, { content: 1.0, round: 0.22 }],
  // Maskable: artwork inside the 80% safe circle, background full bleed.
  ['icon-maskable-512.png', 512, { content: 0.72, round: 0 }],
];

for (const [name, size, opts] of jobs) {
  writeFileSync(join(OUT, name), encodePNG(size, size, render(size, opts)));
  console.log('wrote', name, size + 'px');
}

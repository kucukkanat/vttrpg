/**
 * Writes the maskable launcher icons (public/icons/icon-maskable-{512,192}.png).
 *
 * Maskable icons are cropped to a circle, squircle or rounded square by the launcher, so only the
 * inner 80 % (a circle of radius 0.4 × size) is guaranteed to show. The d20 from icon.svg is
 * redrawn here scaled down so every stroke, including the tips, sits inside that circle, on the
 * same solid tile colour the SVG uses.
 *
 * No native rasteriser is needed: the shape is stroked with an analytic distance field and the
 * PNG is written with node's zlib. Run with `node scripts/make-icons.mjs`.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = path.join(root, 'public', 'icons')

// --- artwork, in the 512 × 512 space of icon.svg -------------------------------------------

const BG = [0x17, 0x17, 0x1b]
const INK = [0xe0, 0xa4, 0x58]
const STROKE = 22
/** Fraction of the full tile the artwork is scaled to so the farthest stroke edge stays inside the safe circle. */
export const ART_SCALE = 0.84

const hex = [[256, 56], [436, 160], [436, 352], [256, 456], [76, 352], [76, 160]]
const tri = [[256, 150], [364, 318], [148, 318]]
const spokes = [
  [[256, 56], [256, 150]],
  [[436, 160], [364, 318]],
  [[76, 160], [148, 318]],
  [[436, 352], [364, 318]],
  [[76, 352], [148, 318]],
  [[256, 456], [256, 318]],
]

function arc(cx, cy, rx, ry, from, to, steps = 24) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}

/** The "20": a bold 2 and 0 drawn as strokes, sized like the SVG's 72 px label. */
const DIGIT_STROKE = 13
const two = [
  ...arc(235, 232, 16, 15, Math.PI * 1.08, Math.PI * 2.2),
  [220, 266],
  [253, 266],
]
const zero = arc(280, 242, 18, 25, 0, Math.PI * 2, 48)

/** [points, closed, width] */
const shapes = [
  [hex, true, STROKE],
  [tri, true, STROKE],
  ...spokes.map((s) => [s, false, STROKE]),
  [two, false, DIGIT_STROKE],
  [zero, true, DIGIT_STROKE],
]

function segments(points, closed) {
  const out = []
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i], points[i + 1]])
  if (closed) out.push([points[points.length - 1], points[0]])
  return out
}

function distToSegment(px, py, [[ax, ay], [bx, by]]) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  const qx = ax + t * dx
  const qy = ay + t * dy
  return Math.hypot(px - qx, py - qy)
}

/** Stroke coverage in [0, 1] at a point in artwork space; `px` is the size of one output pixel there. */
function coverage(x, y, strokes, px) {
  let c = 0
  for (const { segs, half } of strokes) {
    let d = Infinity
    for (const s of segs) d = Math.min(d, distToSegment(x, y, s))
    // Linear falloff across one pixel: fully inside -> 1, one pixel outside -> 0.
    const v = Math.max(0, Math.min(1, 0.5 + (half - d) / px))
    c = Math.max(c, v)
    if (c >= 1) break
  }
  return c
}

export function renderIcon(size) {
  const strokes = shapes.map(([pts, closed, w]) => ({ segs: segments(pts, closed), half: w / 2 }))
  // Output pixel -> artwork coordinate: the 512 box shrunk to ART_SCALE of the tile, centred.
  const scale = 512 / (size * ART_SCALE) // artwork units per output pixel
  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ax = 256 + (x + 0.5 - size / 2) * scale
      const ay = 256 + (y + 0.5 - size / 2) * scale
      const a = coverage(ax, ay, strokes, scale)
      const i = (y * size + x) * 4
      rgba[i] = BG[0] + (INK[0] - BG[0]) * a
      rgba[i + 1] = BG[1] + (INK[1] - BG[1]) * a
      rgba[i + 2] = BG[2] + (INK[2] - BG[2]) * a
      rgba[i + 3] = 255
    }
  }
  return rgba
}

// --- PNG encoder -----------------------------------------------------------------------------

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}

export function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(outDir, { recursive: true })
for (const size of [512, 192]) {
  const file = path.join(outDir, `icon-maskable-${size}.png`)
  writeFileSync(file, encodePng(renderIcon(size), size))
  console.log('wrote', path.relative(root, file))
}

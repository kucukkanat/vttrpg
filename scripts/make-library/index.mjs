/**
 * Builds the curated CC0 library from the source packs (packs.mjs, picks.mjs):
 *
 *   1. read the source model (glTF or GLB) and bake its look into vertex colours: the pack's
 *      palette texture is sampled at every vertex's UV and multiplied by the material colour, so no
 *      texture ships at all (the texture budget is zero, well under 512 px)
 *   2. re-tint toward the candle-lit palette (a little desaturated, warmer, slightly darker) and
 *      add the diorama shading the generated props carry: darker low, contact shadow at the floor
 *   3. flatten every mesh into one node in metres, Y up. Props are scaled to their real height
 *      and get their pivot at the bottom centre; kit pieces are scaled by the pack's grid factor
 *      and keep their authored origin so they snap together on the 1.5 m grid
 *   4. flame-coloured faces of light sources (`glow`) move to an emissive `flame` material
 *   5. weld, simplify anything over the triangle budget, quantise and compress with meshopt
 *
 * Writes public/library/models/<pack>/<slug>.glb (props) and public/library/kits/<kit>/<slug>.glb
 * (kit pieces). The root carries `style: 'diorama'` and `kind`, like the generated props, so the
 * table gives it the same toon shading.
 *
 * Usage: `npm run library` (fetch, build, thumbnails, index), or `node scripts/make-library/index.mjs
 * [slug-filter]` to rebuild models only.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { Document, Logger, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { meshopt, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { PACKS } from './packs.mjs'
import { PICKS } from './picks.mjs'
import { LIBRARY, SRC_ROOT, outBase } from './paths.mjs'

/** Triangle budget per prop; kit pieces get the same. */
export const TRIANGLE_BUDGET = 5000

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const quiet = new Logger(Logger.Verbosity.WARN)
export const io = new NodeIO()
  .setLogger(quiet)
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

/* ------------------------------------------------------------------ colour helpers */

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255))

/** Candle-lit re-tint in linear space: 18% toward grey, warmer, 8% darker. */
const DESATURATE = 0.18
const WARM = [1.04, 0.98, 0.86]
const DARKEN = 0.92
function retint(r, g, b) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return [
    (r + (l - r) * DESATURATE) * WARM[0] * DARKEN,
    (g + (l - g) * DESATURATE) * WARM[1] * DARKEN,
    (b + (l - b) * DESATURATE) * WARM[2] * DARKEN,
  ]
}

const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d > 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, max ? d / max : 0, max]
}
function hsvToRgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)) }
  return [f(5), f(3), f(1)]
}

/**
 * A pack's own palette adjustment (packs.mjs `palette`), in sRGB HSV: hue ranges moved (Kenney's
 * teal foliage becomes leaf green), saturation and value scaled. Applied before the shared re-tint.
 */
function repalette(rgb, palette) {
  if (!palette) return rgb
  let [h, s, v] = rgbToHsv(...rgb.map(toSrgb))
  for (const [from, to, shift] of palette.hue ?? []) if (s > 0.3 && h >= from && h <= to) h = (h + shift + 360) % 360
  s = Math.min(1, s * (palette.sat ?? 1))
  v = Math.min(1, v * (palette.val ?? 1))
  return hsvToRgb(h, s, v).map(toLinear)
}

/** Flame-like: a bright, saturated orange or yellow (sRGB HSV). */
function isFlame(r, g, b) {
  const sr = Math.pow(r, 1 / 2.2), sg = Math.pow(g, 1 / 2.2), sb = Math.pow(b, 1 / 2.2)
  const max = Math.max(sr, sg, sb), min = Math.min(sr, sg, sb)
  if (max < 0.93 || max - min < 0.45 * max || max !== sr) return false
  const hue = 60 * ((sg - sb) / (max - min))
  return hue >= 15 && hue <= 60
}

/* ------------------------------------------------------------------ diorama shading (as lib.mjs) */

const GRADIENT_LOW = 0.8
const GRADIENT_HIGH = 1.05
const KIT_GRADIENT_SPAN = 2.5
const CONTACT_LOW = 0.55
const CONTACT_RANGE = 0.3
const smooth = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x) }

function shade(y, minY, height, kit) {
  const span = kit ? KIT_GRADIENT_SPAN : Math.max(height, 0.05)
  const g = GRADIENT_LOW + (GRADIENT_HIGH - GRADIENT_LOW) * smooth((y - minY) / span)
  const c = CONTACT_LOW + (1 - CONTACT_LOW) * smooth((y - minY) / CONTACT_RANGE)
  return g * c
}

/* ------------------------------------------------------------------ texture sampling */

const imageCache = new Map()
async function decode(texture) {
  const key = texture.getImage()
  if (!imageCache.has(key)) {
    const { data, info } = await sharp(Buffer.from(key)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    imageCache.set(key, { data, width: info.width, height: info.height })
  }
  return imageCache.get(key)
}

function sample(img, u, v) {
  const x = Math.min(img.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.width)))
  const y = Math.min(img.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.height)))
  const i = (y * img.width + x) * 4
  return [SRGB_TO_LINEAR[img.data[i]], SRGB_TO_LINEAR[img.data[i + 1]], SRGB_TO_LINEAR[img.data[i + 2]]]
}

/* ------------------------------------------------------------------ geometry collection */

function applyMat4(m, x, y, z) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]
}
function applyNormal(m, x, y, z) {
  // Upper 3x3 inverse-transpose; the packs use rotation and uniform or axis scale, so the
  // inverse scale per axis is enough after normalising.
  const nx = m[0] * x + m[4] * y + m[8] * z
  const ny = m[1] * x + m[5] * y + m[9] * z
  const nz = m[2] * x + m[6] * y + m[10] * z
  const len = Math.hypot(nx, ny, nz) || 1
  return [nx / len, ny / len, nz / len]
}

/**
 * Every triangle of the source scene in world space, with a linear RGB colour per corner.
 * Returns flat, unindexed arrays: positions, normals, colours (3 floats per corner).
 */
export async function collect(doc, { srgbFactors = false } = {}) {
  const out = { pos: [], nrm: [], col: [] }
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  const nodes = []
  scene.traverse((n) => { if (n.getMesh()) nodes.push(n) })
  for (const node of nodes) {
    const m = node.getWorldMatrix()
    const flip = (m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])) < 0
    for (const prim of node.getMesh().listPrimitives()) {
      if (prim.getMode() !== 4) continue // triangles only
      const P = prim.getAttribute('POSITION')
      const N = prim.getAttribute('NORMAL')
      const C = prim.getAttribute('COLOR_0')
      const mat = prim.getMaterial()
      const raw = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1]
      // Older Kenney exports store sRGB values in baseColorFactor (glTF wants linear).
      const factor = srgbFactors ? raw.map((c, i) => (i < 3 ? toLinear(c) : c)) : raw
      const tex = mat?.getBaseColorTexture()
      const uvSet = mat?.getBaseColorTextureInfo()?.getTexCoord() ?? 0
      const UV = tex ? prim.getAttribute(`TEXCOORD_${uvSet}`) : null
      const img = UV ? await decode(tex) : null
      const idx = prim.getIndices()
      const count = idx ? idx.getCount() : P.getCount()
      const c = [], uv = []
      for (let k = 0; k < count; k++) {
        const i = idx ? idx.getScalar(k) : k
        const p = P.getElement(i, [])
        out.pos.push(...applyMat4(m, p[0], p[1], p[2]))
        if (N) { const q = N.getElement(i, []); out.nrm.push(...applyNormal(m, q[0], q[1], q[2])) } else out.nrm.push(0, 1, 0)
        let rgb = [factor[0], factor[1], factor[2]]
        if (img) { const s = sample(img, ...UV.getElement(i, uv)); rgb = [rgb[0] * s[0], rgb[1] * s[1], rgb[2] * s[2]] }
        if (C) { const s = C.getElement(i, c); rgb = [rgb[0] * s[0], rgb[1] * s[1], rgb[2] * s[2]] }
        out.col.push(...rgb)
      }
      // A mirrored node flips the winding; restore it so faces stay front-facing.
      if (flip) {
        const start = out.pos.length - count * 3
        for (let t = start; t < out.pos.length; t += 9) for (const arr of [out.pos, out.nrm, out.col]) {
          for (let j = 0; j < 3; j++) { const a = arr[t + 3 + j]; arr[t + 3 + j] = arr[t + 6 + j]; arr[t + 6 + j] = a }
        }
      }
    }
  }
  return out
}

function bounds(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) for (let j = 0; j < 3; j++) {
    if (pos[i + j] < min[j]) min[j] = pos[i + j]
    if (pos[i + j] > max[j]) max[j] = pos[i + j]
  }
  return { min, max }
}

/* ------------------------------------------------------------------ one pick */

function scaleFor(pick, b) {
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
  if (pick.h) return pick.h / size[1]
  if (pick.w) return pick.w / Math.max(size[0], size[2])
  const s = PACKS[pick.pack].scale
  if (!s) throw new Error(`${pick.slug}: needs h, w or a pack scale`)
  return s
}

async function buildPick(pick) {
  const pack = PACKS[pick.pack]
  const src = path.join(SRC_ROOT, pack.dir, pick.file)
  if (!existsSync(src)) throw new Error(`missing source ${src}`)
  const geo = await collect(await io.read(src), { srgbFactors: !!pack.srgbFactors })
  const b0 = bounds(geo.pos)
  const s = scaleFor(pick, b0)
  // Props: pivot at the bottom centre. Kit pieces: the authored grid origin stays.
  const off = pick.kit ? [0, 0, 0] : [-(b0.min[0] + b0.max[0]) / 2, -b0.min[1], -(b0.min[2] + b0.max[2]) / 2]
  for (let i = 0; i < geo.pos.length; i += 3) for (let j = 0; j < 3; j++) geo.pos[i + j] = (geo.pos[i + j] + off[j]) * s
  const b = bounds(geo.pos)
  const height = b.max[1] - b.min[1]
  const ground = height < 0.2 && !!pick.kit

  // Split triangles into body and flame; colour the body.
  const parts = { body: { pos: [], nrm: [], col: [] }, flame: { pos: [], nrm: [], col: [] } }
  for (let t = 0; t < geo.pos.length; t += 9) {
    const avg = [0, 1, 2].map((j) => (geo.col[t + j] + geo.col[t + 3 + j] + geo.col[t + 6 + j]) / 3)
    const part = pick.glow && isFlame(...avg) ? parts.flame : parts.body
    for (let k = 0; k < 9; k += 3) {
      part.pos.push(geo.pos[t + k], geo.pos[t + k + 1], geo.pos[t + k + 2])
      part.nrm.push(geo.nrm[t + k], geo.nrm[t + k + 1], geo.nrm[t + k + 2])
      if (part === parts.flame) { part.col.push(1, 1, 1); continue }
      const [r, g, bl] = retint(...repalette([geo.col[t + k], geo.col[t + k + 1], geo.col[t + k + 2]], pack.palette))
      const f = ground ? 1 : shade(geo.pos[t + k + 1], b.min[1], height, !!pick.kit)
      part.col.push(Math.min(1, r * f), Math.min(1, g * f), Math.min(1, bl * f))
    }
  }

  const doc = new Document().setLogger(quiet)
  const buffer = doc.createBuffer()
  const diorama = doc.createMaterial('diorama').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.9).setMetallicFactor(0)
  const flame = doc.createMaterial('flame').setBaseColorFactor([1, 0.62, 0.25, 1]).setEmissiveFactor([1, 0.55, 0.18]).setRoughnessFactor(1).setMetallicFactor(0)
  const mesh = doc.createMesh(pick.slug)
  for (const [name, part] of Object.entries(parts)) {
    if (!part.pos.length) continue
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.nrm)).setBuffer(buffer))
      .setMaterial(name === 'flame' ? flame : diorama)
    if (name === 'body') prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.col)).setBuffer(buffer))
    mesh.addPrimitive(prim)
  }
  const node = doc.createNode(pick.slug).setMesh(mesh)
  doc.createScene(pick.slug).addChild(node).setExtras({ style: 'diorama', kind: pick.kit ? 'kit' : 'prop', ...(pick.kit ? { kit: pick.kit } : {}) })
  doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0])

  await doc.transform(weld(), prune())
  let tris = triangles(doc)
  if (tris > TRIANGLE_BUDGET) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: TRIANGLE_BUDGET / tris, error: 0.01 }))
    tris = triangles(doc)
  }
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const glb = await io.writeBinary(doc)
  const rel = `${outBase(pick)}.glb`
  mkdirSync(path.dirname(path.join(LIBRARY, rel)), { recursive: true })
  writeFileSync(path.join(LIBRARY, rel), glb)
  return { rel, bytes: glb.byteLength, tris, size: [0, 1, 2].map((j) => +(b.max[j] - b.min[j]).toFixed(3)), flame: parts.flame.pos.length / 9 }
}

export function triangles(doc) {
  let n = 0
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices()
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3
  }
  return n
}

/* ------------------------------------------------------------------ main */

async function main() {
  const filter = process.argv[2]
  const picks = filter ? PICKS.filter((p) => p.slug.includes(filter) || p.pack.includes(filter)) : PICKS
  const seen = new Set()
  for (const p of PICKS) {
    const key = outBase(p)
    if (seen.has(key)) throw new Error(`duplicate output ${key}`)
    seen.add(key)
  }
  if (!filter) {
    // Full rebuild: drop outputs no pick produces any more.
    for (const top of ['models', 'kits']) {
      const dir = path.join(LIBRARY, top)
      if (!existsSync(dir)) continue
      for (const sub of readdirSync(dir)) for (const f of readdirSync(path.join(dir, sub))) {
        const base = `${top}/${sub}/${f.replace(/\.(glb|webp)$/, '')}`
        if (!seen.has(base)) rmSync(path.join(dir, sub, f))
      }
    }
  }
  let total = 0
  for (const pick of picks) {
    const r = await buildPick(pick)
    total += r.bytes
    const warn = r.bytes > 100 * 1024 ? '  OVER 100 kB' : ''
    console.log(`${r.rel.padEnd(52)} ${(r.bytes / 1024).toFixed(1).padStart(6)} kB ${String(r.tris).padStart(5)} tris  ${r.size.join(' x ')} m${r.flame ? `  flame ${r.flame}` : ''}${warn}`)
  }
  console.log(`${picks.length} models, ${(total / 1024 / 1024).toFixed(2)} MB`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()

// Regenerates public/library/index.json by hashing every file under public/library/.
// Skips index.json, catalogue.json, *.md, license.txt and dotfiles. License per entry: first line
// of a `license.txt` in the same folder or the nearest parent folder, default CC0-1.0.
// Models under scenes/, props/ and minis/ get a `category` so the pickers can tell a whole room
// from a crate or a miniature; `kind` stays the asset kind (glb, image, audio, json).
//
// Also writes public/library/catalogue.json: one CatalogueEntry (src/core/catalogue.ts) per
// placeable built-in model, from the curated picks (scripts/make-library/picks.mjs) and the
// procedural starter props. Size and triangle count are read from each GLB.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { OWN_WORK, PACKS } from './make-library/packs.mjs'
import { OWN_PROPS, PICKS } from './make-library/picks.mjs'
import { outBase } from './make-library/paths.mjs'
import { expandTags } from './make-library/synonyms.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'library')

const TYPES = {
  glb: ['glb', 'model/gltf-binary'],
  png: ['image', 'image/png'],
  jpg: ['image', 'image/jpeg'],
  jpeg: ['image', 'image/jpeg'],
  webp: ['image', 'image/webp'],
  ktx2: ['image', 'image/ktx2'],
  gif: ['image', 'image/gif'],
  mp3: ['audio', 'audio/mpeg'],
  ogg: ['audio', 'audio/ogg'],
  wav: ['audio', 'audio/wav'],
  m4a: ['audio', 'audio/mp4'],
  json: ['json', 'application/json'],
}

/** Generated outputs that are not library assets themselves. */
const SKIP = new Set(['index.json', 'catalogue.json'])

/** What a model is for, from its top-level folder; other folders get none. */
const CATEGORIES = { scenes: 'scene', props: 'prop', minis: 'mini' }
function categoryFor(rel) {
  return CATEGORIES[rel.split('/')[0]]
}

function licenseFor(dir) {
  for (let d = dir; d.startsWith(root); d = path.dirname(d)) {
    const f = path.join(d, 'license.txt')
    if (existsSync(f)) return readFileSync(f, 'utf8').split('\n')[0].trim() || 'CC0-1.0'
    if (d === root) break
  }
  return 'CC0-1.0'
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

const entries = []
for (const file of walk(root)) {
  const rel = path.relative(root, file).split(path.sep).join('/')
  const base = path.basename(file)
  if (SKIP.has(rel) || base.endsWith('.md') || base === 'license.txt') continue
  const bytes = readFileSync(file)
  const ext = base.split('.').pop().toLowerCase()
  const [kind, mime] = TYPES[ext] ?? ['other', 'application/octet-stream']
  const category = kind === 'glb' ? categoryFor(rel) : undefined
  entries.push({
    sha256: createHash('sha256').update(bytes).digest('hex'),
    path: rel,
    kind,
    ...(category ? { category } : {}),
    mime,
    size: bytes.length,
    name: base,
    license: licenseFor(path.dirname(file)),
  })
}

writeFileSync(path.join(root, 'index.json'), JSON.stringify(entries, null, 2) + '\n')
console.log(`library index: ${entries.length} entries`)

/* ------------------------------------------------------------------ catalogue v2 */

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const byPath = new Map(entries.map((e) => [e.path, e]))

/** Bounds (metres, rounded to mm) and triangle count of a library GLB. */
async function measure(rel) {
  const doc = await io.readBinary(new Uint8Array(readFileSync(path.join(root, rel))))
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  // Exact bounds from every vertex in world space (getBounds would transform accessor boxes,
  // which overshoots on rotated nodes).
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  let triangles = 0
  scene.traverse((node) => {
    const mesh = node.getMesh()
    if (!mesh) return
    const m = node.getWorldMatrix()
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION')
      const v = []
      for (let i = 0; i < pos.getCount(); i++) {
        const [x, y, z] = pos.getElement(i, v)
        const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]
        for (let j = 0; j < 3; j++) { b.min[j] = Math.min(b.min[j], w[j]); b.max[j] = Math.max(b.max[j], w[j]) }
      }
      if (p.getMode() !== 4) continue
      const idx = p.getIndices()
      triangles += (idx ? idx.getCount() : pos.getCount()) / 3
    }
  })
  return { size: [0, 1, 2].map((i) => Math.round((b.max[i] - b.min[i]) * 1000) / 1000), triangles }
}

async function entry({ rel, title, category, tags, theme, kit, licence }) {
  const asset = byPath.get(rel)
  if (!asset) throw new Error(`catalogue: ${rel} is not in the library (run npm run library)`)
  const thumb = rel.replace(/\.glb$/, '.webp')
  const { size, triangles } = await measure(rel)
  const extra = [category, ...(theme ? [theme] : []), ...(kit ? ['kit', 'modular'] : [])]
  return {
    id: `builtin:${rel}`,
    origin: 'builtin',
    title,
    category,
    tags: expandTags(title, tags, extra),
    ...(theme ? { theme } : {}),
    ...(kit ? { kit } : {}),
    model: { sha256: asset.sha256, kind: 'glb', mime: asset.mime, size: asset.size, name: asset.name, sources: [rel] },
    size,
    triangles,
    licence,
    ...(byPath.has(thumb) ? { thumbnail: thumb } : {}),
  }
}

const catalogue = []
for (const p of PICKS) {
  const rel = `${outBase(p)}.glb`
  if (!byPath.has(rel)) { console.warn(`catalogue: skipping ${rel}, not built`); continue }
  const pack = PACKS[p.pack]
  catalogue.push(await entry({
    rel,
    title: p.title,
    category: p.cat,
    tags: p.tags,
    theme: p.theme ?? pack.theme,
    kit: p.kit,
    licence: { id: 'cc0', author: pack.author, authorUrl: pack.authorUrl, source: pack.source, sourceUrl: pack.fileUrl(p.file) },
  }))
}
for (const p of OWN_PROPS) {
  if (!byPath.has(p.path)) continue
  catalogue.push(await entry({
    rel: p.path,
    title: p.title,
    category: p.cat,
    tags: p.tags,
    theme: p.theme,
    licence: { id: 'cc0', author: OWN_WORK.author, source: OWN_WORK.source, sourceUrl: OWN_WORK.url },
  }))
}
catalogue.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))

// One entry per line: small to ship, readable in a diff.
writeFileSync(path.join(root, 'catalogue.json'), '[\n' + catalogue.map((e) => JSON.stringify(e)).join(',\n') + '\n]\n')
const bytes = catalogue.reduce((n, e) => n + e.model.size + (byPath.get(e.thumbnail)?.size ?? 0), 0)
console.log(`library catalogue: ${catalogue.length} entries, ${(bytes / 1024 / 1024).toFixed(2)} MB of models and thumbnails`)

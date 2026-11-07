/**
 * Kit manifests (level design Phase 4): one `public/library/kits/<kit>.json` per grid kit, derived
 * from the catalogue's kit pieces (`kit` set) plus the hand-tuned table below. The table says, for
 * every GLB, which slot it fills, its footprint in 1.5 m cells, how its authored origin maps to the
 * kit's canonical frame (see src/core/kits.ts), its gameplay walls and its join arms. GLB names
 * alone are ambiguous ("wall-arch" is decor, "wall-gated" a door, "wall-half" means half as long in
 * one kit and half as tall in the other), so nothing is guessed: a kit piece missing from the table
 * fails the build.
 *
 * Piece order is append-only: a tile stores its piece's index, so pieces already in a manifest keep
 * their place and new ones go at the end.
 *
 * Usage: `node scripts/make-library/kits.mjs` (part of `npm run library`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { LIBRARY } from './paths.mjs'

/* ------------------------------------------------------------------ shapes */

/** Straight wall `len` cells long, blocking along its whole length. */
const wallLos = (len) => [{ a: [-len / 2, 0], b: [len / 2, 0] }]
/** Wall with an opening of one cell in the middle: the sides block, the middle is `kind` (or open). */
const openingLos = (len, kind) => {
  const out = [{ a: [-len / 2, 0], b: [-0.5, 0] }, { a: [0.5, 0], b: [len / 2, 0] }]
  if (kind) out.push({ a: [-0.5, 0], b: [0.5, 0], kind })
  return out
}
/** A square post `half` cells from its centre to each side. */
const postLos = (half) => [
  { a: [-half, -half], b: [half, -half] }, { a: [half, -half], b: [half, half] },
  { a: [half, half], b: [-half, half] }, { a: [-half, half], b: [-half, -half] },
]
/** Join arms of `length` cells, with their walls. */
const arms = (dirs, length) => ({
  arms: dirs.map((dir) => ({ dir, length })),
  los: dirs.map((dir) => ({ a: [0, 0], b: { E: [length, 0], W: [-length, 0], N: [0, -length], S: [0, length] }[dir] })),
})

const floor = (w, d, extra = {}) => ({ slot: 'floor', footprint: [w, d], height: 0, symmetry: w === d ? 4 : 2, los: [], ...extra })
const stair = (w, d, base) => ({ slot: 'stair', footprint: [w, d], height: 1, symmetry: 1, los: [], base })
const roof = (symmetry = 1, extra = {}) => ({ slot: 'roof', footprint: [2, 2], height: 1, symmetry, los: [], ...extra })

/* ------------------------------------------------------------------ KayKit Dungeon */

// Floors are centred on their origin. Walls run along x, centred, 0.75 m thick on the line: their
// origin is the vertex in the middle of the two edges they cover. Joins sit on a vertex with
// one-cell arms (the corner's arms point -x and +z as authored). Stairs climb towards -z from z = 0.
const KAYKIT_WALL = { slot: 'wall', footprint: [2, 0], height: 1, symmetry: 2, los: wallLos(2) }
const KAYKIT = {
  'floor-tile-large': floor(2, 2),
  'floor-tile-small': floor(1, 1),
  'floor-tile-small-broken-a': floor(1, 1),
  'floor-tile-small-decorated': floor(1, 1, { symmetry: 1 }),
  'floor-tile-small-weeds-a': floor(1, 1, { symmetry: 1 }),
  'floor-tile-large-rocks': floor(2, 2, { symmetry: 1 }),
  'floor-tile-grate': floor(2, 1),
  'floor-tile-big-spikes': floor(2, 2),
  'floor-dirt-large': floor(2, 2),
  'floor-dirt-small-a': floor(1, 1),
  'floor-wood-large': floor(2, 2, { symmetry: 2 }),
  'floor-wood-small': floor(1, 1, { symmetry: 2 }),
  'floor-wood-small-dark': floor(1, 1, { symmetry: 2 }),
  // A raised ledge block, one cell; the front face is towards +z.
  'floor-foundation-front': floor(1, 1, { symmetry: 1, height: 1 }),
  'floor-foundation-corner': floor(1, 1, { symmetry: 1, height: 1 }),
  wall: KAYKIT_WALL,
  'wall-cracked': KAYKIT_WALL,
  'wall-broken': KAYKIT_WALL,
  'wall-scaffold': KAYKIT_WALL,
  'wall-sloped': KAYKIT_WALL,
  'wall-pillar': KAYKIT_WALL,
  'wall-shelves': { ...KAYKIT_WALL, symmetry: 1 },
  // Half as long: one edge, authored from its end (x 0..1.5).
  'wall-half': { slot: 'wall', footprint: [1, 0], height: 1, symmetry: 2, los: wallLos(1), base: { turns: 0, offset: [-0.75, 0, 0] } },
  // An open archway: the sides block, the middle is open.
  'wall-arched': { ...KAYKIT_WALL, los: openingLos(2) },
  'wall-doorway': { slot: 'door', footprint: [2, 0], height: 1, symmetry: 2, los: openingLos(2, 'door'), leaf: true },
  // A portcullis: closed it blocks like a door.
  'wall-gated': { slot: 'door', footprint: [2, 0], height: 1, symmetry: 2, los: openingLos(2, 'door') },
  'wall-window-open': { slot: 'window', footprint: [2, 0], height: 1, symmetry: 2, los: openingLos(2, 'window') },
  'wall-window-closed': { slot: 'window', footprint: [2, 0], height: 1, symmetry: 2, los: openingLos(2, 'window') },
  'wall-archedwindow-gated': { slot: 'window', footprint: [2, 0], height: 1, symmetry: 2, los: openingLos(2, 'window') },
  'wall-corner': { slot: 'corner', footprint: [0, 0], height: 1, symmetry: 1, ...arms(['W', 'S'], 1) },
  'wall-tsplit': { slot: 'corner', footprint: [0, 0], height: 1, symmetry: 1, ...arms(['E', 'W', 'S'], 1) },
  'wall-crossing': { slot: 'corner', footprint: [0, 0], height: 1, symmetry: 4, ...arms(['E', 'N', 'W', 'S'], 1) },
  // Decor on a vertex: no join arms, so the wall paint never picks them.
  'wall-corner-small': { slot: 'corner', footprint: [0, 0], height: 1, symmetry: 1, los: [{ a: [-0.5, 0], b: [0, 0] }, { a: [0, 0], b: [0, 0.5] }] },
  'wall-endcap': { slot: 'corner', footprint: [0, 0], height: 1, symmetry: 1, los: [{ a: [0, 0], b: [0.53, 0] }] },
  pillar: { slot: 'pillar', footprint: [0, 0], height: 1, symmetry: 4, los: postLos(0.375) },
  'pillar-decorated': { slot: 'pillar', footprint: [0, 0], height: 1, symmetry: 1, los: postLos(0.375) },
  stairs: stair(2, 2, { turns: 0, offset: [0, 0, -1.5] }),
  'stairs-narrow': stair(2, 2, { turns: 0, offset: [0, 0, -1.5] }),
  'stairs-walled': stair(2, 2, { turns: 0, offset: [0, 0, -1.5] }),
  'stairs-wood': stair(2, 3, { turns: 0, offset: [0, 0, -2.25] }),
}

/* ------------------------------------------------------------------ Kenney Fantasy Town */

// The 3 m module is centred on the origin. Wall panels are slabs on the module's +x edge (x 1.2 to
// 1.5) running along z: a quarter turn and 1.5 m along z bring the line onto the canonical x axis
// with the slab on the inner (+z) side. The corner is two panels meeting at the module's (+x, +z)
// corner, so its vertex is there and its arms run 2 cells west and north. Stairs climb towards +x.
const KENNEY_EDGE = { turns: 1, offset: [0, 0, 1.5] }
const kenneyWall = (extra = {}) => ({ slot: 'wall', footprint: [2, 0], height: 1, symmetry: 1, los: wallLos(2), base: KENNEY_EDGE, ...extra })
const kenneyCorner = { slot: 'corner', footprint: [0, 0], height: 1, symmetry: 1, base: { turns: 0, offset: [-1.5, 0, -1.5] }, ...arms(['W', 'N'], 2) }
const KENNEY = {
  planks: floor(2, 2, { symmetry: 2 }),
  'planks-opening': floor(2, 2, { symmetry: 1 }),
  'planks-half': floor(1, 2, { symmetry: 2, base: { turns: 0, offset: [-0.75, 0, 0] } }),
  wall: kenneyWall(),
  'wall-wood': kenneyWall(),
  'wall-detail-cross': kenneyWall(),
  'wall-broken': kenneyWall(),
  // Half as tall: a parapet that stops feet, not eyes.
  'wall-half': kenneyWall({ los: [{ a: [-1, 0], b: [1, 0], kind: 'window' }] }),
  'balcony-wall-fence': kenneyWall({ los: [{ a: [-1, 0], b: [1, 0], kind: 'window' }] }),
  // Decor pieces on an edge that block nothing.
  'wall-arch': kenneyWall({ los: [] }),
  overhang: kenneyWall({ los: [] }),
  'wall-corner': kenneyCorner,
  'wall-wood-corner': kenneyCorner,
  'wall-doorway-square': kenneyWall({ slot: 'door', los: openingLos(2, 'door'), leaf: true }),
  'wall-doorway-round': kenneyWall({ slot: 'door', los: openingLos(2, 'door'), leaf: true }),
  'wall-wood-doorway-round': kenneyWall({ slot: 'door', los: openingLos(2, 'door'), leaf: true }),
  // The door leaf is part of the model: open, the matching doorway is drawn instead.
  'wall-door': kenneyWall({ slot: 'door', los: openingLos(2, 'door'), openAs: 'wall-doorway-square' }),
  'wall-wood-door': kenneyWall({ slot: 'door', los: openingLos(2, 'door'), openAs: 'wall-wood-doorway-round' }),
  'wall-window-glass': kenneyWall({ slot: 'window', los: openingLos(2, 'window') }),
  'wall-window-small': kenneyWall({ slot: 'window', los: openingLos(2, 'window') }),
  'wall-window-shutters': kenneyWall({ slot: 'window', los: openingLos(2, 'window') }),
  'wall-wood-window-shutters': kenneyWall({ slot: 'window', los: openingLos(2, 'window') }),
  'pillar-stone': { slot: 'pillar', footprint: [0, 0], height: 1, symmetry: 4, los: postLos(0.16) },
  'pillar-wood': { slot: 'pillar', footprint: [0, 0], height: 1, symmetry: 4, los: postLos(0.16) },
  'stairs-wood': stair(1, 2, { turns: 1, offset: [0, 0, 0] }),
  'stairs-wood-handrail': stair(1, 2, { turns: 1, offset: [0, 0, 0] }),
  'stairs-stone': stair(1, 2, { turns: 1, offset: [0, 0, 0] }),
  'stairs-wide-stone': stair(2, 2, { turns: 1, offset: [0, 0, 0] }),
  // Roofs cover one module: `roof` is a slope rising towards +x, `roof-gable` a whole gable with its
  // ridge along x.
  roof: roof(),
  'roof-window': roof(),
  'roof-corner': roof(),
  'roof-corner-inner': roof(),
  'roof-high': roof(),
  'roof-gable': roof(2),
  'roof-gable-end': roof(),
  'roof-high-gable': roof(2),
  'roof-point': roof(4),
  chimney: roof(),
}

const KITS = {
  'kaykit-dungeon': {
    title: 'KayKit Dungeon',
    module: 1,
    table: KAYKIT,
    defaults: {
      floor: 'floor-tile-large', floorSmall: 'floor-tile-small', wall: 'wall', half: 'wall-half', corner: 'wall-corner', tee: 'wall-tsplit',
      cross: 'wall-crossing', door: 'wall-doorway', window: 'wall-window-open', stair: 'stairs', pillar: 'pillar',
    },
  },
  'kenney-town': {
    title: 'Kenney Town',
    module: 2,
    table: KENNEY,
    defaults: {
      floor: 'planks', floorSmall: 'planks-half', wall: 'wall', corner: 'wall-corner', door: 'wall-door', window: 'wall-window-glass',
      stair: 'stairs-wood', pillar: 'pillar-wood', roof: 'roof', roofGable: 'roof-gable',
    },
  },
}

/* ------------------------------------------------------------------ build */

/** The slug of a catalogue entry: `builtin:kits/<kit>/<slug>.glb`. */
const slugOf = (id) => /\/([^/]+)\.glb$/.exec(id)?.[1]

export function buildManifests(catalogue, previous = {}) {
  const out = {}
  for (const [kit, def] of Object.entries(KITS)) {
    const entries = catalogue.filter((e) => e.kit === kit)
    const bySlug = new Map(entries.map((e) => [slugOf(e.id), e]))
    for (const slug of bySlug.keys()) if (!def.table[slug]) throw new Error(`kit ${kit}: no mapping for piece "${slug}"`)
    const order = (previous[kit]?.pieces ?? []).map((p) => p.id).filter((id) => bySlug.has(id))
    for (const slug of [...bySlug.keys()].sort()) if (!order.includes(slug)) order.push(slug)
    const pieces = order.map((slug) => {
      const e = bySlug.get(slug)
      const m = def.table[slug]
      const piece = { id: slug, catalogue: e.id, title: e.title, ...m, tags: e.tags }
      if (!piece.base) delete piece.base
      return piece
    })
    for (const [k, id] of Object.entries(def.defaults)) if (!pieces.some((p) => p.id === id)) throw new Error(`kit ${kit}: default ${k} "${id}" is not a piece`)
    out[kit] = { id: kit, title: def.title, version: 1, module: def.module, defaults: def.defaults, pieces }
  }
  return out
}

function main() {
  const catalogue = JSON.parse(readFileSync(path.join(LIBRARY, 'catalogue.json'), 'utf8'))
  const previous = {}
  for (const kit of Object.keys(KITS)) {
    const file = path.join(LIBRARY, 'kits', `${kit}.json`)
    if (existsSync(file)) previous[kit] = JSON.parse(readFileSync(file, 'utf8'))
  }
  const manifests = buildManifests(catalogue, previous)
  for (const [kit, m] of Object.entries(manifests)) {
    const file = path.join(LIBRARY, 'kits', `${kit}.json`)
    const { pieces, ...head } = m
    const body = JSON.stringify(head, null, 1).replace(/\n}$/, `,\n "pieces": [\n${pieces.map((p) => '  ' + JSON.stringify(p)).join(',\n')}\n ]\n}`)
    writeFileSync(file, body + '\n')
    console.log(`kit ${kit}: ${m.pieces.length} pieces -> ${path.relative(process.cwd(), file)}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()

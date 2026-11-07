/**
 * Grid kits (level design Phase 4): the manifest format, the tile cell and chunk keys, the packed
 * tile value and the placement geometry every other kit module shares. Pure: no three.js, no Yjs.
 *
 * Coordinates. Tiles sit on the scene's square grid: cell (x, z) is centred on
 * `origin + cellSize * (x, z)` (src/table/grid.ts). A *vertex* (x, z) is the north-west corner of
 * cell (x, z), at `origin + cellSize * (x - 0.5, z - 0.5)`. North is -z, east is +x. Every cell owns
 * two edges: `n`, its north edge from vertex (x, z) to (x + 1, z), and `w`, its west edge from
 * vertex (x, z) to (x, z + 1). A storey (level) is `LEVEL_CELLS` cells tall: 3 m on the 1.5 m grid.
 *
 * Slots. Where a piece lives in the document, by its manifest slot:
 *
 *   floor              -> `f`   anchored at the north-west cell of its footprint
 *   stair              -> `s`   same; climbs one level towards the piece's local north (-z)
 *   roof               -> `r`   same; drawn at the base of its level (on top of the storey below)
 *   wall, door, window -> `n`|`w`  the first edge it covers; `n` for even turns, `w` for odd
 *   corner, pillar     -> `v`   the vertex it stands on
 *
 * Canonical frames (the manifest's `los` and `arms` are given in them, in cells):
 *
 *   area pieces   origin at the footprint centre; footprint `[w, d]` along local x and z
 *   edge pieces   run along local +x, centred on the origin, `footprint[0]` cells long; their
 *                 inner face (for one-sided walls) is towards local +z
 *   vertex pieces origin on the vertex
 *
 * A turn `q` (quarter turns) rotates the canonical frame the way three.js `rotation.y = q·π/2`
 * does: local +x goes to world -z for q = 1.
 */

/** Metres per cell the built-in kits are authored for. Other grids scale the pieces. */
export const KIT_CELL = 1.5
/** Cells per storey: a level is 3 m tall on the 1.5 m grid. */
export const LEVEL_CELLS = 2
/** Cells per chunk side. A chunk holds every level of a 16×16 column. */
export const CHUNK = 16
/** Levels a tile may sit on. Level 0 is the scene floor. */
export const MIN_LEVEL = -4
export const MAX_LEVEL = 31
/** Cell coordinates stay within ±this (a 12 km board). */
export const MAX_COORD = 8191
/** Cells one `tiles.place` or `tiles.erase` may carry. */
export const MAX_TILES_PER_INTENT = 20000

export type KitSlot = 'floor' | 'wall' | 'corner' | 'pillar' | 'stair' | 'roof' | 'door' | 'window'
/** Document slot letters (see the header). */
export type CellSlot = 'f' | 's' | 'r' | 'n' | 'w' | 'v'
export const CELL_SLOTS: readonly CellSlot[] = ['f', 's', 'r', 'n', 'w', 'v']

/** A compass direction in the canonical frame: E = +x, N = -z, W = -x, S = +z. Counter-clockwise from E. */
export type Dir = 'E' | 'N' | 'W' | 'S'

/** A line-of-sight segment in a piece's canonical frame, in cells. */
export interface KitLos {
  a: [number, number]
  b: [number, number]
  /**
   * `wall` (default) blocks sight and movement. `door` blocks both while the door is closed.
   * `window` blocks movement only (a sill, bars, a fence).
   */
  kind?: 'wall' | 'door' | 'window'
}

/** One arm of a wall join: the edges it covers from its vertex in one direction. */
export interface KitArm {
  dir: Dir
  /** Edges (cells) the arm covers. */
  length: number
}

export interface KitPiece {
  /** Stable id within the kit (the GLB's slug). */
  id: string
  /** The catalogue entry this piece draws (`CatalogueEntry.id`). */
  catalogue: string
  title: string
  slot: KitSlot
  /**
   * Area pieces: cells along local x and z. Edge pieces: `[length, 0]`. Vertex pieces: `[0, 0]`.
   */
  footprint: [number, number]
  /** Storeys the piece rises through (0 for floors). */
  height: number
  /** Quarter turns after which the piece looks the same: 1 (every turn), 2 (half turn) or 4 (none). */
  symmetry: 1 | 2 | 4
  /** Gameplay walls in the canonical frame. */
  los: KitLos[]
  /** Wall joins: the arms a corner, tee or cross covers. */
  arms?: KitArm[]
  /** GLB to canonical frame: turn first, then offset (metres, at `KIT_CELL`). */
  base?: { turns: number; offset: [number, number, number] }
  /** Doorway frames: the table draws a swinging leaf in the `door` segment. */
  leaf?: boolean
  /** A door with its leaf modelled in: the piece (id) drawn while it stands open. */
  openAs?: string
  tags: string[]
}

/** Which pieces the paint tools use by default; ids into `pieces`. */
export interface KitDefaults {
  floor: string
  /** One-cell floor that fills what a bigger floor tile leaves over. */
  floorSmall?: string
  wall: string
  /** One-cell wall that fills an odd run. */
  half?: string
  corner?: string
  tee?: string
  cross?: string
  door: string
  window: string
  stair: string
  pillar?: string
  /** Sloped roof half (rises towards local +x) and the one-module gable. */
  roof?: string
  roofGable?: string
}

export interface KitManifest {
  /** Kit id, as in `CatalogueEntry.kit` ("kaykit-dungeon"). */
  id: string
  title: string
  version: 1
  /** Wall paint snaps to vertices every this many cells (2 for kits on a 3 m module). */
  module: number
  defaults: KitDefaults
  /** Append-only: a tile stores the piece's index here. */
  pieces: KitPiece[]
}

/** Built-in kits, in this order. Their ids get the same index in every scene's kit table. */
export const BUILTIN_KITS = ['kaykit-dungeon', 'kenney-town'] as const

// ------------------------------------------------------------------ keys

export interface CellAddr {
  x: number
  level: number
  z: number
  slot: CellSlot
}

/** `x,level,z,slot`. */
export function cellKey(c: CellAddr): string {
  return `${c.x},${c.level},${c.z},${c.slot}`
}

const isInt = (n: number) => Number.isInteger(n)

/** Parses and range-checks a cell key; null when it is not one. */
export function parseCellKey(key: unknown): CellAddr | null {
  if (typeof key !== 'string' || key.length > 32) return null
  const parts = key.split(',')
  if (parts.length !== 4) return null
  const [xs, ls, zs, slot] = parts as [string, string, string, string]
  if (!/^-?\d+$/.test(xs) || !/^-?\d+$/.test(ls) || !/^-?\d+$/.test(zs)) return null
  const x = Number(xs), level = Number(ls), z = Number(zs)
  if (!isInt(x) || !isInt(z) || !isInt(level)) return null
  if (Math.abs(x) > MAX_COORD || Math.abs(z) > MAX_COORD || level < MIN_LEVEL || level > MAX_LEVEL) return null
  if (!(CELL_SLOTS as readonly string[]).includes(slot)) return null
  // Canonical form only: "-0" or "01" would make two keys for one cell.
  if (cellKey({ x, level, z, slot: slot as CellSlot }) !== key) return null
  return { x, level, z, slot: slot as CellSlot }
}

/** Chunk id `cx,cz` of a cell column. */
export function chunkOf(x: number, z: number): string {
  return `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`
}

/** Chunk id of a cell key (null for a bad key). */
export function chunkOfKey(key: string): string | null {
  const c = parseCellKey(key)
  return c ? chunkOf(c.x, c.z) : null
}

export function parseChunkId(id: string): { cx: number; cz: number } | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(id)
  if (!m) return null
  return { cx: Number(m[1]), cz: Number(m[2]) }
}

// ------------------------------------------------------------------ values

export interface TileValue {
  /** Index into the scene's kit table (or an intent's `kits`). */
  kit: number
  /** Index into the kit manifest's `pieces`. */
  piece: number
  /** Quarter turns, 0..3. */
  rot: number
  /** Piece state: bit 0 = a door stands open. 0 when absent. */
  variant: number
}

export const MAX_KITS_PER_SCENE = 64
export const MAX_PIECES_PER_KIT = 4096

/** `kit:piece:rot[:variant]`. */
export function encodeTile(v: TileValue): string {
  return v.variant ? `${v.kit}:${v.piece}:${v.rot}:${v.variant}` : `${v.kit}:${v.piece}:${v.rot}`
}

export function parseTile(s: unknown): TileValue | null {
  if (typeof s !== 'string' || s.length > 24) return null
  const m = /^(\d{1,2}):(\d{1,4}):([0-3])(?::(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const kit = Number(m[1]), piece = Number(m[2]), rot = Number(m[3]), variant = m[4] === undefined ? 0 : Number(m[4])
  if (kit >= MAX_KITS_PER_SCENE || piece >= MAX_PIECES_PER_KIT || variant > 15) return null
  if (encodeTile({ kit, piece, rot, variant }) !== s) return null
  return { kit, piece, rot, variant }
}

export const DOOR_OPEN = 1

// ------------------------------------------------------------------ the scene's tiles, as mirrored

/** The tiles of one scene as plain data: the kit table and chunk -> cell key -> value. */
export interface SceneTiles {
  /** Kit ids by index (holes are unused indices). */
  kits: (string | null)[]
  chunks: Record<string, Record<string, string>>
}

/** Index of `kit` in a scene kit table, or the index it would get when added. */
export function kitIndexFor(table: readonly (string | null)[], kit: string): { index: number; added: boolean } {
  const at = table.indexOf(kit)
  if (at >= 0) return { index: at, added: false }
  const builtin = (BUILTIN_KITS as readonly string[]).indexOf(kit)
  if (builtin >= 0 && !table[builtin]) return { index: builtin, added: true }
  for (let i = BUILTIN_KITS.length; i < MAX_KITS_PER_SCENE; i++) if (!table[i]) return { index: i, added: true }
  return { index: -1, added: false }
}

/** The level a height falls on: the storey whose base is at or just below it (a quarter storey of slack). */
export function levelOfHeight(y: number, floorY: number, cellSize: number): number {
  const h = LEVEL_CELLS * cellSize
  return Math.floor((y - floorY) / h + 0.25)
}

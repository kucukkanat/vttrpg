/**
 * Gameplay walls of kit tiles, per level: each piece's manifest `los` segments turned and placed
 * in world space. Walls block sight and movement, closed doors too, windows only movement. They
 * join the same line-of-sight pipeline as drawn walls (vision.ts, walls.ts), but only for tokens
 * on the same level. Pure.
 */
import type { GridSpec } from '@/core/geometry'
import { DOOR_OPEN, parseCellKey, parseTile, pieceCentre, turn, type SceneTiles } from '@/core/kits'
import type { Pt2, WallSegment } from '../segments'
import type { PieceLookup } from './manifests'

export interface KitDoor {
  /** Cell key of the door tile. */
  key: string
  level: number
  /** The door's opening in world space. */
  a: Pt2
  b: Pt2
  open: boolean
  /** The piece draws no leaf of its own: the table adds a swinging one. */
  leaf: boolean
}

export interface KitWalls {
  /** Blocks sight (and movement). */
  sight: WallSegment[]
  /** Blocks movement only (windows, parapets). */
  move: WallSegment[]
  doors: KitDoor[]
}

export const EMPTY_KIT_WALLS: KitWalls = { sight: [], move: [], doors: [] }

type Grid = Pick<GridSpec, 'cellSize' | 'origin'>

/** World point of a canonical-frame point of a piece centred at `centre` (cell units) turned `rot`. */
function toWorld(grid: Grid, centre: [number, number], rot: number, p: readonly [number, number]): Pt2 {
  const [dx, dz] = turn(p, rot)
  return { x: grid.origin.x + grid.cellSize * (centre[0] + dx), z: grid.origin.z + grid.cellSize * (centre[1] + dz) }
}

/** Adds one chunk's walls on `level` to `out`. */
export function chunkWalls(cells: Record<string, string>, level: number, lookup: PieceLookup, grid: Grid, out: KitWalls): void {
  for (const key in cells) {
    const c = parseCellKey(key)
    if (!c || c.level !== level) continue
    const t = parseTile(cells[key])
    const found = t ? lookup(t.kit, t.piece) : null
    if (!t || !found || !found.piece.los.length) continue
    const { piece } = found
    const centre = pieceCentre(piece, c, t.rot)
    const open = (t.variant & DOOR_OPEN) !== 0
    for (const seg of piece.los) {
      const a = toWorld(grid, centre, t.rot, seg.a)
      const b = toWorld(grid, centre, t.rot, seg.b)
      if (a.x === b.x && a.z === b.z) continue
      const kind = seg.kind ?? 'wall'
      if (kind === 'wall') out.sight.push({ a, b })
      else if (kind === 'window') out.move.push({ a, b })
      else {
        out.doors.push({ key, level, a, b, open, leaf: !!piece.leaf })
        if (!open) out.sight.push({ a, b })
      }
    }
  }
}

/** Every kit wall of a scene on `level`. */
export function kitWalls(tiles: SceneTiles | undefined, level: number, lookup: PieceLookup, grid: Grid): KitWalls {
  if (!tiles) return EMPTY_KIT_WALLS
  const out: KitWalls = { sight: [], move: [], doors: [] }
  for (const id in tiles.chunks) chunkWalls(tiles.chunks[id]!, level, lookup, grid, out)
  return out
}

/** The levels a scene's tiles use, ascending (0 always included). */
export function tileLevels(tiles: SceneTiles | undefined): number[] {
  const set = new Set<number>([0])
  for (const id in tiles?.chunks ?? {}) for (const key in tiles!.chunks[id]!) {
    const c = parseCellKey(key)
    if (c) set.add(c.level)
  }
  return [...set].sort((a, b) => a - b)
}

/**
 * Storeys: which level a token stands on, where it stands when moved, what the cutaway hides,
 * and the level part of fog keys. Pure.
 *
 * A token's level comes from its height (`position.y`, see `levelOfHeight`). Level 0 is the
 * scene floor, so tokens of scenes without kit tiles are all on level 0 and nothing changes for
 * them: fog keys, walls and sight stay as they were.
 */
import type { GridSpec } from '@/core/geometry'
import { LEVEL_CELLS, dirVec, levelBase, levelOfHeight, pieceCentre, turnDir, turnedFootprint } from '@/core/kits'
import type { Occupancy } from './occupancy'

/** How far above a kit floor's base a token stands (the tiles' own thickness, roughly). */
export const FLOOR_LIFT = 0.12

/** Fog and sight key of a cell on a level: level 0 keeps the plain `q,r` of single-level scenes. */
export function levelCellKey(cellKey: string, level: number): string {
  return level === 0 ? cellKey : `${cellKey},${level}`
}

/** A cell set keyed by `levelCellKey`, read as the plain keys of one level. */
export function levelView(set: { has(key: string): boolean }, level: number): { has(key: string): boolean } {
  return level === 0 ? set : { has: (k) => set.has(levelCellKey(k, level)) }
}

export interface StandSpot {
  level: number
  y: number
  /** Standing on a stair (half-way up it). */
  stair: boolean
}

type Grid = Pick<GridSpec, 'cellSize'>

/**
 * Where a token moved to cell (x, z) stands. From a stair it may step off the top onto the floor
 * of the level above; otherwise it stays on the highest floor (or stair) at or below `maxLevel`
 * (its own level, or the cutaway the GM set), down to the scene floor.
 */
export function standAt(occ: Occupancy, from: { level: number; stair: boolean; x: number; z: number }, cell: { x: number; z: number }, maxLevel: number, floorY: number, grid: Grid): StandSpot {
  const h = LEVEL_CELLS * grid.cellSize
  const top = Math.max(from.level, maxLevel)
  if (from.stair) {
    // Stepping off the high end of the stair: up onto the next level's floor.
    const s = occ.cell(from.level, from.x, from.z, 's')
    if (s && occ.cell(from.level + 1, cell.x, cell.z, 'f')) {
      const [cx, cz] = pieceCentre(s.piece, s.at, s.value.rot)
      const [w, d] = turnedFootprint(s.piece, s.value.rot)
      const [ux, uz] = dirVec(turnDir('N', s.value.rot))
      const reach = Math.abs(ux) * (w / 2) + Math.abs(uz) * (d / 2)
      if ((cell.x - cx) * ux + (cell.z - cz) * uz > reach - 0.01) return { level: from.level + 1, y: levelBase(from.level + 1, floorY, grid.cellSize) + FLOOR_LIFT, stair: false }
    }
  }
  for (let level = Math.min(top, 31); level >= 1; level--) {
    if (occ.cell(level, cell.x, cell.z, 's')) return { level, y: levelBase(level, floorY, grid.cellSize) + h / 2, stair: true }
    if (occ.cell(level, cell.x, cell.z, 'f')) return { level, y: levelBase(level, floorY, grid.cellSize) + FLOOR_LIFT, stair: false }
  }
  if (occ.cell(0, cell.x, cell.z, 's')) return { level: 0, y: floorY + h / 2, stair: true }
  return { level: 0, y: floorY, stair: false }
}

/** The level a token is on, from its stored height. */
export function tokenLevel(y: number | undefined, floorY: number, grid: Grid): number {
  return y === undefined ? 0 : Math.max(0, levelOfHeight(y, floorY, grid.cellSize))
}

/** Whether a token at height `y` is half-way up a stair. */
export function onStair(y: number | undefined, floorY: number, grid: Grid): boolean {
  if (y === undefined) return false
  const h = LEVEL_CELLS * grid.cellSize
  const f = ((y - floorY) / h) % 1
  return f > 0.3 && f < 0.7
}

/** The height a token is drawn at: its stored height off the scene floor, else the floor. */
export function tokenDrawY(y: number | undefined, floorY: number, grid: Grid): number {
  if (y === undefined) return floorY
  return y > floorY + 0.25 * LEVEL_CELLS * grid.cellSize ? y : floorY
}

/** Cutaway: the level above which tiles, props and tokens are hidden (Infinity: nothing hidden). */
export function effectiveCut(manual: number | null, selectedLevel: number | null, building: number | null): number {
  if (manual !== null) return manual
  if (selectedLevel !== null) return selectedLevel
  if (building !== null) return building
  return Infinity
}

/** A tile on `level` is drawn under cutaway `cut`. */
export const tileVisible = (level: number, cut: number) => level <= cut

/** A prop or token at height `y` is drawn under cutaway `cut` (it starts below the next level's base). */
export function heightVisible(y: number, cut: number, floorY: number, grid: Grid): boolean {
  if (cut === Infinity) return true
  return y < levelBase(cut + 1, floorY, grid.cellSize) - 0.05
}

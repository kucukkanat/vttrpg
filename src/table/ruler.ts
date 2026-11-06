/**
 * Ruler maths on the XZ plane. Pure; no three.js.
 *
 * A measurement runs between two floor points snapped to cell centres. Its length is counted in
 * grid steps the way movement is: Chebyshev cells on a square grid (a diagonal costs one), hex
 * steps on a hex grid, straight-line cell lengths (one decimal) when the scene has no grid. The
 * label adds the pack's unit: feet for dnd5e (5 ft a cell), nothing for mausritter (cells are the
 * unit), metres otherwise (`cellSize` is in metres).
 */
import type { GridSpec } from '@/core/geometry'
import { cellDistance, snapToCell, worldToCell } from './grid'

export interface RulerPoint { x: number; z: number }

export interface Measurement {
  from: RulerPoint
  to: RulerPoint
  /** Grid steps between the endpoints (see module comment). */
  steps: number
  /** "6 cells · 30 ft / 9 m" */
  label: string
}

/** Feet per cell for packs that measure in feet. */
const FEET_PER_CELL: Record<string, number> = { dnd5e: 5 }
/** Packs whose only unit of distance is the cell. */
const CELLS_ONLY = new Set(['mausritter'])

/** Snap a floor point to the centre of its cell; a scene without a grid leaves it where it is. */
export function snapRulerPoint(grid: GridSpec, x: number, z: number): RulerPoint {
  const s = snapToCell(grid, x, z)
  return { x: s.x, z: s.z }
}

/** Distance between two floor points in grid steps. */
export function rulerSteps(grid: GridSpec, a: RulerPoint, b: RulerPoint): number {
  if (grid.type === 'none') return Math.round((Math.hypot(b.x - a.x, b.z - a.z) / grid.cellSize) * 10) / 10
  return cellDistance(grid, worldToCell(grid, a.x, a.z), worldToCell(grid, b.x, b.z))
}

/** Integers plain, everything else with one decimal: 6, 2.5, 0.1. */
export function formatQuantity(v: number): string {
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/**
 * The ruler's text for `steps` on this grid: "6 cells · 30 ft / 9 m" (dnd5e), "6 cells"
 * (mausritter), "6 cells · 9 m" (any other pack, or none). Hex grids count hexes.
 */
export function rulerLabel(steps: number, grid: GridSpec, pack?: string | null): string {
  const one = steps === 1
  const unit = grid.type === 'hex' ? (one ? 'hex' : 'hexes') : one ? 'cell' : 'cells'
  const cells = `${formatQuantity(steps)} ${unit}`
  if (pack && CELLS_ONLY.has(pack)) return cells
  const metres = `${formatQuantity(steps * grid.cellSize)} m`
  const feet = pack ? FEET_PER_CELL[pack] : undefined
  if (feet) return `${cells} · ${formatQuantity(steps * feet)} ft / ${metres}`
  return `${cells} · ${metres}`
}

/** Snap both ends and measure. */
export function measure(grid: GridSpec, from: RulerPoint, to: RulerPoint, pack?: string | null): Measurement {
  const a = snapRulerPoint(grid, from.x, from.z)
  const b = snapRulerPoint(grid, to.x, to.z)
  const steps = rulerSteps(grid, a, b)
  return { from: a, to: b, steps, label: rulerLabel(steps, grid, pack) }
}

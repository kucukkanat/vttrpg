/**
 * How far a dragged token goes. Pure; no three.js.
 *
 * The distance is the ruler's (ruler.ts): Chebyshev cells on a square grid, hex steps on a hex grid,
 * straight-line cells without a grid, labelled with the pack's units plus metres ("4 cells · 6 m",
 * "4 cells · 20 ft / 6 m"). `pathCells` lists the cells of the straight line between the two ends,
 * one per step, for tinting the path on the floor.
 */
import type { Cell, GridSpec } from '@/core/geometry'
import { axialRound, cellDistance, worldToCell } from './grid'
import { formatQuantity, measure, type Measurement, type RulerPoint } from './ruler'

/**
 * Distance and label from where the drag started to the ghost. Unlike the ruler the label always
 * carries metres, even for packs that count in cells only ("3 cells · 4.5 m").
 */
export function moveMeasure(grid: GridSpec, from: RulerPoint, to: RulerPoint, pack?: string | null): Measurement {
  const m = measure(grid, from, to, pack)
  if (m.label.endsWith(' m')) return m
  return { ...m, label: `${m.label} · ${formatQuantity(m.steps * grid.cellSize)} m` }
}

// Nudge off exact .5 ties so a diagonal line picks the same side all the way along.
const EPS_Q = 1e-6
const EPS_R = 2e-6

/**
 * Cells on the straight line between the cells holding `from` and `to`, both included, in order.
 * There are `steps + 1` of them and each neighbours the next (diagonals count on a square grid).
 * Empty for a scene without a grid.
 */
export function pathCells(grid: GridSpec, from: RulerPoint, to: RulerPoint): Cell[] {
  if (grid.type === 'none') return []
  const a = worldToCell(grid, from.x, from.z)
  const b = worldToCell(grid, to.x, to.z)
  const n = cellDistance(grid, a, b)
  if (n === 0) return [a]
  const out: Cell[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const q = a.q + (b.q - a.q) * t + EPS_Q
    const r = a.r + (b.r - a.r) * t + EPS_R
    out.push(grid.type === 'hex' ? axialRound(q, r) : { q: Math.round(q) || 0, r: Math.round(r) || 0 })
  }
  return out
}

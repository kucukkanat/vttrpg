/**
 * Where to drop a cluster of new tokens: free cells spiralling out from a point, skipping cells
 * that already hold a token. Pure; mirrors the table's grid conventions (cell (0,0) is centred on
 * `grid.origin`, hex grids are axial with `cellSize` as centre-to-centre spacing).
 */
import type { Cell, GridSpec, Vec3 } from '@/core/geometry'

const SQRT3 = Math.sqrt(3)

function z0(v: number): number { return v === 0 ? 0 : v }

function axialRound(q: number, r: number): Cell {
  const sIn = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(sIn)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs - sIn)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return { q: z0(rq), r: z0(rr) }
}

/** Cell containing the world point. */
export function cellOf(grid: GridSpec, p: { x: number; z: number }): Cell {
  const s = grid.cellSize
  const dx = p.x - grid.origin.x
  const dz = p.z - grid.origin.z
  if (grid.type === 'hex') {
    const r = (dz * 2) / (SQRT3 * s)
    return axialRound(dx / s - r / 2, r)
  }
  return { q: z0(Math.round(dx / s)), r: z0(Math.round(dz / s)) }
}

/** World position of a cell centre at height `y`. */
export function cellCentre(grid: GridSpec, cell: Cell, y: number): Vec3 {
  const s = grid.cellSize
  if (grid.type === 'hex') {
    return { x: grid.origin.x + s * (cell.q + cell.r / 2), y, z: grid.origin.z + s * (SQRT3 / 2) * cell.r }
  }
  return { x: grid.origin.x + s * cell.q, y, z: grid.origin.z + s * cell.r }
}

export function cellKey(c: Cell): string { return `${c.q},${c.r}` }

/**
 * Cells in rings around `centre`: the centre first, then ring 1, ring 2... Within a ring cells are
 * ordered by distance from the centre so a cluster stays round. `maxRing` bounds the walk.
 */
export function* spiralCells(centre: Cell, maxRing = 40): Generator<Cell> {
  yield centre
  for (let k = 1; k <= maxRing; k++) {
    const ring: Cell[] = []
    for (let dq = -k; dq <= k; dq++) {
      for (let dr = -k; dr <= k; dr++) {
        if (Math.max(Math.abs(dq), Math.abs(dr)) !== k) continue
        ring.push({ q: z0(centre.q + dq), r: z0(centre.r + dr) })
      }
    }
    ring.sort((a, b) => dist2(a, centre) - dist2(b, centre))
    yield* ring
  }
}

function dist2(a: Cell, b: Cell): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return dq * dq + dr * dr
}

/**
 * `count` free cells nearest to `point`, as world positions on the floor at `point.y`. Cells
 * holding any of `occupied` are skipped. For a 'none' grid the cellSize still spaces the cluster.
 */
export function freeCellsNear(grid: GridSpec, point: Vec3, occupied: Iterable<{ x: number; z: number }>, count: number): Vec3[] {
  const taken = new Set<string>()
  for (const p of occupied) taken.add(cellKey(cellOf(grid, p)))
  const out: Vec3[] = []
  if (count <= 0) return out
  for (const cell of spiralCells(cellOf(grid, point))) {
    const key = cellKey(cell)
    if (taken.has(key)) continue
    taken.add(key)
    out.push(cellCentre(grid, cell, point.y))
    if (out.length >= count) break
  }
  return out
}

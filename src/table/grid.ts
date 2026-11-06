/**
 * Grid math on the XZ plane. Pure; no three.js.
 *
 * Square grids: `origin` is the world-space centre of cell (0,0); cells are `cellSize` wide.
 * Hex grids: pointy-top hexes in axial coordinates (q, r). `cellSize` is the distance between
 * the centres of two neighbouring hexes (the hex width across flats), so the circumradius is
 * `cellSize / sqrt(3)`. `origin` is the centre of hex (0,0).
 * A grid of type 'none' snaps nothing but still partitions space like a square grid so fog
 * and vision have cells to work with.
 */
import type { Cell, GridSpec, Vec2 } from '@/core/geometry'

const SQRT3 = Math.sqrt(3)

export function cellKey(c: Cell): string {
  return `${c.q},${c.r}`
}

export function parseCellKey(key: string): Cell | null {
  const i = key.indexOf(',')
  if (i < 0) return null
  const q = Number(key.slice(0, i))
  const r = Number(key.slice(i + 1))
  if (!Number.isInteger(q) || !Number.isInteger(r)) return null
  return { q, r }
}

/** Circumradius of a hex for the given centre-to-centre spacing. */
export function hexRadius(cellSize: number): number {
  return cellSize / SQRT3
}

/** World position (x, z) of a cell centre. */
export function cellToWorld(grid: GridSpec, cell: Cell): Vec2 {
  const s = grid.cellSize
  if (grid.type === 'hex') {
    return {
      x: grid.origin.x + s * (cell.q + cell.r / 2),
      y: grid.origin.z + s * (SQRT3 / 2) * cell.r,
    }
  }
  return { x: grid.origin.x + s * cell.q, y: grid.origin.z + s * cell.r }
}

/** Cell containing the world point (x, z). */
export function worldToCell(grid: GridSpec, x: number, z: number): Cell {
  const s = grid.cellSize
  const dx = x - grid.origin.x
  const dz = z - grid.origin.z
  if (grid.type === 'hex') {
    const r = (dz * 2) / (SQRT3 * s)
    const q = dx / s - r / 2
    return axialRound(q, r)
  }
  return { q: z0(Math.round(dx / s)), r: z0(Math.round(dz / s)) }
}

/** Normalise -0 to 0 so cell keys and deep-equality stay stable. */
function z0(v: number): number {
  return v === 0 ? 0 : v
}

/** Snap a world (x, z) to the centre of its cell. For 'none' grids the point is returned unchanged. */
export function snapToCell(grid: GridSpec, x: number, z: number): { cell: Cell; x: number; z: number } {
  const cell = worldToCell(grid, x, z)
  if (grid.type === 'none') return { cell, x, z }
  const w = cellToWorld(grid, cell)
  return { cell, x: w.x, z: w.y }
}

/** Round fractional axial coordinates to the nearest hex (via cube coordinates). */
export function axialRound(q: number, r: number): Cell {
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

/** Distance in cells. Chebyshev for square (diagonals cost 1), hex distance for hex. */
export function cellDistance(grid: GridSpec, a: Cell, b: Cell): number {
  const dq = b.q - a.q
  const dr = b.r - a.r
  if (grid.type === 'hex') return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
  return Math.max(Math.abs(dq), Math.abs(dr))
}

/**
 * Cells whose centres lie within `radius` cells (Euclidean, in world units) of the given world
 * point. The cell containing the point is always included.
 */
export function cellsWithinRadius(grid: GridSpec, x: number, z: number, radius: number): Cell[] {
  const centre = worldToCell(grid, x, z)
  const out: Cell[] = [centre]
  if (radius <= 0) return out
  const maxWorld = radius * grid.cellSize + 1e-6
  const n = Math.ceil(radius) + 1
  const span = grid.type === 'hex' ? 2 * n : n
  for (let q = centre.q - span; q <= centre.q + span; q++) {
    for (let r = centre.r - span; r <= centre.r + span; r++) {
      if (q === centre.q && r === centre.r) continue
      const w = cellToWorld(grid, { q, r })
      const dx = w.x - x
      const dz = w.y - z
      if (dx * dx + dz * dz <= maxWorld * maxWorld) out.push({ q, r })
    }
  }
  return out
}

/** Corner points (x, z) of a hex cell outline, pointy-top, starting at the top corner. */
export function hexCorners(grid: GridSpec, cell: Cell): Vec2[] {
  const c = cellToWorld(grid, cell)
  const R = hexRadius(grid.cellSize)
  const pts: Vec2[] = []
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (Math.PI / 3) * i
    pts.push({ x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) })
  }
  return pts
}

export interface Bounds2 { minX: number; minZ: number; maxX: number; maxZ: number }

/** Range of cells whose centres fall inside the bounds (inclusive, with one cell of margin). */
export function cellsInBounds(grid: GridSpec, b: Bounds2): Cell[] {
  const cells: Cell[] = []
  const corners = [
    worldToCell(grid, b.minX, b.minZ), worldToCell(grid, b.maxX, b.minZ),
    worldToCell(grid, b.minX, b.maxZ), worldToCell(grid, b.maxX, b.maxZ),
  ]
  const minQ = Math.min(...corners.map((c) => c.q)) - 1
  const maxQ = Math.max(...corners.map((c) => c.q)) + 1
  const minR = Math.min(...corners.map((c) => c.r)) - 1
  const maxR = Math.max(...corners.map((c) => c.r)) + 1
  const pad = grid.cellSize
  for (let q = minQ; q <= maxQ; q++) {
    for (let r = minR; r <= maxR; r++) {
      const w = cellToWorld(grid, { q, r })
      if (w.x < b.minX - pad || w.x > b.maxX + pad || w.y < b.minZ - pad || w.y > b.maxZ + pad) continue
      cells.push({ q, r })
    }
  }
  return cells
}

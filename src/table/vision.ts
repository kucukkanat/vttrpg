/**
 * Fog of war: which cells a set of viewers can see, and a rasteriser that turns cell states into
 * a texture the fog overlay samples. Pure; no three.js.
 */
import type { GridSpec } from '@/core/geometry'
import { cellKey, cellsWithinRadius, cellToWorld, worldToCell, type Bounds2 } from './grid'
import { hasLineOfSight, type WallSegment } from './walls'

export interface Viewer2D {
  x: number
  z: number
  /** Vision radius in cells. */
  vision: number
}

/**
 * Cells visible from any viewer: within its vision radius and with an unobstructed straight
 * line from the viewer to the cell centre. The viewer's own cell is always visible.
 */
export function computeVisibleCells(grid: GridSpec, viewers: readonly Viewer2D[], walls: readonly WallSegment[]): Set<string> {
  const out = new Set<string>()
  for (const v of viewers) {
    const from = { x: v.x, z: v.z }
    out.add(cellKey(worldToCell(grid, v.x, v.z)))
    if (v.vision <= 0) continue
    for (const cell of cellsWithinRadius(grid, v.x, v.z, v.vision)) {
      const key = cellKey(cell)
      if (out.has(key)) continue
      const c = cellToWorld(grid, cell)
      if (hasLineOfSight(from, { x: c.x, z: c.y }, walls)) out.add(key)
    }
  }
  return out
}

export const FOG_UNEXPLORED = 0
export const FOG_EXPLORED = 128
export const FOG_VISIBLE = 255

export interface FogRaster {
  /** One byte per texel: FOG_UNEXPLORED, FOG_EXPLORED or FOG_VISIBLE. Row-major, +z rows. */
  data: Uint8Array
  width: number
  height: number
  /** World rectangle covered by the texture. */
  bounds: Bounds2
}

/** Texture layout for a set of bounds; stable while bounds and grid do not change. */
export function fogRasterLayout(grid: GridSpec, bounds: Bounds2, texelsPerCell = 4): Omit<FogRaster, 'data'> {
  const texel = grid.cellSize / texelsPerCell
  const width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / texel))
  const height = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / texel))
  return { width, height, bounds }
}

/** Fill `data` (width*height bytes) with the state of the cell under each texel centre. */
export function rasterizeFog(
  grid: GridSpec,
  layout: Omit<FogRaster, 'data'>,
  visible: ReadonlySet<string>,
  explored: ReadonlySet<string>,
  data: Uint8Array = new Uint8Array(layout.width * layout.height),
): FogRaster {
  const { width, height, bounds } = layout
  const sx = (bounds.maxX - bounds.minX) / width
  const sz = (bounds.maxZ - bounds.minZ) / height
  let i = 0
  for (let row = 0; row < height; row++) {
    const z = bounds.minZ + (row + 0.5) * sz
    for (let col = 0; col < width; col++) {
      const x = bounds.minX + (col + 0.5) * sx
      const key = cellKey(worldToCell(grid, x, z))
      data[i++] = visible.has(key) ? FOG_VISIBLE : explored.has(key) ? FOG_EXPLORED : FOG_UNEXPLORED
    }
  }
  return { data, width, height, bounds }
}

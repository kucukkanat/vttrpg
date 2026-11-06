/**
 * Fits a loaded GLB to the grid. Library minis and props are authored to fit one cell, but an
 * uploaded model or a whole scene used as a mini can be any size. Tokens get their largest
 * horizontal extent scaled to exactly one cell; props are only corrected when they are clearly off
 * (wider than a cell, or so small they would vanish). The token's or prop's own `scale` stays a
 * multiplier on top of the fitted size, so "Size x1" always means one cell for a token.
 */
import { Box3, Mesh, type Object3D } from 'three'

/** Allowed footprint, in cells. Extents outside the range are scaled to the nearest bound. */
export interface FitRange { min: number; max: number }

/** A mini is exactly one cell wide at size 1. */
export const TOKEN_FIT: FitRange = { min: 1, max: 1 }
/** A prop keeps its authored size unless it is bigger than a cell or smaller than a tenth of one. */
export const PROP_FIT: FitRange = { min: 0.1, max: 1 }

const HELPER_MESH = /^(COL|FOG)_/

/**
 * Largest horizontal (x or z) extent of `object` in its own frame: children's transforms count,
 * the root's own scale does not. Scene-convention helpers (`COL_*`, `FOG_*`) and hidden meshes are
 * ignored, so a collider slab under a room does not set the size.
 */
export function horizontalExtent(object: Object3D): number {
  object.updateWorldMatrix(true, true)
  const inv = object.matrixWorld.clone().invert()
  const out = new Box3()
  const tmp = new Box3()
  object.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible || HELPER_MESH.test(o.name)) return
    const g = o.geometry
    if (!g.boundingBox) g.computeBoundingBox()
    if (!g.boundingBox) return
    tmp.copy(g.boundingBox).applyMatrix4(o.matrixWorld).applyMatrix4(inv)
    out.union(tmp)
  })
  if (out.isEmpty()) return 0
  return Math.max(out.max.x - out.min.x, out.max.z - out.min.z)
}

/** Scale factor that brings `extent` (metres) inside `range` cells of `cellSize`; 1 when nothing needs doing or the extent is unusable. */
export function fitScale(extent: number, cellSize: number, range: FitRange): number {
  if (!Number.isFinite(extent) || extent <= 1e-6 || !(cellSize > 0)) return 1
  const cells = extent / cellSize
  if (cells > range.max) return (range.max * cellSize) / extent
  if (cells < range.min) return (range.min * cellSize) / extent
  return 1
}

export function fitObjectToCell(object: Object3D, cellSize: number, range: FitRange): number {
  return fitScale(horizontalExtent(object), cellSize, range)
}

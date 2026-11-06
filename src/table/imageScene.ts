/**
 * Geometry of image-based scenes (imported battle maps). Pure; no three.js.
 *
 * A map image is a plane on the floor, `widthCells x heightCells` cells large (times the grid's
 * cell size), centred at `grid.origin + image.offset`. Map coordinates ("grid units") count from
 * the image's top-left corner, x to the right and y down, the convention of every map export
 * format (Universal VTT, Foundry). On the table the top of the image faces -Z, so map y grows
 * along +Z and the top-left corner is the world point (minX, minZ).
 *
 * New image scenes are laid out so the top-left map cell is grid cell (0,0) with the grid origin
 * at the world origin: cell (q, r) is map column q, row r, and the grid lines fall on the map's
 * own grid when `widthCells` is right.
 */
import type { Scene } from '@/core/doc'
import type { GridSpec, Vec3 } from '@/core/geometry'
import type { Bounds2 } from './grid'
import type { WallSegment } from './walls'

export type SceneImage = NonNullable<Scene['image']>

export interface ImageFrame {
  /** World centre of the image on the XZ plane. */
  cx: number
  cz: number
  /** World size in meters. */
  width: number
  height: number
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  cellSize: number
}

/** Where the image lies in the world for a scene's grid. */
export function imageFrame(grid: GridSpec, image: SceneImage): ImageFrame {
  const cellSize = grid.cellSize
  const width = image.widthCells * cellSize
  const height = image.heightCells * cellSize
  const cx = grid.origin.x + (image.offset?.x ?? 0)
  const cz = grid.origin.z + (image.offset?.z ?? 0)
  return { cx, cz, width, height, minX: cx - width / 2, minZ: cz - height / 2, maxX: cx + width / 2, maxZ: cz + height / 2, cellSize }
}

export function imageBounds(grid: GridSpec, image: SceneImage): Bounds2 {
  const f = imageFrame(grid, image)
  return { minX: f.minX, minZ: f.minZ, maxX: f.maxX, maxZ: f.maxZ }
}

/** World point of a map coordinate given in grid units from the image's top-left corner. */
export function imageGridToWorld(frame: ImageFrame, gx: number, gy: number): { x: number; z: number } {
  return { x: frame.minX + gx * frame.cellSize, z: frame.minZ + gy * frame.cellSize }
}

/** Wall segments given in map grid units, moved onto the table. */
export function imageWallsToWorld(frame: ImageFrame, walls: readonly WallSegment[]): WallSegment[] {
  return walls.map((w) => ({ a: imageGridToWorld(frame, w.a.x, w.a.z), b: imageGridToWorld(frame, w.b.x, w.b.z) }))
}

export interface ImageSceneLayout {
  widthCells: number
  heightCells: number
  /** `image.offset` for a grid whose origin is the world origin. */
  offset: Vec3
}

/**
 * Layout for a new image scene from the image's pixel size and the number of grid columns across
 * it. Rows follow from the aspect ratio and may be fractional: the image is never stretched, the
 * last row is simply cut where the image ends.
 */
export function imageSceneLayout(columns: number, pixelWidth: number, pixelHeight: number, cellSize: number): ImageSceneLayout {
  const widthCells = Math.max(1, columns)
  const heightCells = pixelWidth > 0 && pixelHeight > 0 ? (widthCells * pixelHeight) / pixelWidth : widthCells
  return layoutForCells(widthCells, heightCells, cellSize)
}

/** Layout for a map whose size in cells is already known (map exports). */
export function layoutForCells(widthCells: number, heightCells: number, cellSize: number): ImageSceneLayout {
  const w = Math.max(1e-6, widthCells)
  const h = Math.max(1e-6, heightCells)
  // Top-left cell centred on the origin: the image's top-left corner sits at (-cellSize/2, -cellSize/2).
  return { widthCells: w, heightCells: h, offset: { x: (w - 1) * cellSize / 2, y: 0, z: (h - 1) * cellSize / 2 } }
}

/** Grid for a new image scene: square cells, origin at the world origin (see `layoutForCells`). */
export function imageSceneGrid(cellSize: number, type: GridSpec['type'] = 'square'): GridSpec {
  return { type, cellSize, origin: { x: 0, y: 0, z: 0 } }
}

/** Pixels per cell implied by an image laid out `widthCells` across. */
export function pixelsPerCell(pixelWidth: number, widthCells: number): number {
  return widthCells > 0 ? pixelWidth / widthCells : pixelWidth
}

/**
 * Foundry VTT scene export (right-click a scene > Export Data). One JSON object with
 *
 *   width, height          background size in pixels
 *   grid                   { size, type, ... } (v10+) or a number of pixels per cell (v9 and older)
 *   padding                fraction of the scene added around the background (default 0.25)
 *   background.src / img   path of the background inside the Foundry data folder (not fetchable here)
 *   walls[].c              [x0, y0, x1, y1] in canvas pixels, which include the padding
 *   walls[].door / ds      0 none, 1 door, 2 secret; ds 0 closed, 1 open, 2 locked
 *   walls[].sight / sense  0 means the wall does not block sight (v10+ `sight`, older `sense`)
 *
 * Canvas pixels are turned into map grid units by removing the padding offset (sceneX / sceneY,
 * computed as Foundry does: padding times the background size, rounded up to whole cells) and
 * dividing by the grid size. Open doors and sight-transparent walls are left out. The background
 * image must be supplied separately by the user.
 */
import type { MapWall, ParsedMap } from './types'

interface FoundryWall {
  c?: number[]
  door?: number
  ds?: number
  sight?: number
  sense?: number
}

interface FoundryScene {
  name?: string
  width?: number
  height?: number
  padding?: number
  grid?: number | { size?: number; type?: number }
  gridType?: number
  background?: { src?: string | null; offsetX?: number; offsetY?: number } | string
  img?: string | null
  darkness?: number
  walls?: FoundryWall[]
}

/** True when the object looks like a Foundry scene export. */
export function isFoundryScene(json: unknown): json is FoundryScene {
  if (typeof json !== 'object' || json === null) return false
  const j = json as FoundryScene
  const hasSize = typeof j.width === 'number' && typeof j.height === 'number'
  const hasGrid = typeof j.grid === 'number' || (typeof j.grid === 'object' && j.grid !== null)
  return hasSize && (hasGrid || Array.isArray(j.walls))
}

/** Pixels per grid cell declared by the export, if any. */
export function foundryGridSize(json: FoundryScene): number | undefined {
  if (typeof json.grid === 'number' && json.grid > 0) return json.grid
  if (typeof json.grid === 'object' && json.grid && typeof json.grid.size === 'number' && json.grid.size > 0) return json.grid.size
  return undefined
}

/** Offset of the background inside the padded canvas, in pixels (Foundry's sceneX / sceneY). */
export function foundryPaddingOffset(width: number, height: number, gridSize: number, padding: number): { x: number; y: number } {
  if (!(padding > 0)) return { x: 0, y: 0 }
  return {
    x: Math.ceil((padding * width) / gridSize) * gridSize,
    y: Math.ceil((padding * height) / gridSize) * gridSize,
  }
}

/**
 * Parse a Foundry scene export. `gridSize` (pixels per cell) overrides what the file declares and
 * is required when the file does not declare one.
 */
export function parseFoundryScene(input: unknown, gridSize?: number): ParsedMap {
  const json: unknown = typeof input === 'string' ? JSON.parse(input) : input
  if (!isFoundryScene(json)) throw new Error('Not a Foundry scene export: expected width, height and grid or walls')
  const size = gridSize && gridSize > 0 ? gridSize : foundryGridSize(json)
  if (!size) throw new Error('Foundry scene: no grid size in the file; pass the pixels per cell')
  const width = json.width!
  const height = json.height!
  if (!(width > 0) || !(height > 0)) throw new Error('Foundry scene: width and height must be positive')
  const padding = typeof json.padding === 'number' ? json.padding : 0.25
  const off = foundryPaddingOffset(width, height, size, padding)
  const notes: string[] = []
  const walls: MapWall[] = []
  let openDoors = 0, transparent = 0
  for (const w of json.walls ?? []) {
    const c = w?.c
    if (!Array.isArray(c) || c.length < 4 || !c.slice(0, 4).every((v) => typeof v === 'number' && Number.isFinite(v))) continue
    if ((w.door ?? 0) > 0 && w.ds === 1) { openDoors++; continue }
    if (w.sight === 0 || (w.sight === undefined && w.sense === 0)) { transparent++; continue }
    const a = { x: (c[0]! - off.x) / size, y: (c[1]! - off.y) / size }
    const b = { x: (c[2]! - off.x) / size, y: (c[3]! - off.y) / size }
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) continue
    walls.push({ a, b })
  }
  if (openDoors) notes.push(`${openDoors} open door${openDoors === 1 ? '' : 's'} left as gaps`)
  if (transparent) notes.push(`${transparent} wall${transparent === 1 ? '' : 's'} that do not block sight skipped`)
  const gridType = typeof json.grid === 'object' && json.grid ? json.grid.type : json.gridType
  if (typeof gridType === 'number' && gridType > 1) notes.push('hex grid in the source; shown as squares')
  const src = typeof json.background === 'object' && json.background ? json.background.src : typeof json.background === 'string' ? json.background : json.img
  return {
    format: 'foundry',
    name: json.name,
    widthCells: width / size,
    heightCells: height / size,
    pixelsPerCell: size,
    pixelSize: { width, height },
    walls,
    imagePath: src ?? undefined,
    darkness: typeof json.darkness === 'number' ? Math.min(1, Math.max(0, json.darkness)) : undefined,
    notes,
  }
}

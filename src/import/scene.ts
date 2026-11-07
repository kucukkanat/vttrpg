/**
 * Build a Scene for a map image. The grid is square with its origin at the world origin and the
 * image laid out so its top-left cell is cell (0,0); walls given in map grid units are moved onto
 * the table (see src/table/imageScene.ts for the frame maths).
 */
import type { AssetRef } from '@/core/assets'
import type { Prop, Scene } from '@/core/doc'
import type { GridType } from '@/core/geometry'
import { newId, type PropId, type SceneId } from '@/core/ids'
import { segmentProp } from '@/core/partsMigration'
// Pure geometry only: the table's index also exports React components, which tests must not load.
import { imageFrame, imageSceneGrid, imageWallsToWorld, layoutForCells } from '@/table/imageScene'
import type { MapWall, ParsedMap } from './types'

export const DEFAULT_DARKNESS = 0.8

export interface ImageSceneOptions {
  name: string
  asset: AssetRef
  widthCells: number
  heightCells: number
  /** World units per cell (meters), normally the pack's grid cell size. */
  cellSize: number
  gridType?: GridType
  darkness?: number
  id?: SceneId
}

export function buildImageScene(o: ImageSceneOptions): Scene {
  const grid = imageSceneGrid(o.cellSize, o.gridType ?? 'square')
  const layout = layoutForCells(o.widthCells, o.heightCells, o.cellSize)
  const image: NonNullable<Scene['image']> = { asset: o.asset, widthCells: layout.widthCells, heightCells: layout.heightCells, offset: layout.offset }
  const scene: Scene = {
    id: o.id ?? newId<'SceneId'>(),
    name: o.name,
    image,
    grid,
    cameraMode: 'orbit',
    darkness: o.darkness ?? DEFAULT_DARKNESS,
  }
  return scene
}

/**
 * The walls and doors of a map export as invisible wall and door props on `scene`'s map image
 * (`walls` in map grid units from the image's top-left corner), standing on the floor at `y`.
 */
export function imageWallProps(scene: Pick<Scene, 'id' | 'grid' | 'image'>, walls: readonly MapWall[], opts: { y?: number; tags?: string[]; makeId?: () => PropId } = {}): Prop[] {
  if (!scene.image || !walls.length) return []
  const frame = imageFrame(scene.grid, scene.image)
  const world = imageWallsToWorld(frame, walls.map((w) => ({ a: { x: w.a.x, z: w.a.y }, b: { x: w.b.x, z: w.b.y } })))
  const makeId = opts.makeId ?? (() => newId<'PropId'>() as PropId)
  return world.map((w, i) => segmentProp({
    id: makeId(), scene: scene.id, y: opts.y ?? 0,
    a: { x: round(w.a.x), z: round(w.a.z) }, b: { x: round(w.b.x), z: round(w.b.z) },
    ...(walls[i]!.door ? { door: walls[i]!.door! } : {}),
    ...(opts.tags ? { tags: opts.tags } : {}),
  }))
}

/** Invisible wall props for world segments already on the table (detected walls), one batch. */
export function segmentWallProps(scene: Pick<Scene, 'id'>, segments: readonly { a: { x: number; z: number }; b: { x: number; z: number } }[], opts: { y?: number; tags?: string[]; makeId?: () => PropId } = {}): Prop[] {
  const makeId = opts.makeId ?? (() => newId<'PropId'>() as PropId)
  return segments.filter((s) => Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z) > 1e-6)
    .map((s) => segmentProp({ id: makeId(), scene: scene.id, a: s.a, b: s.b, y: opts.y ?? 0, ...(opts.tags ? { tags: opts.tags } : {}) }))
}

/** Scene for a parsed map export whose image has been imported as `asset`. */
export function sceneFromParsedMap(parsed: ParsedMap, asset: AssetRef, opts: { cellSize: number; gridType?: GridType; name?: string; darkness?: number; id?: SceneId }): Scene {
  return buildImageScene({
    name: opts.name ?? parsed.name ?? asset.name?.replace(/\.[^.]+$/, '') ?? 'Imported map',
    asset,
    widthCells: parsed.widthCells,
    heightCells: parsed.heightCells,
    cellSize: opts.cellSize,
    gridType: opts.gridType,
    darkness: opts.darkness ?? parsed.darkness,
    id: opts.id,
  })
}

/** Trim float noise so the document stays small and deep-equal across clients. */
function round(v: number): number {
  const r = Math.round(v * 1e4) / 1e4
  return r === 0 ? 0 : r
}

/**
 * What the mounted table tells code outside the canvas about kit tiles, without that code loading
 * the kit modules: the controller asks it which kit walls block a player's move. Empty until a
 * table is mounted (then kit walls block nothing, as before kits existed).
 */
import type { SceneId } from '@/core/ids'
import type { WallSegment } from '../segments'

export const kitRuntime: {
  /** Kit walls that block movement on a level of a scene (sight walls, windows, closed doors). */
  moveWalls?: (scene: SceneId, level: number) => readonly WallSegment[]
} = {}

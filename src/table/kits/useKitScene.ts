/**
 * The kit side of a table scene, computed once per canvas and shared through the table context:
 * the scene's tiles, the piece lookup, the occupancy, walls per level and the cutaway.
 */
import { useEffect, useMemo } from 'react'
import type { GridSpec } from '@/core/geometry'
import type { SceneId } from '@/core/ids'
import type { SceneTiles } from '@/core/kits'
import { useGame } from '@/state/store'
import { useBuildUi } from '../build/buildState'
import type { WallSegment } from '../segments'
import { chunkWalls, EMPTY_KIT_WALLS, tileLevels, type KitWalls } from './kitWalls'
import { useKitUi } from './kitState'
import { effectiveCut, tokenLevel } from './levels'
import { loadSceneKits, pieceLookup, useKitManifests, type PieceLookup } from './manifests'
import { sceneOccupancy, type Occupancy } from './occupancy'

export interface KitScene {
  tiles: SceneTiles | undefined
  lookup: PieceLookup
  occ: Occupancy
  /** Levels with tiles (0 always). */
  levels: number[]
  /** Kit walls, doors and windows on a level. */
  wallsAt(level: number): KitWalls
  /** Everything above this level is hidden (Infinity: nothing). */
  cut: number
  /** The level fog and the board show when one has to be picked: the cut, else 0. */
  viewLevel: number
}

const EMPTY_TILES: SceneTiles = { kits: [], chunks: {} }
const wallCache = new WeakMap<Record<string, string>, { lookup: PieceLookup; key: string; byLevel: Map<number, KitWalls> }>()

export function useKitScene(sceneId: SceneId, grid: GridSpec, floorY: number): KitScene {
  const tiles = useGame((s) => s.tiles[sceneId])
  const manifests = useKitManifests((s) => s.manifests)
  useEffect(() => loadSceneKits(tiles), [tiles?.kits]) // eslint-disable-line react-hooks/exhaustive-deps
  const table = tiles?.kits ?? EMPTY_TILES.kits
  const tableKey = table.join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lookup = useMemo(() => pieceLookup(table, manifests), [tableKey, manifests])
  const occ = useMemo(() => sceneOccupancy(tiles, lookup), [tiles, lookup])
  const levels = useMemo(() => tileLevels(tiles), [tiles])
  const gridKey = `${grid.cellSize},${grid.origin.x},${grid.origin.z}`
  const wallsAt = useMemo(() => {
    const memo = new Map<number, KitWalls>()
    return (level: number): KitWalls => {
      const hit = memo.get(level)
      if (hit) return hit
      if (!tiles) return EMPTY_KIT_WALLS
      const out: KitWalls = { sight: [], move: [], doors: [] }
      for (const id in tiles.chunks) {
        const rec = tiles.chunks[id]!
        let c = wallCache.get(rec)
        if (!c || c.lookup !== lookup || c.key !== gridKey) { c = { lookup, key: gridKey, byLevel: new Map() }; wallCache.set(rec, c) }
        let w = c.byLevel.get(level)
        if (!w) { w = { sight: [], move: [], doors: [] }; chunkWalls(rec, level, lookup, grid, w); c.byLevel.set(level, w) }
        if (w.sight.length) out.sight.push(...w.sight)
        if (w.move.length) out.move.push(...w.move)
        if (w.doors.length) out.doors.push(...w.doors)
      }
      memo.set(level, out)
      return out
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, lookup, gridKey])

  const manual = useKitUi((s) => s.cutaway)
  const buildLevel = useKitUi((s) => s.level)
  const kitTool = useKitUi((s) => s.tool)
  const building = useBuildUi((s) => s.tool === 'kit') && kitTool !== null
  const selectedY = useGame((s) => {
    const t = s.selectedToken ? s.tokens[s.selectedToken] : undefined
    return t && t.scene === sceneId ? t.position.y : null
  })
  const hasLevels = levels.length > 1 || levels[0] !== 0
  const selectedLevel = selectedY === null ? null : tokenLevel(selectedY, floorY, grid)
  const cut = hasLevels || manual !== null ? effectiveCut(manual, selectedLevel, building ? buildLevel : null) : Infinity
  const viewLevel = cut === Infinity ? 0 : Math.max(0, cut)
  return useMemo(() => ({ tiles, lookup, occ, levels, wallsAt, cut, viewLevel }), [tiles, lookup, occ, levels, wallsAt, cut, viewLevel])
}

/** Sight walls for viewers on `level`: the scene's own walls belong to level 0. */
export function sightWallsAt(kit: KitScene | null | undefined, level: number, base: readonly WallSegment[]): readonly WallSegment[] {
  const k = kit ? kit.wallsAt(level).sight : []
  if (level !== 0) return k
  return k.length ? [...base, ...k] : base
}

/** Movement walls on `level`: sight walls plus windows and parapets. */
export function moveWallsAt(kit: KitScene | null | undefined, level: number, base: readonly WallSegment[]): readonly WallSegment[] {
  const sight = sightWallsAt(kit, level, base)
  const move = kit ? kit.wallsAt(level).move : []
  return move.length ? [...sight, ...move] : sight
}

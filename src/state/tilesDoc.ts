/**
 * The `tiles` part of the Yjs document (see `GameDocShape.tiles`): reading it as plain
 * `SceneTiles`, applying the tile intents, and writing an imported copy back.
 *
 *   tiles: Y.Map<sceneId, Y.Map>        one map per scene with tiles
 *     kits: (string | null)[]           the scene's kit table (a plain value, append-only)
 *     "<cx>,<cz>": Y.Map<string>        one map per 16×16 chunk: cell key -> tile value
 *
 * Cell-level last writer wins: two builders painting in one chunk only overwrite each other on
 * the very same cell.
 */
import * as Y from 'yjs'
import type { SceneId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { chunkOf, DOOR_OPEN, encodeTile, kitIndexFor, parseCellKey, parseTile, type SceneTiles } from '@/core/kits'

export const KITS_KEY = 'kits'

type SceneMap = Y.Map<unknown>

export function tilesRoot(doc: Y.Doc): Y.Map<SceneMap> {
  return doc.getMap<SceneMap>('tiles')
}

function readTable(scene: SceneMap): (string | null)[] {
  const t = scene.get(KITS_KEY)
  return Array.isArray(t) ? t.map((k) => (typeof k === 'string' ? k : null)) : []
}

/** One chunk map as a plain record. */
export function readChunk(chunk: unknown): Record<string, string> {
  if (!(chunk instanceof Y.Map)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of chunk.entries()) if (typeof v === 'string') out[k] = v
  return out
}

/** A scene's tiles as plain data. */
export function readSceneTiles(scene: unknown): SceneTiles {
  if (!(scene instanceof Y.Map)) return { kits: [], chunks: {} }
  const chunks: Record<string, Record<string, string>> = {}
  for (const [k, v] of scene.entries()) if (k !== KITS_KEY && v instanceof Y.Map) chunks[k] = readChunk(v)
  return { kits: readTable(scene), chunks }
}

/** Every scene's tiles as plain data. */
export function readAllTiles(doc: Y.Doc): Record<SceneId, SceneTiles> {
  const out: Record<string, SceneTiles> = {}
  for (const [id, scene] of tilesRoot(doc).entries()) out[id] = readSceneTiles(scene)
  return out as Record<SceneId, SceneTiles>
}

function sceneMap(doc: Y.Doc, scene: string): SceneMap {
  const root = tilesRoot(doc)
  let m = root.get(scene)
  if (!(m instanceof Y.Map)) {
    m = new Y.Map<unknown>()
    root.set(scene, m)
  }
  return m
}

function chunkMap(scene: SceneMap, id: string, create: boolean): Y.Map<string> | null {
  const c = scene.get(id)
  if (c instanceof Y.Map) return c as Y.Map<string>
  if (!create) return null
  const m = new Y.Map<string>()
  scene.set(id, m)
  return m
}

/** Apply a tile intent to the document (inside the caller's transaction). Assumes it was validated. */
export function applyTilesIntent(doc: Y.Doc, intent: Intent): void {
  switch (intent.type) {
    case 'tiles.place': {
      const scene = sceneMap(doc, intent.scene)
      const table = readTable(scene)
      let tableChanged = false
      const remap = intent.kits.map((kit) => {
        const { index, added } = kitIndexFor(table, kit)
        if (added && index >= 0) {
          while (table.length <= index) table.push(null)
          table[index] = kit
          tableChanged = true
        }
        return index
      })
      if (tableChanged) scene.set(KITS_KEY, table)
      intent.keys.forEach((key, i) => {
        const c = parseCellKey(key)
        if (!c) return
        const raw = intent.values[i] ?? ''
        const chunk = chunkMap(scene, chunkOf(c.x, c.z), raw !== '')
        if (raw === '') { if (chunk?.has(key)) chunk.delete(key); return }
        const t = parseTile(raw)
        const kit = t ? remap[t.kit] : undefined
        if (!t || kit === undefined || kit < 0) return
        const value = encodeTile({ ...t, kit })
        if (chunk!.get(key) !== value) chunk!.set(key, value)
      })
      break
    }
    case 'tiles.erase': {
      const scene = tilesRoot(doc).get(intent.scene)
      if (!(scene instanceof Y.Map)) return
      for (const key of intent.keys) {
        const c = parseCellKey(key)
        if (!c) continue
        const chunk = chunkMap(scene, chunkOf(c.x, c.z), false)
        if (chunk?.has(key)) chunk.delete(key)
      }
      break
    }
    case 'tiles.door': {
      const scene = tilesRoot(doc).get(intent.scene)
      const c = parseCellKey(intent.key)
      if (!(scene instanceof Y.Map) || !c) return
      const chunk = chunkMap(scene, chunkOf(c.x, c.z), false)
      const t = parseTile(chunk?.get(intent.key))
      if (!chunk || !t) return
      const open = (t.variant & DOOR_OPEN) !== 0
      if (open === intent.open) return
      chunk.set(intent.key, encodeTile({ ...t, variant: intent.open ? t.variant | DOOR_OPEN : t.variant & ~DOOR_OPEN }))
      break
    }
    default:
      break
  }
}

/** Writes plain tiles (an imported game file) into the document as nested maps. */
export function writeTilesJson(doc: Y.Doc, value: unknown): void {
  if (!value || typeof value !== 'object') return
  for (const [sceneId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const tiles = raw as Partial<SceneTiles>
    const scene = sceneMap(doc, sceneId)
    if (Array.isArray(tiles.kits)) scene.set(KITS_KEY, tiles.kits.map((k) => (typeof k === 'string' ? k : null)))
    for (const [chunkId, cells] of Object.entries(tiles.chunks ?? {})) {
      if (!cells || typeof cells !== 'object') continue
      const chunk = chunkMap(scene, chunkId, true)!
      for (const [k, v] of Object.entries(cells)) {
        const c = parseCellKey(k)
        if (c && chunkOf(c.x, c.z) === chunkId && parseTile(v)) chunk.set(k, v)
      }
    }
  }
}

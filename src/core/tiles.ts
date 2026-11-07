/**
 * Tile intents (`tiles.place`, `tiles.erase`, `tiles.door`): shape and reference checks, and the
 * conversions between an intent's own kit list and a scene's kit table. Pure.
 *
 * An intent carries its kits by id (`kits`) and its values index into that list, because the
 * sender cannot know which index the applying writer will give a kit it adds to the scene. Apply
 * maps them onto the scene's table (see `src/state/tilesDoc.ts`).
 */
import type { GameDocShape } from './doc'
import type { Intent } from './intents'
import { encodeTile, MAX_TILES_PER_INTENT, parseCellKey, parseTile, chunkOf, type SceneTiles } from './kits'

const KIT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_KITS_PER_INTENT = 16

const duplicates = (keys: readonly string[]) => new Set(keys).size !== keys.length

function badKeys(keys: unknown, what: string): string | null {
  if (!Array.isArray(keys) || keys.length === 0) return `nothing to ${what}`
  if (keys.length > MAX_TILES_PER_INTENT) return `too many tiles in one ${what} (max ${MAX_TILES_PER_INTENT})`
  for (const k of keys) if (!parseCellKey(k)) return 'not a tile cell'
  return duplicates(keys as string[]) ? 'the same cell twice in one batch' : null
}

/**
 * Null when `intent` is a valid tile intent or not a tile intent at all. Run for everyone (the
 * engine refuses players separately, except `tiles.door` where the scene lets them).
 */
export function validateTilesIntent(intent: Intent, doc: Pick<GameDocShape, 'scenes' | 'tiles'>): string | null {
  switch (intent.type) {
    case 'tiles.place': {
      if (!doc.scenes?.[intent.scene]) return 'unknown scene'
      const bad = badKeys(intent.keys, 'place')
      if (bad) return bad
      if (!Array.isArray(intent.values) || intent.values.length !== intent.keys.length) return 'one value per cell'
      if (!Array.isArray(intent.kits) || intent.kits.length > MAX_KITS_PER_INTENT) return 'kits must be a short list'
      if (intent.kits.some((k) => typeof k !== 'string' || !KIT_ID.test(k)) || duplicates(intent.kits)) return 'bad kit id'
      for (const v of intent.values) {
        if (v === '') continue
        const t = parseTile(v)
        if (!t) return 'not a tile value'
        if (t.kit >= intent.kits.length) return 'tile names a kit the intent does not list'
      }
      return null
    }
    case 'tiles.erase':
      if (!doc.scenes?.[intent.scene]) return 'unknown scene'
      return badKeys(intent.keys, 'erase')
    case 'tiles.door': {
      if (!doc.scenes?.[intent.scene]) return 'unknown scene'
      const c = parseCellKey(intent.key)
      if (!c || (c.slot !== 'n' && c.slot !== 'w')) return 'not a wall edge'
      if (typeof intent.open !== 'boolean') return 'open must be true or false'
      return readTile(doc.tiles?.[intent.scene], intent.key) ? null : 'no door there'
    }
    default:
      return null
  }
}

/** The stored value at a cell key of a scene's tiles, if any. */
export function readTile(tiles: SceneTiles | undefined, key: string): string | undefined {
  const c = parseCellKey(key)
  if (!tiles || !c) return undefined
  return tiles.chunks[chunkOf(c.x, c.z)]?.[key]
}

/**
 * Scene-table values as an intent's `kits` and `values`: the kits the values use, compacted, with
 * the values renumbered into that list. `null` values (cells to clear) become `''`.
 */
export function toIntentValues(values: readonly (string | null)[], table: readonly (string | null)[]): { kits: string[]; values: string[] } {
  const kits: string[] = []
  const map = new Map<number, number>()
  const out = values.map((v) => {
    if (v === null) return ''
    const t = parseTile(v)
    const id = t ? table[t.kit] : null
    if (!t || !id) return ''
    let i = map.get(t.kit)
    if (i === undefined) { i = kits.length; kits.push(id); map.set(t.kit, i) }
    return encodeTile({ ...t, kit: i })
  })
  return { kits, values: out }
}

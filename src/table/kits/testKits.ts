/**
 * Test helpers: the shipped kit manifests read from disk, and tiles built from a plan. Imported by
 * tests only (node:fs).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chunkOf, encodeTile, parseCellKey, parseTile, type KitManifest, type SceneTiles } from '@/core/kits'
import { pieceLookup, type PieceLookup } from './manifests'
import type { TilePlan } from './autoJoin'

export function shippedKit(id: string): KitManifest {
  return JSON.parse(readFileSync(resolve(__dirname, `../../../public/library/kits/${id}.json`), 'utf8')) as KitManifest
}

export const KAYKIT = shippedKit('kaykit-dungeon')
export const KENNEY = shippedKit('kenney-town')

export function emptyTiles(): SceneTiles {
  return { kits: ['kaykit-dungeon', 'kenney-town'], chunks: {} }
}

export function lookupFor(tiles: SceneTiles): PieceLookup {
  return pieceLookup(tiles.kits, { 'kaykit-dungeon': KAYKIT, 'kenney-town': KENNEY })
}

/** Applies a plan to plain tiles the way apply does (new chunk records for the chunks touched). */
export function applyPlan(tiles: SceneTiles, plan: TilePlan): SceneTiles {
  const chunks = { ...tiles.chunks }
  const kits = [...tiles.kits]
  const copied = new Set<string>()
  plan.keys.forEach((key, i) => {
    const c = parseCellKey(key)!
    const id = chunkOf(c.x, c.z)
    if (!copied.has(id)) { chunks[id] = { ...(chunks[id] ?? {}) }; copied.add(id) }
    const v = plan.values[i]!
    if (v === '') { delete chunks[id]![key]; return }
    const t = parseTile(v)!
    let k = kits.indexOf(plan.kits[t.kit]!)
    if (k < 0) { kits.push(plan.kits[t.kit]!); k = kits.length - 1 }
    chunks[id]![key] = encodeTile({ ...t, kit: k })
  })
  return { kits, chunks }
}

/** Every piece in the tiles as `key=pieceId@rot`, sorted. */
export function describeTiles(tiles: SceneTiles, lookup: PieceLookup = lookupFor(tiles)): string[] {
  const out: string[] = []
  for (const id in tiles.chunks) for (const [key, v] of Object.entries(tiles.chunks[id]!)) {
    const t = parseTile(v)!
    out.push(`${key}=${lookup(t.kit, t.piece)?.piece.id ?? '?'}@${t.rot}`)
  }
  return out.sort()
}

/**
 * A generated dungeon for the kit benchmark (#/dev/kit-bench) and its tests: a grid of square
 * rooms on two levels, walls joined by the auto-join (tees and crossings where rooms meet), a door
 * in every room, floors, a pillar per room. Pure.
 */
import { cellKey, chunkOf, encodeTile, type KitManifest, type SceneTiles } from '@/core/kits'
import { edgesAround, planWalls } from './autoJoin'
import { pieceIndex, pieceLookup } from './manifests'
import { sceneOccupancy } from './occupancy'

export const ROOM = 6

/** Tiles of a `rooms`×`rooms` dungeon on `levels` levels, cut to at most `limit` pieces. */
export function benchDungeon(manifest: KitManifest, rooms: number, levels = 2, limit = Infinity): SceneTiles {
  const tiles: SceneTiles = { kits: [manifest.id], chunks: {} }
  let n = 0
  const put = (key: string, value: string) => {
    if (n >= limit) return
    const [x, , z] = key.split(',').map(Number) as [number, number, number]
    const id = chunkOf(x, z)
    ;(tiles.chunks[id] ??= {})[key] = value
    n++
  }
  const floor = pieceIndex(manifest, manifest.defaults.floor)
  const pillar = pieceIndex(manifest, manifest.defaults.pillar)
  const doorIdx = pieceIndex(manifest, manifest.defaults.door)
  // Walls once, joined across the whole grid, then copied to every level.
  const edges = []
  for (let i = 0; i < rooms; i++) for (let j = 0; j < rooms; j++) edges.push(...edgesAround({ x: i * ROOM, z: j * ROOM }, { x: (i + 1) * ROOM, z: (j + 1) * ROOM }))
  const unique = new Map(edges.map((e) => [`${e.x},${e.z},${e.side}`, e]))
  const empty: SceneTiles = { kits: [manifest.id], chunks: {} }
  const plan = planWalls({ occ: sceneOccupancy(empty, pieceLookup(empty.kits, { [manifest.id]: manifest })), level: 0, manifest, add: [...unique.values()] })
  for (let level = 0; level < levels; level++) {
    for (let i = 0; i < rooms; i++) for (let j = 0; j < rooms; j++) {
      const x0 = i * ROOM, z0 = j * ROOM
      for (let a = 0; a < ROOM; a += 2) for (let b = 0; b < ROOM; b += 2) put(cellKey({ x: x0 + a, level, z: z0 + b, slot: 'f' }), encodeTile({ kit: 0, piece: floor, rot: 0, variant: 0 }))
      if (pillar >= 0) put(cellKey({ x: x0 + 3, level, z: z0 + 3, slot: 'v' }), encodeTile({ kit: 0, piece: pillar, rot: 0, variant: 0 }))
    }
    plan.keys.forEach((key, i) => {
      const [x, , z, slot] = key.split(',')
      // A door in every room's north wall (the straight over its edges 1 and 2), the rest as planned.
      const isDoor = slot === 'n' && Number(x) % ROOM === 1 && Number(z) % ROOM === 0
      const value = isDoor ? encodeTile({ kit: 0, piece: doorIdx, rot: 0, variant: 0 }) : plan.values[i]!
      put(`${x},${level},${z},${slot}`, value)
    })
  }
  return tiles
}

/** Pieces in a scene's tiles. */
export function tileCount(t: SceneTiles): number {
  let n = 0
  for (const id in t.chunks) n += Object.keys(t.chunks[id]!).length
  return n
}

/** The smallest square dungeon with at least `n` pieces on `levels` levels. */
export function benchRoomsFor(manifest: KitManifest, n: number, levels = 2): number {
  let rooms = Math.max(1, Math.floor(Math.sqrt(n / levels / 18)))
  while (tileCount(benchDungeon(manifest, rooms, levels)) < n && rooms < 200) rooms++
  return rooms
}

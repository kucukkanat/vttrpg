/**
 * A shape per player, as a colour-blind-safe backup for the owner ring's colour: the ring gets a
 * small marker in that shape, and the nameplate and Players panel repeat it beside the name.
 * Pure; no three.js.
 *
 * Every client derives the same assignment from the shared document alone: the players are the
 * non-GM owners of tokens, sorted by pubkey; each takes the shape its pubkey hashes to,
 * or the next free one, so up to six players never share a shape and adding a player rarely
 * moves anyone else's.
 */

export const OWNER_SHAPES = ['circle', 'triangle', 'square', 'diamond', 'star', 'hexagon'] as const
export type OwnerShape = (typeof OWNER_SHAPES)[number]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Shape per player pubkey (GM and empty ids left out). */
export function assignOwnerShapes(players: Iterable<string>, gm?: string): Map<string, OwnerShape> {
  const ids = [...new Set([...players].filter((p) => p && p !== gm))].sort()
  const out = new Map<string, OwnerShape>()
  const taken = new Set<number>()
  for (const id of ids) {
    let i = hash(id) % OWNER_SHAPES.length
    // Past six players shapes repeat; until then, probe for a free one.
    if (taken.size < OWNER_SHAPES.length) while (taken.has(i)) i = (i + 1) % OWNER_SHAPES.length
    taken.add(i)
    out.set(id, OWNER_SHAPES[i]!)
  }
  return out
}

let cache: { key: string; map: Map<string, OwnerShape> } | null = null

/** The shape for `owner` given the game's tokens and presence; cached while the player set is unchanged. */
export function ownerShapeIn(
  s: { tokens: Readonly<Record<string, { owner?: string }>>; meta?: { gm?: string } | null },
  owner: string | undefined,
): OwnerShape | null {
  if (!owner || owner === s.meta?.gm) return null
  const players = new Set<string>()
  for (const t of Object.values(s.tokens)) if (t.owner) players.add(t.owner)
  const key = `${s.meta?.gm ?? ''}|${[...players].sort().join(',')}`
  if (cache?.key !== key) cache = { key, map: assignOwnerShapes(players, s.meta?.gm) }
  return cache.map.get(owner) ?? null
}

/** Outline of a shape in a unit box centred on 0 (radius 1), for SVG and floor meshes alike; y points down. */
export function shapePoints(shape: OwnerShape): { x: number; y: number }[] | null {
  const poly = (n: number, rot: number, r = 1) => Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n
    return { x: Math.cos(a) * r, y: Math.sin(a) * r }
  })
  switch (shape) {
    case 'circle': return null
    case 'triangle': return poly(3, -Math.PI / 2, 1.1)
    case 'square': return poly(4, Math.PI / 4, 1.05)
    case 'diamond': return poly(4, -Math.PI / 2, 1.15)
    case 'hexagon': return poly(6, 0)
    case 'star': return Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const r = i % 2 === 0 ? 1.15 : 0.5
      return { x: Math.cos(a) * r, y: Math.sin(a) * r }
    })
  }
}

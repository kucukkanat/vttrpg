/**
 * Picking creatures up from the Library: a creature card (or a saved encounter) goes in hand, a
 * ghost of its tokens follows the cursor, and a click places them as tokens there, hidden unless
 * "Place visible" is on. The placing itself is the Library's (it owns the stat blocks and the
 * controller); this module holds the hand and the pure maths the ghost and the tests share.
 */
import type { Token } from '@/core/doc'
import type { GridSpec, Vec3 } from '@/core/geometry'
import type { CharacterId, SceneId, TokenId } from '@/core/ids'
import { creatureToken, spawnSpots } from '@/ui/prep/npc'
import { useBuildUi } from './buildState'

/** One token of the hand: what it will be called and its colour. */
export interface HeldCreatureToken {
  name: string
  color: string
}

export interface HeldCreatures {
  /** What the held bar says: "Goblin", "Ambush". */
  title: string
  tokens: HeldCreatureToken[]
  /** Place the tokens clustered around `at`; resolves once every intent is sent. */
  place(at: Vec3, hidden: boolean): Promise<void>
  /** Put the hand down after one placement (an encounter); a single creature stays in hand. */
  once?: boolean
}

/** Take creatures in hand (the build tool becomes 'creature'). */
export function pickUpCreatures(held: HeldCreatures): void {
  useBuildUi.getState().set({ tool: 'creature', creatures: held })
}

/** Where each held token would land for a click at `at`: free cells spiralling out from it. */
export function creatureGhost(
  grid: GridSpec, at: Vec3, held: Pick<HeldCreatures, 'tokens'>, tokens: readonly Pick<Token, 'scene' | 'position'>[], scene: SceneId,
): (HeldCreatureToken & { position: Vec3 })[] {
  const spots = spawnSpots(grid, at, tokens, scene, held.tokens.length)
  return held.tokens.map((t, i) => ({ ...t, position: spots[i] ?? spots[spots.length - 1] ?? at }))
}

/**
 * The tokens one click places, as plain data: the ghost's spots, the held names and colours, hidden
 * unless `hidden` is false. The Library's placement goes through `spawnNpcs`, which builds each
 * token with the same `creatureToken` and `spawnSpots`; this is that placement without the sheets.
 */
export function pickupTokens(args: {
  held: Pick<HeldCreatures, 'tokens'>
  at: Vec3
  grid: GridSpec
  scene: SceneId
  tokens: readonly Pick<Token, 'scene' | 'position'>[]
  hidden?: boolean
  makeId(): TokenId
  characters?: (CharacterId | undefined)[]
}): Token[] {
  return creatureGhost(args.grid, args.at, args.held, args.tokens, args.scene).map((g, i) => creatureToken({
    id: args.makeId(), scene: args.scene, spec: g, position: g.position, grid: args.grid, character: args.characters?.[i], hidden: args.hidden ?? true,
  }))
}

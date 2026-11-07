/**
 * Picking up a Saved shelf card. A group (prefab) arms the prefab stamp: its ghost follows the
 * cursor and each click stamps the whole group as one `props.place` (props and walls, one undo
 * step). An encounter becomes a group of tokens on the fly (`encounterAsGroup`): a click places
 * every row through `placeRows` and records the tokens on the stored encounter, so Run encounter,
 * Join initiative and the end-of-combat summary keep working.
 */
import type { Encounter } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import type { PrefabId, TokenId } from '@/core/ids'
import type { CreatureEntry } from '@/core/pack'
import { useGame } from '@/state/store'
import { useBuildUi } from '@/table/build/buildState'
import { pickUpCreatures } from '@/table/build/creaturePickup'
import type { GameController } from '../controller'
import { placeRows } from '../prep/placeCreatures'
import { pushToast } from '../toasts'
import { encounterAsGroup } from './shelves'

/** Arm the prefab stamp with a saved group (the same group again keeps its turn). */
export function pickUpGroup(id: PrefabId): void {
  const s = useBuildUi.getState()
  s.set({ tool: 'prefab-stamp', stamp: { prefab: id, turns: s.stamp?.prefab === id ? s.stamp.turns : 0 } })
}

/**
 * Place an encounter's rows around `at` and record the new tokens on it (`placed` keeps earlier
 * live tokens; `placedRows` is this placement, by row, for initiative groups). Resolves to the
 * tokens placed.
 */
export async function placeEncounterAt(
  controller: GameController, encounterId: string, compendium: readonly CreatureEntry[] | undefined, opts: { at?: Vec3; hidden?: boolean } = {},
): Promise<TokenId[]> {
  const s = useGame.getState()
  const e = s.encounters[encounterId]
  if (!e) return []
  const { placed, missing } = await placeRows(controller, e.rows, compendium, s.creatures, opts)
  if (missing.length) pushToast({ text: `Skipped ${missing.join(', ')}: stat block not found` })
  const fresh: Encounter = useGame.getState().encounters[e.id] ?? e
  const tokens = useGame.getState().tokens
  const placedRows: Record<string, TokenId[]> = {}
  for (const p of placed) placedRows[p.row.id] = [...(placedRows[p.row.id] ?? []), ...p.tokens]
  const ids = placed.flatMap((p) => p.tokens)
  await controller.dispatch({ type: 'encounter.upsert', encounter: { ...fresh, placed: [...fresh.placed.filter((id) => !!tokens[id] && !ids.includes(id)), ...ids], placedRows } })
  return ids
}

/** Take an encounter in hand as a group of tokens; one click places it (hidden unless "Place visible"). */
export function pickUpEncounter(controller: GameController, e: Encounter, compendium: readonly CreatureEntry[] | undefined): boolean {
  const group = encounterAsGroup(e, compendium, useGame.getState().creatures)
  if (!group.tokens.length) {
    pushToast({ text: group.missing.length ? `${group.title}: stat blocks not found (${group.missing.join(', ')})` : `${group.title} has no creatures yet` })
    return false
  }
  pickUpCreatures({
    title: group.title,
    tokens: group.tokens,
    once: true,
    place: async (at, hidden) => {
      try {
        const ids = await placeEncounterAt(controller, e.id, compendium, { at, hidden })
        if (ids.length) pushToast({ text: `Placed ${group.title}: ${ids.length} ${ids.length === 1 ? 'token' : 'tokens'}${hidden ? ', hidden' : ''}`, ttl: 2500 })
      } catch (err) {
        pushToast({ text: `Place failed: ${err instanceof Error ? err.message : String(err)}` })
      }
    },
  })
  return true
}

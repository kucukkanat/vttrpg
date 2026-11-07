/**
 * Running a saved encounter from Play (GM drawer › Encounters › Run): place its creatures on the
 * live scene near the camera, hidden or visible, remember the placement on the encounter (so
 * Reveal all, Join initiative and the end-of-combat summary see them), then offer initiative.
 */
import type { CreatureTemplate, Encounter } from '@/core/doc'
import type { CreatureEntry } from '@/core/pack'
import type { TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import type { GameController } from '../controller'
import { startCombat } from '../panels/InitiativePanel'
import { placedGroups } from './encounters'
import { groupInitiative, placeRows } from './placeCreatures'
import { setHidden } from './npc'

export interface RunResult {
  /** Every token placed, in row order. */
  tokens: TokenId[]
  /** Rows skipped because their stat block is gone. */
  missing: string[]
}

/** Place the encounter's rows and record the placement on it. Creatures land hidden unless `visible`. */
export async function runEncounter(
  controller: GameController,
  encounter: Encounter,
  opts: { visible: boolean; compendium: readonly CreatureEntry[] | undefined; templates: Record<string, CreatureTemplate> | undefined },
): Promise<RunResult> {
  const { placed, missing } = await placeRows(controller, encounter.rows, opts.compendium, opts.templates)
  const tokens = placed.flatMap((p) => p.tokens)
  if (opts.visible && tokens.length) await setHidden(controller, tokens, false)
  if (tokens.length) {
    const s = useGame.getState()
    const fresh = s.encounters[encounter.id] ?? encounter
    const placedRows: Record<string, TokenId[]> = {}
    for (const p of placed) placedRows[p.row.id] = [...(placedRows[p.row.id] ?? []), ...p.tokens]
    const earlier = fresh.placed.filter((id) => !!s.tokens[id] && !tokens.includes(id))
    await controller.dispatch({ type: 'encounter.upsert', encounter: { ...fresh, placed: [...earlier, ...tokens], placedRows } })
  }
  return { tokens, missing }
}

/** "Roll initiative for 4 creatures?" */
export function initiativeOffer(n: number): string {
  return `Roll initiative for ${n} ${n === 1 ? 'creature' : 'creatures'}?`
}

/**
 * Yes to the offer: out of combat, start it with the scene's fighters plus the placed tokens (even
 * hidden ones); in combat, the placed rows join the running order as groups.
 */
export async function rollForPlaced(controller: GameController, encounter: Pick<Encounter, 'id'>, tokens: readonly TokenId[]): Promise<boolean> {
  const s = useGame.getState()
  const live = tokens.filter((id) => !!s.tokens[id])
  if (!live.length) return false
  if (s.initiative?.active) {
    const e = s.encounters[encounter.id]
    const groups = e ? placedGroups(e, (id) => !!s.tokens[id]) : [{ id: `encounter:${encounter.id}`, tokens: live }]
    return (await groupInitiative(controller, groups)) > 0
  }
  return startCombat(controller, { include: live })
}

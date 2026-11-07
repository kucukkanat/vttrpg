/**
 * The NPC card (Play, GM drawer): the NPC generator with the pack's compendium. Generating puts
 * the NPCs on the board near the camera, hidden, selects the first, and puts the card away; the
 * toast offers Undo (removing them again); the hand and the token menu reveal them.
 */
import type { GameController } from '../controller'
import type { TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import { useTableLayout } from '../shell/tableLayout'
import { pushToast } from '../toasts'
import { useCompendium } from '../panels/CreaturesPrep'
import { NpcGenerator } from './NpcGenerator'
import { removeTokens } from './npc'

/** The toast line after placing: "Placed Goblin (hidden)", "Placed 3 NPCs (hidden)". */
export function placedText(names: readonly string[]): string {
  if (names.length === 1) return `Placed ${names[0]} (hidden)`
  return `Placed ${names.length} NPCs (hidden)`
}

export function NpcCard({ controller }: { controller: GameController }) {
  const compendium = useCompendium(controller.rules)
  const noScene = useGame((s) => !s.meta?.activeScene)
  const placed = (ids: TokenId[]) => {
    const s = useGame.getState()
    const names = ids.map((id) => s.tokens[id]?.name ?? 'NPC')
    s.setSelectedToken(ids[0]!)
    if (useTableLayout.getState().card === 'npc') useTableLayout.getState().set({ card: null })
    pushToast({ key: 'npc-placed', text: placedText(names), action: { label: 'Undo', run: () => void removeTokens(controller, ids) }, ttl: 8000 })
  }
  return (
    <div className="panel">
      {noScene && <p className="muted small">Make a scene live to place NPCs.</p>}
      <NpcGenerator controller={controller} disabled={noScene} compendium={compendium} onPlaced={placed} />
    </div>
  )
}

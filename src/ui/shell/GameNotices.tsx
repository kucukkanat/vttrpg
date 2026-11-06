/** Renders nothing; runs `useGameNotices` for the game screen (toasts + local system chat lines). */
import type { GameController } from '../controller'
import { useGameNotices } from '../notices'

export function GameNotices({ controller, onOpenPanel }: { controller: GameController; onOpenPanel?(id: string): void }) {
  useGameNotices(controller, { onOpenPanel })
  return null
}

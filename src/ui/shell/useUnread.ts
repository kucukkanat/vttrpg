/** Badge counts for panels that are not on screen: chat messages and journal notes. */
import { useEffect, useMemo, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { canSee } from '../panels/JournalPanel'

/** Messages appended since the chat was last visible. Resets while `open`. */
export function unreadCount(total: number, seen: number, open: boolean): number {
  return open ? 0 : Math.max(0, total - seen)
}

export function useUnread(total: number, open: boolean): number {
  const [seen, setSeen] = useState(total)
  useEffect(() => { if (open) setSeen(total) }, [open, total])
  return unreadCount(total, seen, open)
}

/** Notes in `ids` that were not there the last time the panel was visible. Zero while `open`. */
export function unreadNoteCount(ids: readonly string[], seen: ReadonlySet<string>, open: boolean): number {
  if (open) return 0
  let n = 0
  for (const id of ids) if (!seen.has(id)) n++
  return n
}

/**
 * Shared notes this viewer can see that appeared while the Journal panel was not on screen.
 * Notes present at mount count as seen (a rejoin does not light the badge); opening the panel
 * clears it. Edits to existing notes do not count: the list marks those per note.
 */
export function useUnreadNotes(controller: GameController, open: boolean): number {
  const notes = useGame((s) => s.notes)
  const isGm = controller.connection.isGm
  const ids = useMemo(
    () => Object.values(notes).filter((n) => canSee(n, controller.pubkey, isGm)).map((n) => n.id as string).sort(),
    [notes, controller.pubkey, isGm],
  )
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(ids))
  useEffect(() => { if (open) setSeen(new Set(ids)) }, [open, ids])
  return unreadNoteCount(ids, seen, open)
}

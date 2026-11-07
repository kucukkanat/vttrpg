/**
 * Toasts for the moments a player must not miss when the panel that shows them is closed: a whisper
 * to them, a handout newly shared with them, and damage to their own character. Each toast carries
 * an Open action; the tab badges (useUnread) keep counting as before. "Your turn" comes from
 * useTurnNotices. The GM gets whisper toasts only.
 */
import { useEffect, useRef } from 'react'
import type { Character } from '@/core/doc'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { readResource } from '@/table/tokenHud'
import { canSee } from '../panels/JournalPanel'
import { pushToast } from '../toasts'

export function useGameAlerts(controller: GameController, open: { chat: boolean; journal: boolean }, openPanel: (id: string) => void): void {
  const { chat: chatOpen, journal: journalOpen } = open
  const go = useRef(openPanel)
  go.current = openPanel
  useEffect(() => {
    const openPanel = (id: string) => go.current(id)
    const me = controller.pubkey
    const isGm = controller.connection.isGm
    const start = useGame.getState()
    let chatLen = start.chat.length
    let visibleNotes = new Set(Object.values(start.notes).filter((n) => canSee(n, me, isGm)).map((n) => n.id as string))
    const hp = new Map<string, number>()
    const primary = () => controller.rules?.pack.resources[0]
    const readHp = (c: Character) => readResource(c.data, primary(), (e) => controller.rules?.evaluateNow(e, c))
    for (const c of Object.values(start.characters)) {
      const r = c.owner === me ? readHp(c) : null
      if (r) hp.set(c.id, r.current)
    }

    return useGame.subscribe((s) => {
      // Whispers to me.
      if (s.chat.length > chatLen) {
        const fresh = s.chat.slice(chatLen)
        chatLen = s.chat.length
        if (!chatOpen) {
          for (const m of fresh) {
            if (m.kind !== 'whisper' || m.author === me || !m.to?.includes(me as never)) continue
            const who = s.presence[m.author]?.name ?? s.meta?.names?.[m.author] ?? (m.author === s.meta?.gm ? 'GM' : 'Someone')
            pushToast({ text: `${who} whispers: ${m.text}`, key: `whisper-${m.id}`, ttl: 8000, action: { label: 'Open', run: () => openPanel('chat') } })
          }
        }
      } else if (s.chat.length < chatLen) chatLen = s.chat.length

      // Handouts newly visible to a player.
      if (!isGm) {
        const now = Object.values(s.notes).filter((n) => canSee(n, me, isGm))
        const nowIds = new Set(now.map((n) => n.id as string))
        if (!journalOpen) {
          for (const n of now) {
            if (visibleNotes.has(n.id)) continue
            pushToast({ text: `New handout: ${n.title || 'Untitled'}`, key: `handout-${n.id}`, ttl: 8000, action: { label: 'Open', run: () => openPanel('journal') } })
          }
        }
        visibleNotes = nowIds

        // Damage to my characters.
        for (const c of Object.values(s.characters)) {
          if (c.owner !== me) continue
          const r = readHp(c)
          if (!r) continue
          const before = hp.get(c.id)
          hp.set(c.id, r.current)
          if (before !== undefined && r.current < before) {
            const name = primary()?.name ?? 'HP'
            pushToast({ text: `${c.name} loses ${before - r.current} ${name} (${r.current}/${r.max})`, key: `hurt-${c.id}`, ttl: 5000 })
          }
        }
      }
    })
  }, [controller, chatOpen, journalOpen])
}

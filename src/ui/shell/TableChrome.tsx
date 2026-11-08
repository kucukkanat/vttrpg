/**
 * The pieces of the table layout around the board (docs/UX.md "Table layout"): the one paper card,
 * the scroll (chat), the dice well, the GM screen's plaque (the GM drawer), the presence row, the
 * bell and the combat control. Each reads `useTableLayout` and hosts registry panels through
 * PanelHost, so the panels themselves do not know where they are. The GM's Library and Inspector
 * are GmHosts.tsx.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GameController } from '../controller'
import type { ChatMessage } from '@/core/doc'
import type { PanelDef } from '../panels/registry'
import { useGame } from '@/state/store'
import { PanelHost } from './PanelHost'
import { useTableLayout } from './tableLayout'
import { DiceRing, WellReadout } from './Hud'
import { isTypingTarget } from './useShortcuts'
import { useAttention, handleAttention } from '../attention'
import { endCombat, startCombat } from '../panels/InitiativePanel'
import { Icon, type IconName } from '../icons'

/** Esc (outside a field) runs `onClose` while `active`. Capture phase, so it wins over table keys. */
export function useEscape(active: boolean, onClose: () => void) {
  const latest = useRef(onClose)
  latest.current = onClose
  useEffect(() => {
    if (!active) return
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isTypingTarget(document.activeElement)) return
      latest.current()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [active])
}

/** Closes on a pointer-down outside `ref` (deferred a tick so the opening tap does not close it). */
export function useOutside(active: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const latest = useRef(onClose)
  latest.current = onClose
  useEffect(() => {
    if (!active) return
    const on = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) latest.current() }
    const id = setTimeout(() => window.addEventListener('pointerdown', on), 0)
    return () => { clearTimeout(id); window.removeEventListener('pointerdown', on) }
  }, [active, ref])
}

/** Header row of a paper card or leaf: glyph, title, then the panel's own actions and a close. */
function PaperHead({ title, glyph, onClose, closeLabel, children }: { title: string; glyph?: IconName; onClose?(): void; closeLabel?: string; children?: ReactNode }) {
  return (
    <div className="paper-head">
      {glyph && <Icon name={glyph} size={18} className="paper-glyph" />}
      <h2 className="host-title paper-title" tabIndex={-1}>{title}</h2>
      {children}
      {onClose && <button type="button" className="icon paper-close" aria-label={closeLabel ?? `Close ${title}`} onClick={onClose}><Icon name="close" /></button>}
    </div>
  )
}

/**
 * The one floating paper card (desktop and tablet): a registry panel shown over the board's left
 * side. Opening another panel replaces it; Esc or ✕ puts it away.
 */
export function CardHost({ controller, panels }: { controller: GameController; panels: PanelDef[] }) {
  const card = useTableLayout((s) => s.card)
  const set = useTableLayout((s) => s.set)
  const def = panels.find((p) => p.id === card)
  useEscape(!!def, () => set({ card: null }))
  if (!def) return null
  return (
    <div className="t-card skin-paper" role="dialog" aria-label={def.title}>
      <PanelHost key={def.id} def={def} controller={controller} head={<PaperHead title={def.title} glyph={def.glyph} onClose={() => set({ card: null })} />} />
    </div>
  )
}

/**
 * The scroll: chat on the right edge. Rolled up it is a rod with the unread count; unrolled, the
 * chat panel on parchment.
 */
export function Scroll({ controller, chat, unread }: { controller: GameController; chat: PanelDef | undefined; unread: number }) {
  const open = useTableLayout((s) => s.scrollOpen)
  const set = useTableLayout((s) => s.set)
  if (!chat) return null
  if (!open) {
    return (
      <button type="button" className="t-scroll-rod" onClick={() => set({ scrollOpen: true })}
        aria-label={unread ? `Unroll the scroll: chat, ${unread} new` : 'Unroll the scroll: chat'} title="Chat and rolls (/)">
        <span className="t-rod-cap" aria-hidden />
        <span className="t-rod-word"><Icon name="chat" size={16} /> Scroll</span>
        {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
        <span className="t-rod-cap" aria-hidden />
      </button>
    )
  }
  return (
    <aside className="t-scroll skin-paper" aria-label="Chat">
      <PanelHost def={chat} controller={controller} head={<PaperHead title="The scroll" glyph="chat" closeLabel="Roll the scroll up" onClose={() => set({ scrollOpen: false })} />} />
    </aside>
  )
}

/**
 * The dice well in the bottom-right corner: dice roll inside it (the 3D tray is mounted in the
 * well, nowhere else), the latest result reads out on its rim, and the brass button fans the dice
 * ring out around itself (DiceRing): a die throws at once, throws pile up in the well, Clear takes
 * them out.
 */
export function DiceWell({ dice, roll, who, compact = false, pileTotal, onClear }: { dice: ReactNode; roll: ChatMessage | null; who(pubkey: string): string; compact?: boolean; pileTotal: number | null; onClear(): void }) {
  const [ring, setRing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const set = useTableLayout((s) => s.set)
  useOutside(ring, ref, () => setRing(false))
  useEscape(ring, () => setRing(false))
  return (
    <div className={`t-well-wrap${compact ? ' compact' : ''}`} ref={ref}>
      <div className="t-well">
        <div className="t-well-felt">{dice}</div>
        <WellReadout roll={roll} who={who} onOpenChat={() => set({ scrollOpen: true })} />
      </div>
      {ring && <DiceRing pileTotal={pileTotal} onClear={onClear} />}
      <button type="button" className={`t-well-btn${ring ? ' on' : ''}`} aria-expanded={ring} aria-label="Dice" title="Dice" onClick={() => setRing((o) => !o)}>
        <Icon name="dice" />
        <span className="t-well-btn-word">Roll</span>
      </button>
    </div>
  )
}

/**
 * The GM screen's plaque (bottom left): the GM drawer and a live line (sounds playing, the round).
 * There are no modes: the Library on the left edge changes the world at any moment.
 */
export function GmScreen({ live, onLive, drawer }: { live: string; onLive(): void; drawer?: ReactNode }) {
  return (
    <div className="t-plaque" role="group" aria-label="GM screen">
      <div className="t-plaque-head">
        <strong>GM screen</strong>
      </div>
      <div className="t-plaque-row">
        {drawer}
        {live && <button type="button" className="t-plaque-live" onClick={onLive}><Icon name="sound" size={14} /> {live}</button>}
      </div>
    </div>
  )
}

/** Who is at the table: up to four faces and "+n"; opens the Players card. */
export function PresenceRow({ me, onOpen }: { me: string; onOpen(): void }) {
  const presence = useGame((s) => s.presence)
  const people = Object.values(presence).sort((a, b) => (a.pubkey === me ? -1 : b.pubkey === me ? 1 : a.name.localeCompare(b.name)))
  const shown = people.slice(0, 4)
  const more = people.length - shown.length
  const names = people.map((p) => p.name).join(', ')
  return (
    <button type="button" className="t-presence" onClick={onOpen} aria-label={`At the table: ${names || 'just you'}. Players and settings`} title={names || 'Players'}>
      {shown.map((p) => (
        <span key={p.pubkey} className="t-face" style={{ background: p.color }} aria-hidden>{initial(p.name)}</span>
      ))}
      {more > 0 && <span className="t-face t-face--more" aria-hidden>+{more}</span>}
      {people.length === 0 && <Icon name="users" size={18} />}
    </button>
  )
}

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase()

/** The bell: things waiting for you, kept until handled (ui/attention.ts). */
export function Bell({ compact = false }: { compact?: boolean }) {
  const items = useAttention((s) => s.items)
  const remove = useAttention((s) => s.remove)
  const clear = useAttention((s) => s.clear)
  const open = useTableLayout((s) => s.bell)
  const set = useTableLayout((s) => s.set)
  const ref = useRef<HTMLDivElement>(null)
  useOutside(open, ref, () => set({ bell: false }))
  useEscape(open, () => set({ bell: false }))
  const n = items.length
  return (
    <div className="menu t-bell" ref={ref}>
      <button type="button" className={`t-bell-btn${n ? ' has' : ''}`} aria-haspopup="dialog" aria-expanded={open}
        aria-label={n ? `${n} waiting for you` : 'Nothing waiting'} title="Waiting for you" onClick={() => set({ bell: !open })}>
        <Icon name="bell" />
        {!compact && <span className="t-bell-word">{n ? `${n} waiting` : 'Bell'}</span>}
        {n > 0 && <span className="badge">{n > 99 ? '99+' : n}</span>}
      </button>
      {open && (
        <div className="t-bell-pop skin-paper" role="dialog" aria-label="Waiting for you">
          <div className="paper-head">
            <h2 className="host-title paper-title">Waiting for you</h2>
            {n > 0 && <button type="button" className="tiny" onClick={clear}>Clear all</button>}
          </div>
          {n === 0 && <p className="muted small t-bell-empty">Nothing waiting. Whispers, handouts and requests stay here until you handle them.</p>}
          <ul className="t-bell-list">
            {items.map((it) => (
              <li key={it.key}>
                <span className="t-bell-text">{it.text}</span>
                {it.action && <button type="button" className="tiny primary" onClick={() => { set({ bell: false }); handleAttention(it) }}>{it.action.label}</button>}
                <button type="button" className="icon" aria-label={`Dismiss: ${it.text}`} onClick={() => remove(it.key)}><Icon name="close" size={16} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * GM, top centre: "Roll initiative" out of combat; in combat "Next turn" and End. Players get
 * nothing here (the standees show whose turn it is).
 */
export function CombatControl({ controller }: { controller: GameController }) {
  const active = useGame((s) => !!s.initiative?.active)
  const hasScene = useGame((s) => !!s.meta?.activeScene)
  const [busy, setBusy] = useState(false)
  if (!controller.connection.isGm || !hasScene) return null
  if (!active) {
    return (
      <button type="button" className="t-combat" disabled={busy} aria-label="Roll initiative" title="Roll initiative for everyone with a sheet in this scene and start combat"
        onClick={() => { setBusy(true); void startCombat(controller).finally(() => setBusy(false)) }}>
        <Icon name="swords" size={18} /> <span className="t-combat-word">Roll initiative</span>
      </button>
    )
  }
  return (
    <span className="t-combat-group">
      <button type="button" className="t-combat" onClick={() => void controller.dispatch({ type: 'initiative.next' })} aria-label="Next turn" title="Next turn">
        <span className="t-combat-word">Next turn</span> <Icon name="chevron-right" size={16} />
      </button>
      <button type="button" className="t-combat-end" onClick={() => endCombat(controller)} title="End combat and post the summary">End</button>
    </span>
  )
}

/** Journal on the tool rail: a book with a ribbon while something new waits in it. */
export function JournalBook({ unread, onOpen }: { unread: number; onOpen(): void }) {
  return (
    <button type="button" className="t-book" onClick={onOpen} aria-label={unread ? `Journal, ${unread} new` : 'Journal'} title="Journal and handouts">
      <Icon name="book" />
      <span className="t-book-word">Journal</span>
      {unread > 0 && <span className="t-ribbon">{unread} new</span>}
    </button>
  )
}

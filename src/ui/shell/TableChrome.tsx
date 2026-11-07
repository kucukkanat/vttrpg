/**
 * The pieces of the table layout around the board (docs/UX.md "Table layout"): the one paper card,
 * the scroll (chat), the dice well, the GM screen (Play / Prep / Build), the presence row, the bell
 * and the combat control. Each reads `useTableLayout` and hosts registry panels through PanelHost,
 * so the panels themselves do not know where they are.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GameController } from '../controller'
import type { ChatMessage } from '@/core/doc'
import type { PanelDef } from '../panels/registry'
import { useGame } from '@/state/store'
import { useBuildUi } from '@/table/build/buildState'
import { PanelHost } from './PanelHost'
import { BUILD_TABS, LEAVES, useTableLayout, type LeafId, type TableMode } from './tableLayout'
import { DicePad, WellReadout } from './Hud'
import { isTypingTarget } from './useShortcuts'
import { useAttention, handleAttention } from '../attention'
import { endCombat, startCombat } from '../panels/InitiativePanel'
import { Icon, type IconName } from '../icons'

/** Esc (outside a field) runs `onClose` while `active`. Capture phase, so it wins over table keys. */
function useEscape(active: boolean, onClose: () => void) {
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
function useOutside(active: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
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
 * well, nowhere else), the latest result reads out on its rim, and the d20 button opens the pad.
 */
export function DiceWell({ dice, roll, who, compact = false }: { dice: ReactNode; roll: ChatMessage | null; who(pubkey: string): string; compact?: boolean }) {
  const [pad, setPad] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const set = useTableLayout((s) => s.set)
  useOutside(pad, ref, () => setPad(false))
  useEscape(pad, () => setPad(false))
  return (
    <div className={`t-well-wrap${compact ? ' compact' : ''}`} ref={ref}>
      {pad && (
        <div className="t-well-pad skin-paper" role="dialog" aria-label="Roll dice">
          <PaperHead title="Dice" glyph="dice" onClose={() => setPad(false)} />
          <DicePad onRolled={() => setPad(false)} onRollMode={() => { setPad(false); set({ scrollOpen: true }) }} />
        </div>
      )}
      <div className="t-well">
        <div className="t-well-felt">{dice}</div>
        <WellReadout roll={roll} who={who} onOpenChat={() => set({ scrollOpen: true })} />
      </div>
      <button type="button" className={`t-well-btn${pad ? ' on' : ''}`} aria-expanded={pad} aria-label="Roll dice" title="Roll dice" onClick={() => setPad((o) => !o)}>
        <Icon name="dice" />
        <span className="t-well-btn-word">Roll</span>
      </button>
    </div>
  )
}

const MODES: { id: TableMode; label: string; hint: string }[] = [
  { id: 'play', label: 'Play', hint: 'The board and the hand; the screen folded away' },
  { id: 'prep', label: 'Prep', hint: 'Raise the screen: scenes, encounters, cast, reference' },
  { id: 'build', label: 'Build', hint: 'The tool tray: walls, doors, fog, lights, props, scene settings' },
]

/** Switch the GM's mode; leaving Build puts any build tool away so the board is plain again. */
export function setTableMode(mode: TableMode) {
  const s = useTableLayout.getState()
  if (s.mode === mode) return
  if (s.mode === 'build') useBuildUi.getState().set({ tool: null })
  s.set({ mode })
}

/**
 * The GM screen. Folded, a leather plaque (bottom left) with the mode and a live line (sounds
 * playing, the round). Prep raises three leaves over the board; Build folds into the tool tray.
 */
export function GmScreen({ controller, panels, live, onLive }: { controller: GameController; panels: PanelDef[]; live: string; onLive(): void }) {
  const mode = useTableLayout((s) => s.mode)
  const leafTabs = useTableLayout((s) => s.leafTabs)
  const buildTab = useTableLayout((s) => s.buildTab)
  const set = useTableLayout((s) => s.set)
  const byId = (id: string) => panels.find((p) => p.id === id)
  useEscape(mode === 'prep', () => setTableMode('play'))
  const buildDef = byId(buildTab)
  return (
    <>
      {mode === 'prep' && (
        <div className="t-leaves" role="region" aria-label="GM screen">
          {LEAVES.map((leaf, i) => {
            const def = byId(leafTabs[leaf.id]) ?? byId(leaf.panels[0])
            if (!def) return null
            return (
              <section key={leaf.id} className={`t-leaf skin-paper t-leaf--${i}`} aria-label={leaf.title}>
                <PaperHead title={leaf.title}>
                  <LeafTabs ids={leaf.panels} active={def.id} panels={panels} onPick={(id) => set({ leafTabs: { ...leafTabs, [leaf.id]: id } })} />
                </PaperHead>
                <PanelHost key={def.id} def={def} controller={controller} className="t-leaf-body" />
              </section>
            )
          })}
        </div>
      )}
      {mode === 'build' && buildDef && (
        <div className="t-tray skin-paper" role="region" aria-label="Build tools">
          <PaperHead title="Build" glyph="wall" onClose={() => setTableMode('play')} closeLabel="Fold the tray: back to Play">
            <LeafTabs ids={BUILD_TABS} active={buildDef.id} panels={panels} labels={{ build: 'Tools', scenes: 'Scene' }} onPick={(id) => set({ buildTab: id as (typeof BUILD_TABS)[number] })} />
          </PaperHead>
          <PanelHost key={buildDef.id} def={buildDef} controller={controller} className="t-tray-body" />
        </div>
      )}
      <div className={`t-plaque t-plaque--${mode}`} role="group" aria-label="GM screen">
        <div className="t-plaque-head">
          <strong>GM screen</strong>
          <span className="t-plaque-state">{mode === 'play' ? 'folded' : mode === 'prep' ? 'raised' : 'tray'}</span>
        </div>
        <div className="t-modes" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`t-mode${mode === m.id ? ' on' : ''}`} title={m.hint} onClick={() => setTableMode(m.id)}>{m.label}</button>
          ))}
        </div>
        {live && <button type="button" className="t-plaque-live" onClick={onLive}><Icon name="sound" size={14} /> {live}</button>}
      </div>
    </>
  )
}

function LeafTabs({ ids, active, panels, labels, onPick }: { ids: readonly string[]; active: string; panels: PanelDef[]; labels?: Record<string, string>; onPick(id: string): void }) {
  const shown = ids.map((id) => panels.find((p) => p.id === id)).filter((p): p is PanelDef => !!p)
  if (shown.length < 2) return null
  return (
    <div className="t-leaf-tabs" role="tablist">
      {shown.map((p) => (
        <button key={p.id} type="button" role="tab" aria-selected={p.id === active} className={`t-leaf-tab${p.id === active ? ' on' : ''}`} onClick={() => onPick(p.id)}>
          {labels?.[p.id] ?? p.title}
        </button>
      ))}
    </div>
  )
}

/** The phone version of the GM screen: the mode switch, then the leaf or tray as tabs, in one sheet. */
export function GmScreenSheet({ controller, panels }: { controller: GameController; panels: PanelDef[] }) {
  const mode = useTableLayout((s) => s.mode)
  const leaf = useTableLayout((s) => s.leaf)
  const leafTabs = useTableLayout((s) => s.leafTabs)
  const buildTab = useTableLayout((s) => s.buildTab)
  const set = useTableLayout((s) => s.set)
  const byId = (id: string) => panels.find((p) => p.id === id)
  const current = LEAVES.find((l) => l.id === leaf) ?? LEAVES[0]
  const def = mode === 'build' ? byId(buildTab) : mode === 'prep' ? byId(leafTabs[current.id]) : undefined
  return (
    <div className="t-screen-sheet">
      <div className="t-modes" role="radiogroup" aria-label="Mode">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`t-mode${mode === m.id ? ' on' : ''}`} onClick={() => setTableMode(m.id)}>{m.label}</button>
        ))}
      </div>
      {mode === 'play' && <p className="muted small">Play: the screen is folded. Prep raises scenes, encounters, the cast and reference; Build opens the tool tray.</p>}
      {mode === 'prep' && (
        <div className="t-leaf-tabs t-leaf-tabs--leaves" role="tablist" aria-label="Leaf">
          {LEAVES.map((l) => (
            <button key={l.id} type="button" role="tab" aria-selected={l.id === leaf} className={`t-leaf-tab${l.id === leaf ? ' on' : ''}`} onClick={() => set({ leaf: l.id as LeafId })}>{l.title}</button>
          ))}
        </div>
      )}
      {mode === 'prep' && <LeafTabs ids={current.panels} active={def?.id ?? ''} panels={panels} onPick={(id) => set({ leafTabs: { ...leafTabs, [current.id]: id } })} />}
      {mode === 'build' && <LeafTabs ids={BUILD_TABS} active={def?.id ?? ''} panels={panels} labels={{ build: 'Tools', scenes: 'Scene' }} onPick={(id) => set({ buildTab: id as (typeof BUILD_TABS)[number] })} />}
      {def && <PanelHost key={def.id} def={def} controller={controller} className="t-screen-body" />}
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

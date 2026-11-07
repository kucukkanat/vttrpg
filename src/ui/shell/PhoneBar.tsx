/**
 * The table layout on phones: five thumb targets along the bottom and one bottom sheet at a time
 * above them: Dice, Scroll, Sheet, the Library (GM) or the Journal (players), Tools. The pieces
 * are the same as on wide screens: the scroll is the chat panel, the card is any panel, Tools
 * holds the camera and table tools, the GM drawer and every other panel. The GM's Inspector is a
 * sheet that comes with a selection (GmHosts.tsx).
 */
import { lazy, Suspense, useState } from 'react'
import type { GameController } from '../controller'
import type { PanelDef } from '../panels/registry'
import { BottomSheet, type SheetSize } from './BottomSheet'
import { CameraPill, DicePad } from './Hud'
import { useTableLayout, type PhoneSheet } from './tableLayout'
import { drawerItems } from './drawerItems'
import { Icon, type IconName } from '../icons'

const LibrarySheet = lazy(() => import('../build/LibraryDock').then((m) => ({ default: m.LibrarySheet })))
const InspectorSheet = lazy(() => import('../build/Inspector').then((m) => ({ default: m.InspectorSheet })))

type Target = { id: string; label: string; icon: IconName; badge?: number; on: boolean; tap(): void }

export function PhoneBar({ isGm, unread, journalUnread }: { isGm: boolean; unread: number; journalUnread: number }) {
  const layout = useTableLayout()
  const only = (patch: Partial<{ scrollOpen: boolean; card: string | null; phone: PhoneSheet | null }>) =>
    layout.set({ scrollOpen: false, card: null, phone: null, ...patch })
  const sheet = (p: PhoneSheet) => (layout.phone === p ? only({}) : only({ phone: p }))
  const card = (id: string) => (layout.card === id ? only({}) : only({ card: id }))
  const targets: Target[] = [
    { id: 'dice', label: 'Dice', icon: 'dice', on: layout.phone === 'dice', tap: () => sheet('dice') },
    { id: 'scroll', label: 'Scroll', icon: 'chat', badge: unread, on: layout.scrollOpen, tap: () => (layout.scrollOpen ? only({}) : only({ scrollOpen: true })) },
    { id: 'sheet', label: 'Sheet', icon: 'sheet', on: layout.card === 'character', tap: () => card('character') },
    isGm
      ? { id: 'library', label: 'Library', icon: 'cube', on: layout.phone === 'library', tap: () => sheet('library') }
      : { id: 'journal', label: 'Journal', icon: 'book', badge: journalUnread, on: layout.card === 'journal', tap: () => card('journal') },
    { id: 'tools', label: 'Tools', icon: 'more', on: layout.phone === 'tools' || (!!layout.card && !['character', 'journal'].includes(layout.card)), tap: () => sheet('tools') },
  ]
  return (
    <nav className="t-phonebar" aria-label="Table">
      {targets.map((t) => (
        <button key={t.id} type="button" className={`t-phonebar-btn${t.on ? ' on' : ''}`} aria-pressed={t.on} onClick={t.tap}
          aria-label={t.badge ? `${t.label}, ${t.badge} new` : t.label}>
          <Icon name={t.icon} />
          <span className="t-phonebar-word">{t.label}</span>
          {!!t.badge && <span className="badge">{t.badge > 99 ? '99+' : t.badge}</span>}
        </button>
      ))}
    </nav>
  )
}

const SHEET_TITLES: Record<PhoneSheet, string> = { dice: 'Dice', tools: 'Tools', library: 'Library', inspector: 'Inspector' }

/** The one bottom sheet: the scroll, the card, or one of the bar's own sheets. */
export function PhoneSheets({ controller, panels, keyboard }: { controller: GameController; panels: PanelDef[]; keyboard: number }) {
  const layout = useTableLayout()
  const [size, setSize] = useState<SheetSize>('half')
  const close = () => layout.set({ scrollOpen: false, card: null, phone: null })
  const def = layout.scrollOpen ? panels.find((p) => p.id === 'chat') : layout.card ? panels.find((p) => p.id === layout.card) : undefined
  const key = def?.id ?? layout.phone
  const isGm = controller.connection.isGm
  if (!def && !layout.phone) return null
  const loading = <p className="muted small">Loading…</p>
  return (
    <BottomSheet key={key} def={def} title={def ? undefined : SHEET_TITLES[layout.phone!]} controller={controller} size={size} keyboard={keyboard}
      onSize={setSize} onClose={close} onSwipeTab={() => {}}>
      {!def && isGm && layout.phone === 'library' && <Suspense fallback={loading}><LibrarySheet controller={controller} /></Suspense>}
      {!def && isGm && layout.phone === 'inspector' && <Suspense fallback={loading}><InspectorSheet controller={controller} /></Suspense>}
      {!def && layout.phone === 'dice' && <DicePad onRolled={close} onRollMode={() => layout.set({ phone: null, scrollOpen: true })} />}
      {!def && layout.phone === 'tools' && <ToolsSheet panels={panels} onOpen={(id) => layout.set({ phone: null, card: id })} onSearch={() => layout.set({ phone: null, palette: true })} />}
    </BottomSheet>
  )
}

/** Tools: the camera and table tools, search, the GM drawer (GM) and every panel without a place on the bar. */
function ToolsSheet({ panels, onOpen, onSearch }: { panels: PanelDef[]; onOpen(id: string): void; onSearch(): void }) {
  const isGm = panels.some((p) => p.scope === 'gm')
  const onBar = new Set(['chat', 'character', ...(isGm ? ['library', 'tokens', 'skills-editor'] : ['journal'])])
  const drawer = isGm ? drawerItems({ playing: 0, here: 0, journalNew: 0, encounters: [] }).map((d) => d.panel) : []
  const drawerPanels = drawer.map((id) => panels.find((p) => p.id === id)).filter((p): p is PanelDef => !!p)
  const rest = panels.filter((p) => !onBar.has(p.id) && !drawer.includes(p.id))
  const row = (p: PanelDef) => (
    <li key={p.id} className="list-row">
      <button type="button" className="list-row-main" onClick={() => onOpen(p.id)}>
        <Icon name={p.glyph} /> <span>{p.title}</span>
      </button>
    </li>
  )
  return (
    <div className="t-tools-sheet">
      <CameraPill />
      <button type="button" className="t-tools-search" onClick={onSearch}><Icon name="search" /> Search everything</button>
      {drawerPanels.length > 0 && (
        <>
          <h3 className="t-tools-head">GM drawer</h3>
          <ul className="list more-list">{drawerPanels.map(row)}</ul>
        </>
      )}
      <ul className="list more-list">{rest.map(row)}</ul>
    </div>
  )
}

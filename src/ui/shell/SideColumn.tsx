/**
 * Desktop side column: panels stacked as collapsible sections, a visible grabber on the inner edge
 * to resize (drag, or focus it and use the arrow keys; Enter or double-click hides the column), a
 * hide button at the grabber's top, and a slim rail with a show button when hidden. The right
 * column ends with a footer carrying the build tag.
 *
 * The column budget (which sections start collapsed, how much height Chat keeps, the 40 vh cap on
 * list panels) lives here and in the "Desktop columns" block of global.css.
 */
import { useRef, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import type { GameController } from '../controller'
import type { PanelDef } from '../panels/registry'
import { BuildTag } from '../BuildTag'
import { Icon } from '../icons'
import { PanelHost } from './PanelHost'

export const COL_MIN = 200
export const COL_MAX = 480
export const RAIL_W = 28
/** Width change per arrow key press on a focused grabber. */
export const KEY_STEP = 16

export const clampWidth = (w: number) => Math.round(Math.min(COL_MAX, Math.max(COL_MIN, w)))

/** Persisted desktop layout (`vtt.shell.desktop`). */
export interface DesktopLayout {
  version: number
  left: { width: number; open: boolean }
  right: { width: number; open: boolean }
  /** Section open state by panel id; a key is present once the user has toggled that section. */
  collapsed: Record<string, boolean>
}

export const DESKTOP_LAYOUT_VERSION = 2

/** Authoring, reference and occasional panels start folded so the table tools, Chat and the sheet get the column. */
export const DEFAULT_COLLAPSED: Readonly<Record<string, boolean>> = { 'skills-editor': true, prep: true, journal: true, sound: true, players: true }
/** Sections that joined DEFAULT_COLLAPSED in version 2; a stored v1 layout gets them unless the user set them. */
const V2_COLLAPSED: Readonly<Record<string, boolean>> = { sound: true, players: true }

export const DESKTOP_DEFAULT: DesktopLayout = {
  version: DESKTOP_LAYOUT_VERSION,
  left: { width: 260, open: true },
  right: { width: 340, open: true },
  collapsed: { ...DEFAULT_COLLAPSED },
}

/**
 * Brings an older stored layout up to the current version. Version 0 (no `version` field) kept
 * every section open by default, so a key in its `collapsed` map means the user toggled that
 * section: those choices win over the new defaults, everything else gets them.
 */
export function migrateDesktopLayout(stored: Record<string, unknown>, storedVersion: number): DesktopLayout {
  const base: DesktopLayout = { ...DESKTOP_DEFAULT, ...(stored as Partial<DesktopLayout>), version: DESKTOP_LAYOUT_VERSION }
  const userCollapsed = stored.collapsed && typeof stored.collapsed === 'object' ? (stored.collapsed as Record<string, boolean>) : {}
  if (storedVersion < 1) base.collapsed = { ...DEFAULT_COLLAPSED, ...userCollapsed }
  else if (storedVersion < 2) base.collapsed = { ...V2_COLLAPSED, ...userCollapsed }
  else base.collapsed = { ...userCollapsed }
  return base
}

/** New width after an arrow key on a column's grabber; `null` when the key is not a resize key. */
export function keyResize(side: 'left' | 'right', key: string, width: number): number | null {
  const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
  const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
  if (key === grow) return clampWidth(width + KEY_STEP)
  if (key === shrink) return clampWidth(width - KEY_STEP)
  if (key === 'Home') return COL_MIN
  if (key === 'End') return COL_MAX
  return null
}

export function SideColumn({ side, panels, width, open, collapsed, controller, onWidth, onOpen, onToggleSection }: {
  side: 'left' | 'right'
  panels: PanelDef[]
  width: number
  open: boolean
  collapsed: Record<string, boolean>
  controller: GameController
  onWidth(w: number): void
  onOpen(open: boolean): void
  onToggleSection(id: string): void
}) {
  const drag = useRef<{ x: number; w: number } | null>(null)
  const cssVar = side === 'left' ? '--left-w' : '--right-w'
  const hideKey = side === 'left' ? '[' : ']'
  const hideGlyph = side === 'left' ? '◂' : '▸'

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, w: width }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const w = clampWidth(d.w + (side === 'left' ? dx : -dx))
    // Write the grid variable directly while dragging; commit to state on release.
    e.currentTarget.closest<HTMLElement>('.game')?.style.setProperty(cssVar, `${w}px`)
  }
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const dx = e.clientX - d.x
    e.currentTarget.closest<HTMLElement>('.game')?.style.removeProperty(cssVar)
    if (Math.abs(dx) > 2) onWidth(clampWidth(d.w + (side === 'left' ? dx : -dx)))
  }
  const keys = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(false); return }
    const w = keyResize(side, e.key, width)
    if (w === null) return
    e.preventDefault()
    if (w !== width) onWidth(w)
  }

  if (!open) {
    return (
      <div className={`col rail col-${side}`}>
        <button type="button" className="icon" aria-label={`Show ${side} panels`} title={`Show panels (${hideKey})`} onClick={() => onOpen(true)}>
          {side === 'left' ? '▸' : '◂'}
        </button>
      </div>
    )
  }

  return (
    <aside className={`col col-${side}`} aria-label={`${side} panels`}>
      <div className="col-scroll">
        {panels.map((def) => {
          const isCollapsed = !!collapsed[def.id]
          const head = (
            <button type="button" className="section-head" aria-expanded={!isCollapsed} onClick={() => onToggleSection(def.id)}>
              <span className="chev" aria-hidden>{isCollapsed ? '▸' : '▾'}</span>
              <Icon name={def.glyph} size={16} className="section-icon" />
              <span className="host-title">{def.title}</span>
            </button>
          )
          return (
            <section key={def.id} className={`section ${isCollapsed ? 'collapsed' : ''} ${def.fill ? 'fill' : ''}`}>
              <PanelHost def={def} controller={controller} head={head} />
            </section>
          )
        })}
      </div>
      {side === 'right' && <div className="col-foot"><span>Build</span><BuildTag inline /></div>}
      <div
        className="handle"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={COL_MIN}
        aria-valuemax={COL_MAX}
        aria-label={`Resize ${side} column`}
        title={`Drag or use the arrow keys to resize; Enter or double-click hides the column (${hideKey})`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={keys}
        onDoubleClick={() => onOpen(false)}
      />
      <button type="button" className="col-hide" aria-label={`Hide ${side} panels`} title={`Hide panels (${hideKey})`} onClick={() => onOpen(false)}>
        {hideGlyph}
      </button>
    </aside>
  )
}

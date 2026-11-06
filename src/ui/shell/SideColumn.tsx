/**
 * Desktop side column: panels stacked as collapsible sections, a drag handle on the inner edge to
 * resize (double-click collapses), and a slim rail with an expand button when collapsed. The right
 * column ends with a footer carrying the build tag.
 */
import { useRef, type PointerEvent as RPointerEvent } from 'react'
import type { GameController } from '../controller'
import type { PanelDef } from '../panels/registry'
import { BuildTag } from '../BuildTag'
import { PanelHost } from './PanelHost'

export const COL_MIN = 200
export const COL_MAX = 480
export const RAIL_W = 28

export const clampWidth = (w: number) => Math.round(Math.min(COL_MAX, Math.max(COL_MIN, w)))

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

  if (!open) {
    return (
      <div className={`col rail col-${side}`}>
        <button type="button" className="icon" aria-label={`Show ${side} panels`} title={`Show panels (${side === 'left' ? '[' : ']'})`} onClick={() => onOpen(true)}>
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
        aria-orientation="vertical"
        aria-label={`Resize ${side} column; double-click to hide`}
        title="Drag to resize, double-click to hide"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => onOpen(false)}
      />
    </aside>
  )
}

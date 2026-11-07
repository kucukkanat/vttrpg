/**
 * Tablet right drawer: a horizontally scrolling tab strip across the top (one tab per visible
 * panel, scroll-snap, hidden scrollbar, a fade on whichever edge hides more tabs, the active tab
 * kept in view), then a title row with the panel's own actions plus pin and hide, then the active
 * panel, then a footer with the build tag. Pinned = docked in the grid (the table shrinks);
 * unpinned = floats over the table's right edge.
 */
import { useEffect, useRef, useState } from 'react'
import type { GameController } from '../controller'
import type { PanelDef } from '../panels/registry'
import { BuildTag } from '../BuildTag'
import { Icon } from '../icons'
import { PanelHost } from './PanelHost'

export interface EdgeFade { start: boolean; end: boolean }

/** Which edges of a horizontal scroller hide content (with a 1px tolerance for fractional widths). */
export function edgeFade(scrollLeft: number, clientWidth: number, scrollWidth: number): EdgeFade {
  return { start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 }
}

/** scrollLeft that brings [left, right] into a viewport of `width` starting at `scrollLeft`, with `pad` px of context. */
export function scrollIntoRange(scrollLeft: number, width: number, left: number, right: number, pad = 0): number {
  if (left - pad < scrollLeft) return Math.max(0, left - pad)
  if (right + pad > scrollLeft + width) return right + pad - width
  return scrollLeft
}

export function Drawer({ panels, active, badges, pinned, controller, onSelect, onPin, onClose }: {
  panels: PanelDef[]
  active: string
  badges: Record<string, number>
  pinned: boolean
  controller: GameController
  onSelect(id: string): void
  onPin(pinned: boolean): void
  onClose(): void
}) {
  const strip = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<EdgeFade>({ start: false, end: false })
  const def = panels.find((p) => p.id === active) ?? panels[0]
  const activeId = def?.id

  // Edge fades follow the scroll position and the strip's size.
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const update = () => setFade(edgeFade(el.scrollLeft, el.clientWidth, el.scrollWidth))
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', update); ro?.disconnect() }
  }, [panels.length])

  // Keep the active tab in view (the persisted tab may be off-screen on first paint).
  useEffect(() => {
    const el = strip.current
    const tab = el?.querySelector<HTMLElement>('.tab.on')
    if (!el || !tab) return
    const target = scrollIntoRange(el.scrollLeft, el.clientWidth, tab.offsetLeft, tab.offsetLeft + tab.offsetWidth, 12)
    if (target !== el.scrollLeft) el.scrollTo({ left: target, behavior: 'smooth' })
  }, [activeId])

  if (!def) return null
  const head = (
    <div className="drawer-head">
      <h2 className="host-title">{def.title}</h2>
      <span className="spacer" />
      <button type="button" className={`icon pin ${pinned ? 'on' : ''}`} aria-pressed={pinned} aria-label={pinned ? 'Unpin drawer' : 'Pin drawer open'} title={pinned ? 'Unpin: float over the table' : 'Pin: dock beside the table'} onClick={() => onPin(!pinned)}><Icon name="tack" /></button>
      <button type="button" className="icon" aria-label="Hide drawer" onClick={onClose}><Icon name="close" /></button>
    </div>
  )
  return (
    <aside className={`drawer ${pinned ? 'pinned' : 'floating'}`} aria-label="Panels">
      <div className={`drawer-strip ${fade.start ? 'fade-start' : ''} ${fade.end ? 'fade-end' : ''}`}>
        <div className="drawer-tabs" role="tablist" ref={strip}>
          {panels.map((p) => {
            const n = badges[p.id] ?? 0
            const on = p.id === def.id
            return (
              <button key={p.id} type="button" role="tab" aria-selected={on} aria-label={n > 0 ? `${p.title}, ${n} unread` : p.title} className={`tab ${on ? 'on' : ''}`} onClick={() => onSelect(p.id)}>
                <span className="glyph" aria-hidden><Icon name={p.glyph} /></span>
                <span className="lbl">{p.short}</span>
                {n > 0 && <span className="badge" aria-hidden>{n > 99 ? '99+' : n}</span>}
              </button>
            )
          })}
        </div>
      </div>
      <PanelHost key={def.id} def={def} controller={controller} head={head} />
      <div className="drawer-foot"><span>Build</span><BuildTag inline /></div>
    </aside>
  )
}

/**
 * Phone bottom sheet. Lives in the `table` grid area (as `.sheet-area`, pointer-events none) so it
 * overlaps the table without being inside the canvas container. Half = 55% of the area, full = the
 * whole area minus the keyboard. The header row is the drag surface: vertical drags resize, a
 * horizontal swipe switches tabs, dragging below 60% of half closes. Esc closes too; focus moves to
 * the title on open and back to the opener on close.
 *
 * Hosts a registry panel (`def`) or, when `def` is omitted, arbitrary `children` under the same
 * header (the More list).
 */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import type { GameController } from '../controller'
import type { PanelDef } from '../panels/registry'
import { PanelHost } from './PanelHost'
import { Icon } from '@/ui/icons'

export type SheetSize = 'half' | 'full'

export interface SnapInput { height: number; half: number; full: number; dx: number; dy: number }
export type SnapResult = { kind: 'close' } | { kind: 'size'; size: SheetSize } | { kind: 'tab'; dir: 1 | -1 }

export const HALF_RATIO = 0.55

export function snapSheet(i: SnapInput): SnapResult {
  if (Math.abs(i.dx) > 60 && Math.abs(i.dy) < 40) return { kind: 'tab', dir: i.dx < 0 ? 1 : -1 }
  if (i.height < i.half * 0.6) return { kind: 'close' }
  if (i.height > i.half + (i.full - i.half) * 0.5) return { kind: 'size', size: 'full' }
  return { kind: 'size', size: 'half' }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function BottomSheet({ def, title, children, controller, size, keyboard, onSize, onClose, onSwipeTab }: {
  /** Panel to host; omit to render `children` under the header instead. */
  def?: PanelDef
  /** Header title; defaults to the panel's title. */
  title?: string
  children?: ReactNode
  controller: GameController
  size: SheetSize
  /** On-screen keyboard overlap in px; the sheet shrinks by it and goes full while it is open. */
  keyboard: number
  onSize(size: SheetSize): void
  onClose(): void
  onSwipeTab(dir: 1 | -1): void
}) {
  const area = useRef<HTMLDivElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const drag = useRef<{ x: number; y: number; h: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const label = title ?? def?.title ?? ''

  // Focus: the title takes focus on open so a keyboard user lands in the sheet instead of tabbing
  // through the remaining tabs first; on close focus returns to whatever opened it (the tab).
  useEffect(() => {
    const el = sheet.current
    const opener = document.activeElement
    const outside = opener instanceof HTMLElement && !el?.contains(opener) ? opener : null
    heading.current?.focus({ preventScroll: true })
    return () => {
      // Only restore when focus leaves with the sheet; a tap on another tab keeps the focus it took.
      const now = document.activeElement
      const stranded = !now || now === document.body || !now.isConnected || !!el?.contains(now)
      if (stranded && outside?.isConnected) outside.focus({ preventScroll: true })
    }
  }, [])

  // Esc closes the sheet; while typing, the first Esc only leaves the field and the next one closes.
  const latestClose = useRef(onClose)
  latestClose.current = onClose
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const field = e.target instanceof Element ? e.target.closest<HTMLElement>('input, textarea, select, [contenteditable="true"]') : null
      if (field) { field.blur(); return }
      e.preventDefault()
      latestClose.current()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])

  const fullHeight = () => (area.current?.clientHeight ?? 0) - keyboard

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !sheet.current) return
    if ((e.target as HTMLElement).closest('button')) return // let the head buttons click
    drag.current = { x: e.clientX, y: e.clientY, h: sheet.current.getBoundingClientRect().height }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || !sheet.current) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dy) < 40) return // horizontal: tab swipe, decided on release
    sheet.current.style.height = `${clamp(d.h - dy, 0, fullHeight())}px`
  }
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (!d || !sheet.current) return
    const height = sheet.current.getBoundingClientRect().height
    sheet.current.style.height = ''
    const full = fullHeight()
    const r = snapSheet({ height, half: full * HALF_RATIO, full, dx: e.clientX - d.x, dy: e.clientY - d.y })
    if (r.kind === 'close') onClose()
    else if (r.kind === 'tab') onSwipeTab(r.dir)
    else onSize(r.size)
  }

  const cls = ['bsheet', size, dragging ? 'dragging' : '', keyboard > 0 ? 'kb' : ''].filter(Boolean).join(' ')
  const head = (
    <div className="bsheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <span className="grip" aria-hidden />
      <button type="button" className="icon sheet-size" aria-label={size === 'full' ? 'Shrink panel' : 'Expand panel'} onClick={() => onSize(size === 'full' ? 'half' : 'full')}>
        <Icon name={size === 'full' ? 'chevron-down' : 'chevron-up'} />
      </button>
      <h2 className="host-title" ref={heading} tabIndex={-1}>{label}</h2>
      <button type="button" className="icon sheet-close" aria-label="Close panel" onClick={onClose}><Icon name="close" /></button>
    </div>
  )
  return (
    <div className="sheet-area" ref={area}>
      <div className={cls} ref={sheet} role="dialog" aria-label={label}>
        {def ? <PanelHost def={def} controller={controller} head={head} /> : <div className="hosted">{head}{children}</div>}
      </div>
    </div>
  )
}

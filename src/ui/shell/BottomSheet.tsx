/**
 * Phone bottom sheet. Lives in the `table` grid area (as `.sheet-area`, pointer-events none) so it
 * overlaps the table without being inside the canvas container. Half = 55% of the area, full = the
 * whole area minus the keyboard. The header row is the drag surface: vertical drags resize, a
 * horizontal swipe switches tabs, dragging below 60% of half closes.
 */
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import type { GameController } from '../controller'
import type { PanelDef } from '../panels/registry'
import { PanelHost } from './PanelHost'

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

export function BottomSheet({ def, controller, size, keyboard, onSize, onClose, onSwipeTab }: {
  def: PanelDef
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
  const drag = useRef<{ x: number; y: number; h: number } | null>(null)
  const [dragging, setDragging] = useState(false)

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
        {size === 'full' ? '⌄' : '⌃'}
      </button>
      <h2 className="host-title">{def.title}</h2>
      <button type="button" className="icon sheet-close" aria-label="Close panel" onClick={onClose}>✕</button>
    </div>
  )
  return (
    <div className="sheet-area" ref={area}>
      <div className={cls} ref={sheet} role="dialog" aria-label={def.title}>
        <PanelHost def={def} controller={controller} head={head} />
      </div>
    </div>
  )
}

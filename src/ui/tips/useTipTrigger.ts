/**
 * Pointer and keyboard handlers that open tooltips from a control (see tips.ts):
 *
 *   mouse or pen hover   shows the tip after HOVER_MS; leaving hides it (unless pinned)
 *   keyboard focus       shows it at once; `i` or `?` pins it and moves focus into it
 *   finger held          HOLD_MS pins it, and the click that follows the lift is swallowed so a
 *                        held skill chip shows its tip instead of casting
 *
 * `pinOnClick` is the tap-to-pin variant for controls that do nothing else (status badges).
 */
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { haptic } from '../feedback/haptics'
import { rectOf, tipDispatch, useTips, type TipContent } from './tips'

export const HOVER_MS = 400
export const HOLD_MS = 450
export const HIDE_MS = 160
const SLOP_PX = 10

let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let hold: { timer: ReturnType<typeof setTimeout>; x: number; y: number; id: number } | null = null
/** The control whose hold just pinned a tip: its next click is swallowed. */
let swallowClick: Element | null = null

const clear = (t: ReturnType<typeof setTimeout> | null) => { if (t) clearTimeout(t) }

/** Keep a hover tip open (the pointer moved onto it). */
export function keepTip(): void { clear(hideTimer); hideTimer = null }

/** Hide the hover tip shortly, so the pointer can cross from the control onto the tip. */
export function hideTipSoon(): void {
  clear(showTimer); showTimer = null
  clear(hideTimer)
  hideTimer = setTimeout(() => { hideTimer = null; tipDispatch({ type: 'unhover' }) }, HIDE_MS)
}

/** Focus the newest pinned tip (after React has drawn it). */
export function focusTopTip(): void {
  requestAnimationFrame(() => {
    const cards = document.querySelectorAll<HTMLElement>('.tip-card')
    const card = cards[cards.length - 1]
    ;(card?.querySelector<HTMLElement>('.tip-term, .tip-close') ?? card)?.focus()
  })
}

function focusVisible(el: Element): boolean {
  try { return el.matches(':focus-visible') } catch { return true }
}

export function tipTriggerProps(content: () => TipContent) {
  const show = (el: Element) => { keepTip(); tipDispatch({ type: 'hover', tip: { content: content(), anchor: rectOf(el), opener: el as HTMLElement } }) }
  const pin = (el: Element) => { keepTip(); tipDispatch({ type: 'pin', tip: { content: content(), anchor: rectOf(el), opener: el as HTMLElement } }) }
  const endHold = () => { if (hold) { clearTimeout(hold.timer); hold = null } }
  return {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch') return
      const el = e.currentTarget
      keepTip()
      clear(showTimer)
      showTimer = setTimeout(() => { showTimer = null; show(el) }, HOVER_MS)
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => { if (e.pointerType !== 'touch') hideTipSoon() },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return
      endHold()
      const el = e.currentTarget
      hold = {
        x: e.clientX, y: e.clientY, id: e.pointerId,
        timer: setTimeout(() => { hold = null; swallowClick = el; pin(el); haptic('press') }, HOLD_MS),
      }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP_PX) endHold()
    },
    onPointerUp: endHold,
    onPointerCancel: endHold,
    onClickCapture: (e: MouseEvent<HTMLElement>) => {
      if (swallowClick !== e.currentTarget) return
      swallowClick = null
      e.preventDefault()
      e.stopPropagation()
    },
    onContextMenu: (e: MouseEvent<HTMLElement>) => { if (hold || swallowClick) e.preventDefault() },
    onFocus: (e: FocusEvent<HTMLElement>) => { if (focusVisible(e.currentTarget)) show(e.currentTarget) },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      const to = e.relatedTarget as Element | null
      if (to?.closest?.('.tip-card')) return
      hideTipSoon()
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'i' && e.key !== '?') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      pin(e.currentTarget)
      if (useTips.getState().stack.length) focusTopTip()
    },
  }
}

type Handlers = Record<string, ((e: never) => void) | undefined>

/** Both sets of handlers on one element: where both handle an event, both run (`a` first). */
export function mergeHandlers<A extends Handlers, B extends Handlers>(a: A, b: B): A & B {
  const out: Handlers = { ...a, ...b }
  for (const k of Object.keys(a)) {
    const fa = a[k]
    const fb = b[k]
    if (fa && fb) out[k] = (e: never) => { fa(e); fb(e) }
  }
  return out as A & B
}

/** Tap-to-pin for controls whose only job is to explain (status badges); a second tap closes it. */
export function pinOnClick(content: () => TipContent) {
  const hover = tipTriggerProps(content)
  return {
    onPointerEnter: hover.onPointerEnter,
    onPointerLeave: hover.onPointerLeave,
    onFocus: hover.onFocus,
    onBlur: hover.onBlur,
    onClick: (e: MouseEvent<HTMLElement>) => {
      keepTip()
      clear(showTimer); showTimer = null
      tipDispatch({ type: 'pin', tip: { content: content(), anchor: rectOf(e.currentTarget), opener: e.currentTarget } })
      // A keyboard press (no pointer position) moves focus into the tip.
      if (e.detail === 0 && useTips.getState().stack.length) focusTopTip()
    },
  }
}

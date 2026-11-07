/**
 * Same-frame press feedback for every button. Browsers apply `:active` late on touch (iOS waits
 * to see whether the finger scrolls), so a capture-phase `pointerdown` on the window marks the
 * pressed control with `.is-pressed` before the next paint; global.css draws a glow wider than a
 * fingertip around it, so the press reads even while the finger covers the control. The mark
 * goes on `pointerup` / `pointercancel`, or after a second as a safety net. Touch presses also get
 * a short haptic tick (`haptics.ts`) when the viewer has them on.
 */
import { haptic } from './haptics'

/** What counts as a pressable control. */
export const PRESSABLE = 'button, [role="button"], [role="menuitem"], [role="tab"], .pressable'
export const PRESSED_CLASS = 'is-pressed'
const SAFETY_MS = 1000

interface Closest { closest(selector: string): Element | null }

/** The control a press on `target` lands on, unless it is disabled. */
export function pressTarget(target: unknown): Element | null {
  if (!target || typeof (target as Closest).closest !== 'function') return null
  const el = (target as Closest).closest(PRESSABLE)
  if (!el) return null
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null
  return el
}

let installed = false

/** Install once per page; returns an uninstall function (tests, hot reload). */
export function installPressFeedback(win: Window = window): () => void {
  if (installed) return () => {}
  installed = true
  const pressed = new Map<number, { el: Element; timer: ReturnType<typeof setTimeout> }>()
  const release = (id: number) => {
    const p = pressed.get(id)
    if (!p) return
    clearTimeout(p.timer)
    p.el.classList.remove(PRESSED_CLASS)
    pressed.delete(id)
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    const el = pressTarget(e.target)
    if (!el) return
    release(e.pointerId)
    el.classList.add(PRESSED_CLASS)
    pressed.set(e.pointerId, { el, timer: setTimeout(() => release(e.pointerId), SAFETY_MS) })
    if (e.pointerType === 'touch') haptic('press')
  }
  const onUp = (e: PointerEvent) => release(e.pointerId)
  win.addEventListener('pointerdown', onDown, true)
  win.addEventListener('pointerup', onUp, true)
  win.addEventListener('pointercancel', onUp, true)
  return () => {
    installed = false
    for (const id of [...pressed.keys()]) release(id)
    win.removeEventListener('pointerdown', onDown, true)
    win.removeEventListener('pointerup', onUp, true)
    win.removeEventListener('pointercancel', onUp, true)
  }
}

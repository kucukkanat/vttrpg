/**
 * Per-device feel preferences, kept in localStorage like "Skip 3D dice" (`dice/skipDice.ts`):
 *
 *   haptics      short vibrations on presses, commits and your turn (where `navigator.vibrate` exists)
 *   turnCue      a chime and a ring flare when your token's turn starts
 *   twoTapMove   touch: tap a cell to preview a move, tap it again to commit (off: drag only)
 *
 * All default to on. Readers outside React call `readPref`; components use `usePref` so every
 * mount updates when the Players panel flips a box.
 */
import { useEffect, useState } from 'react'

export type FeelPref = 'haptics' | 'turnCue' | 'twoTapMove'

export const PREF_KEYS: Record<FeelPref, string> = {
  haptics: 'vtt.haptics',
  turnCue: 'vtt.turnCue',
  twoTapMove: 'vtt.twoTapMove',
}
const EVENT = 'vtt:prefs'

/** Stored value; missing or unreadable storage means the default (on). */
export function readPref(pref: FeelPref): boolean {
  try { return localStorage.getItem(PREF_KEYS[pref]) !== '0' } catch { return true }
}

export function setPref(pref: FeelPref, on: boolean): void {
  try {
    if (on) localStorage.removeItem(PREF_KEYS[pref])
    else localStorage.setItem(PREF_KEYS[pref], '0')
  } catch { /* private mode, quota */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

/** The preference, live across components and tabs. */
export function usePref(pref: FeelPref): boolean {
  const [on, setOn] = useState(() => readPref(pref))
  useEffect(() => {
    const sync = () => setOn(readPref(pref))
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync) }
  }, [pref])
  return on
}

/** The system asks for less motion: new shakes, hit-stops, flares and slides are skipped. */
export function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

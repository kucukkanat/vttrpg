/**
 * "Skip 3D dice": a per-device preference in localStorage, plus the system's reduced-motion
 * setting. When either holds, `DiceTrayOverlay` renders nothing and rolls are read from the toast
 * and chat alone. Writers call `setSkipDice`; readers use the hook so every mount updates at once.
 */
import { useEffect, useState } from 'react'

export const SKIP_DICE_KEY = 'vtt.skipDice'
const EVENT = 'vtt:skipDice'
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

export function readSkipDice(): boolean {
  try { return localStorage.getItem(SKIP_DICE_KEY) === '1' } catch { return false }
}

export function setSkipDice(skip: boolean): void {
  try {
    if (skip) localStorage.setItem(SKIP_DICE_KEY, '1')
    else localStorage.removeItem(SKIP_DICE_KEY)
  } catch { /* private mode, quota */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

/** The stored preference, live across components and tabs. */
export function useSkipDicePreference(): boolean {
  const [skip, setSkip] = useState(readSkipDice)
  useEffect(() => {
    const on = () => setSkip(readSkipDice())
    window.addEventListener(EVENT, on)
    window.addEventListener('storage', on)
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on) }
  }, [])
  return skip
}

/** `window.matchMedia(query).matches`, kept current; false where matchMedia is missing (tests). */
export function useMatchMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [match, setMatch] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/** True when 3D dice should not be shown: the preference is on or the system asks for reduced motion. */
export function useSkipDice(): boolean {
  const pref = useSkipDicePreference()
  const reduce = useMatchMedia(REDUCED_MOTION)
  return pref || reduce
}

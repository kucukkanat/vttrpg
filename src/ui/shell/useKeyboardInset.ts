/**
 * Height of the on-screen keyboard overlapping the layout viewport, in px. iOS Safari keeps the
 * layout viewport fixed and shrinks only `visualViewport`, so bottom-anchored UI must move up by
 * this much. On browsers that resize the layout viewport instead (`interactive-widget=resizes-content`)
 * this stays 0, which is also correct.
 */
import { useEffect, useState } from 'react'

export function keyboardInset(innerHeight: number, vv: { height: number; offsetTop: number } | null): number {
  if (!vv) return 0
  return Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const on = () => {
      setInset(keyboardInset(window.innerHeight, vv))
      // Safari scrolls the page to reveal the focused field; we move the sheet instead.
      if (vv.offsetTop > 0 && window.scrollY > 0) window.scrollTo(0, 0)
    }
    const late = () => setTimeout(on, 50)
    vv.addEventListener('resize', on)
    vv.addEventListener('scroll', on)
    window.addEventListener('focusin', on)
    window.addEventListener('focusout', late)
    on()
    return () => {
      vv.removeEventListener('resize', on)
      vv.removeEventListener('scroll', on)
      window.removeEventListener('focusin', on)
      window.removeEventListener('focusout', late)
    }
  }, [])
  return inset
}

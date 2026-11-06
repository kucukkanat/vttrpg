/**
 * Layout breakpoint from viewport width. See docs/UX.md.
 *   phone   < 700px   bottom tab bar + sheet
 *   tablet  700–1099  right drawer with tabs
 *   desktop >= 1100   three columns
 */
import { useEffect, useState } from 'react'

export type Breakpoint = 'phone' | 'tablet' | 'desktop'

export const PHONE_MAX = 699.98
export const TABLET_MAX = 1099.98

export function breakpointFor(width: number): Breakpoint {
  if (width <= PHONE_MAX) return 'phone'
  if (width <= TABLET_MAX) return 'tablet'
  return 'desktop'
}

const read = (): Breakpoint => (typeof window === 'undefined' ? 'desktop' : breakpointFor(window.innerWidth))

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(read)
  useEffect(() => {
    const phone = window.matchMedia(`(max-width: ${PHONE_MAX}px)`)
    const tablet = window.matchMedia(`(max-width: ${TABLET_MAX}px)`)
    const on = () => setBp(read())
    phone.addEventListener('change', on)
    tablet.addEventListener('change', on)
    window.addEventListener('resize', on)
    on()
    return () => {
      phone.removeEventListener('change', on)
      tablet.removeEventListener('change', on)
      window.removeEventListener('resize', on)
    }
  }, [])
  return bp
}

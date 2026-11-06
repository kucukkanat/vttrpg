/**
 * Layout breakpoint from viewport width. See docs/UX.md.
 *   phone   < 700px   bottom tab bar + sheet
 *   tablet  700–1099  right drawer with tabs
 *   desktop >= 1100   three columns
 */
import { useMediaQuery } from '../useMediaQuery'

export type Breakpoint = 'phone' | 'tablet' | 'desktop'

export const PHONE_MAX = 699.98
export const TABLET_MAX = 1099.98

export function breakpointFor(width: number): Breakpoint {
  if (width <= PHONE_MAX) return 'phone'
  if (width <= TABLET_MAX) return 'tablet'
  return 'desktop'
}

export function useBreakpoint(): Breakpoint {
  const phone = useMediaQuery(`(max-width: ${PHONE_MAX}px)`)
  const tablet = useMediaQuery(`(max-width: ${TABLET_MAX}px)`)
  return phone ? 'phone' : tablet ? 'tablet' : 'desktop'
}

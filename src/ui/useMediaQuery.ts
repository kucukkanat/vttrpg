import { useEffect, useState } from 'react'

/** True when the primary pointer is a finger (phones, most tablets): targets grow and copy says "tap". */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)')
}

/**
 * The verb for the primary pointer, for instructional copy: "Tap" on touch screens, "Click" with a
 * mouse. Pass `lower` for mid-sentence use. Pair with `useCoarsePointer()`.
 */
export function verb(coarse: boolean, lower = false): string {
  const v = coarse ? 'Tap' : 'Click'
  return lower ? v.toLowerCase() : v
}

export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches
  const [match, setMatch] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

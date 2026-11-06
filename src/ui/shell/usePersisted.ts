/** `useState` mirrored to localStorage; stored objects are shallow-merged over the defaults so new keys get defaults. */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

function load<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return initial
    const parsed = JSON.parse(raw) as unknown
    if (initial && typeof initial === 'object' && !Array.isArray(initial) && parsed && typeof parsed === 'object') {
      return { ...(initial as object), ...(parsed as object) } as T
    }
    return parsed as T
  } catch { return initial }
}

export function usePersisted<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => load(key, initial))
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode, quota */ }
  }, [key, value])
  return [value, setValue]
}

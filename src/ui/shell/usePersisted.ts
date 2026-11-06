/**
 * `useState` mirrored to localStorage; stored objects are shallow-merged over the defaults so new
 * keys get defaults. A `version` option runs a one-time migration when the stored object's
 * `version` field differs from the current one, so defaults can change under existing users
 * without discarding what they set themselves.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export interface PersistOptions<T> {
  /** Current schema version; stored under a `version` key on the persisted object. */
  version: number
  /** Builds the current shape from an older stored object (its `version` may be missing). */
  migrate(stored: Record<string, unknown>, storedVersion: number): T
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Pure counterpart of the hook's initial read: turns the raw stored string into state. */
export function loadPersisted<T>(raw: string | null, initial: T, options?: PersistOptions<T>): T {
  if (!raw) return initial
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return initial }
  if (isRecord(initial) && isRecord(parsed)) {
    if (options) {
      const storedVersion = typeof parsed.version === 'number' ? parsed.version : 0
      if (storedVersion !== options.version) return options.migrate(parsed, storedVersion)
    }
    return { ...initial, ...parsed } as T
  }
  return parsed as T
}

function load<T>(key: string, initial: T, options?: PersistOptions<T>): T {
  try { return loadPersisted(localStorage.getItem(key), initial, options) } catch { return initial }
}

export function usePersisted<T>(key: string, initial: T, options?: PersistOptions<T>): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => load(key, initial, options))
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode, quota */ }
  }, [key, value])
  return [value, setValue]
}

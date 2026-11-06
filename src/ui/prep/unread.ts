/**
 * Which journal notes this device has read, as the `updatedAt` seen per note. A note is unread
 * when it has never been opened here or was changed since. localStorage only; never synced.
 */
import type { Note } from '@/core/doc'

const KEY = 'vtt.journal.read'

type ReadMap = Record<string, number>

export function loadRead(): ReadMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ReadMap) : {}
  } catch { return {} }
}

export function markRead(map: ReadMap, note: Note): ReadMap {
  if (map[note.id] === note.updatedAt) return map
  const next = { ...map, [note.id]: note.updatedAt }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode, quota */ }
  return next
}

export function isUnread(map: ReadMap, note: Note): boolean {
  return (map[note.id] ?? -1) < note.updatedAt
}

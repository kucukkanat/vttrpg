/**
 * Which Inspector sections are open, per device. Sections start folded; opening or closing one is
 * remembered under its id (e.g. "scene.grid", "token.vision") in localStorage.
 */
import { create } from 'zustand'

export const FOLDS_KEY = 'vtt.build.folds'

/** The stored map of open sections; anything unreadable is treated as "all folded". */
export function readFolds(raw: string | null): Record<string, boolean> {
  if (!raw) return {}
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter(([, on]) => typeof on === 'boolean')) as Record<string, boolean>
  } catch {
    return {}
  }
}

function load(): Record<string, boolean> {
  try { return readFolds(localStorage.getItem(FOLDS_KEY)) } catch { return {} }
}

interface FoldsState {
  open: Record<string, boolean>
  setOpen(id: string, open: boolean): void
}

export const useFolds = create<FoldsState>((set, get) => ({
  open: load(),
  setOpen: (id, on) => {
    if (!!get().open[id] === on) return
    const open = { ...get().open, [id]: on }
    set({ open })
    try { localStorage.setItem(FOLDS_KEY, JSON.stringify(open)) } catch { /* private mode, quota */ }
  },
}))

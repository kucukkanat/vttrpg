/**
 * The bell: things waiting for you, kept until handled. A toast fades after a few seconds; when it
 * carries an action (a whisper to open, a handout to read, an undo) the same item also waits here,
 * so looking away from the table never loses it. Running the action, or dismissing the item,
 * clears it. UI-only; never synced.
 */
import { create } from 'zustand'

export interface AttentionItem {
  /** Replaces an earlier item with the same key (one per whisper, one per handout…). */
  key: string
  text: string
  at: number
  action?: { label: string; run(): void }
}

interface AttentionState {
  items: AttentionItem[]
  add(item: Omit<AttentionItem, 'at'> & { at?: number }): void
  remove(key: string): void
  clear(): void
}

/** Oldest items drop off past this many. */
export const MAX_ATTENTION = 30

export const useAttention = create<AttentionState>((set) => ({
  items: [],
  add: (item) => set((s) => {
    const next = s.items.filter((i) => i.key !== item.key)
    next.unshift({ ...item, at: item.at ?? Date.now() })
    return { items: next.slice(0, MAX_ATTENTION) }
  }),
  remove: (key) => set((s) => (s.items.some((i) => i.key === key) ? { items: s.items.filter((i) => i.key !== key) } : s)),
  clear: () => set({ items: [] }),
}))

/** Run an item's action and take it off the list. */
export function handleAttention(item: AttentionItem): void {
  useAttention.getState().remove(item.key)
  item.action?.run()
}

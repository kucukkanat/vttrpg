/**
 * Transient notifications shown over the table (see shell/Toasts.tsx for the rendering).
 *
 *   pushToast({ text: 'Removed Rat Guard', action: { label: 'Undo', run: () => void undoLast() }, ttl: 5000 })
 *
 * - `text` is the message; keep it to one line.
 * - `action` adds a single button; `run` is called once and the toast closes. The toast also waits
 *   in the bell (ui/attention.ts) until the action runs or the item is dismissed there.
 * - `ttl` in ms (default 5000). Pass 0 to keep the toast until dismissed.
 * - `key` replaces an earlier toast with the same key instead of stacking (status-style updates).
 * `pushToast` returns the toast id; `dismissToast(id)` closes it early. Any module may push;
 * the store is UI-only and never reaches the game document.
 */
import { create } from 'zustand'
import { useAttention } from './attention'

export interface ToastAction {
  label: string
  run(): void
}

export interface ToastInput {
  text: string
  action?: ToastAction
  /** Milliseconds before auto-dismiss; 0 = sticky. Default 5000. */
  ttl?: number
  /** Toasts with the same key replace each other. */
  key?: string
}

export interface Toast extends ToastInput {
  id: string
  at: number
}

interface ToastState {
  toasts: Toast[]
  push(input: ToastInput): string
  dismiss(id: string): void
}

export const DEFAULT_TOAST_TTL = 5000
/** Oldest toasts drop off past this many on screen. */
export const MAX_TOASTS = 3

const timers = new Map<string, ReturnType<typeof setTimeout>>()
let seq = 0

function clearTimer(id: string) {
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.delete(id)
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(input) {
    const id = `toast-${++seq}`
    // A toast with an action also waits in the bell until handled (ui/attention.ts); running it
    // from either place clears both.
    const attentionKey = input.key ?? id
    const action = input.action && {
      label: input.action.label,
      run: () => { useAttention.getState().remove(attentionKey); input.action!.run() },
    }
    if (action) useAttention.getState().add({ key: attentionKey, text: input.text, action })
    const toast: Toast = { ...input, action, id, at: Date.now() }
    set((s) => {
      const next = s.toasts.filter((t) => {
        const replaced = !!input.key && t.key === input.key
        if (replaced) clearTimer(t.id)
        return !replaced
      })
      next.push(toast)
      while (next.length > MAX_TOASTS) clearTimer(next.shift()!.id)
      return { toasts: next }
    })
    const ttl = input.ttl ?? DEFAULT_TOAST_TTL
    if (ttl > 0) timers.set(id, setTimeout(() => get().dismiss(id), ttl))
    return id
  },
  dismiss(id) {
    clearTimer(id)
    set((s) => (s.toasts.some((t) => t.id === id) ? { toasts: s.toasts.filter((t) => t.id !== id) } : s))
  },
}))

export const pushToast = (input: ToastInput): string => useToasts.getState().push(input)
export const dismissToast = (id: string): void => useToasts.getState().dismiss(id)

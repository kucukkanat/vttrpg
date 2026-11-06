/**
 * Desktop keyboard shortcuts for the shell. Ignored while typing in a field or when a modifier is
 * held, so browser shortcuts and the table's own keys (G, Delete, Esc) keep working.
 */
import { useEffect } from 'react'

export interface ShortcutHandlers {
  toggleLeft(): void
  toggleRight(): void
  focusChat(): void
  /** 1-based index into the visible panel list. */
  togglePanel(n: number): void
}

export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

export function useShortcuts(enabled: boolean, handlers: ShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(document.activeElement)) {
        if (e.key === 'Escape') (document.activeElement as HTMLElement).blur()
        return
      }
      switch (e.key) {
        case '[': e.preventDefault(); handlers.toggleLeft(); break
        case ']': e.preventDefault(); handlers.toggleRight(); break
        case 'c': case 'C': e.preventDefault(); handlers.focusChat(); break
        default:
          if (/^[1-9]$/.test(e.key)) { e.preventDefault(); handlers.togglePanel(Number(e.key)) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, handlers])
}

/** Focus the chat input wherever the chat panel is mounted. */
export function focusChatInput(): boolean {
  const el = document.querySelector<HTMLInputElement>('.chat .chatform input')
  if (!el) return false
  el.focus()
  return true
}

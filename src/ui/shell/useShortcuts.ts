/**
 * Desktop keyboard shortcuts for the shell. Ignored while typing in a field or when a modifier is
 * held, so browser shortcuts and the table's own keys (G grid, F first person, C camera, Delete, Esc) keep working.
 * M toggles the ruler tool while a table is mounted.
 */
import { useEffect } from 'react'
import { undoLast } from '@/state/undo'
import { useTableUi } from '@/table/tableState'
import { pushToast } from '../toasts'

export interface ShortcutHandlers {
  toggleLeft(): void
  toggleRight(): void
  focusChat(): void
  /** 1-based index into the visible panel list. */
  togglePanel(n: number): void
  /** Show a panel wherever the current layout keeps it; answers `requestOpenPanel`. */
  openPanel?(id: string): void
}

/** Window event panels use to ask the shell for another panel (Tokens row "Edit" opens the Edit panel). */
export const OPEN_PANEL_EVENT = 'vtt:open-panel'

export function requestOpenPanel(id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: { id } }))
}

/**
 * Fallback when the shell did not hand over `openPanel`: expand the panel's desktop section if it
 * is collapsed and scroll it into view. Does nothing when the panel is not mounted (phone sheet).
 */
function revealMountedPanel(id: string) {
  const host = document.querySelector<HTMLElement>(`[data-panel="${id}"]`)
  if (!host) return
  host.querySelector<HTMLButtonElement>('.section-head[aria-expanded="false"]')?.click()
  host.scrollIntoView?.({ block: 'nearest' })
}

export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

/** Cmd/Ctrl+Z (no Shift/Alt) outside a field: undo the GM's last destructive action. */
export function isUndoKey(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z'
}

export function useShortcuts(enabled: boolean, handlers: ShortcutHandlers) {
  // Undo works on every layout with a keyboard; it is a no-op for players (nothing on the stack).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isUndoKey(e) || isTypingTarget(document.activeElement)) return
      e.preventDefault()
      void undoLast().then((entry) => entry && pushToast({ text: `Restored ${entry.subject}`, ttl: 2500 }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Panels open each other through a window event so they need no shell props; every layout listens.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (!id) return
      if (handlers.openPanel) handlers.openPanel(id)
      else revealMountedPanel(id)
    }
    window.addEventListener(OPEN_PANEL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen)
  }, [handlers])

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
        case '/': e.preventDefault(); handlers.focusChat(); break
        case 'm': case 'M': {
          // Ruler tool on the table (the HUD button does the same on touch).
          const ui = useTableUi.getState()
          if (ui.cameraActive) ui.set({ tool: ui.tool === 'ruler' ? null : 'ruler' })
          break
        }
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

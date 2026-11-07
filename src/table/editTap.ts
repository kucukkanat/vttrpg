/**
 * Double tap (or double-click) to edit: a double tap on a token or prop puts it in edit mode with
 * the full gizmo (move, turn, scale); a double tap anywhere while editing, the item included,
 * leaves edit mode. Taps are tracked here, outside React, because tokens, props, scene parts and
 * the empty floor each report their own taps.
 */
import { useGame, type Selection } from '@/state/store'
import { isDoubleTap, type Tap } from './ping'
import { useTableUi } from './tableState'

let last: (Tap & { key: string }) | null = null

/** Records a tap on `key`; true when it completes a double tap on the same key. */
export function tapTwice(key: string, x: number, y: number, at = performance.now()): boolean {
  const tap = { x, y, at }
  const double = last !== null && last.key === key && isDoubleTap(last, tap)
  last = double ? null : { ...tap, key }
  return double
}

/** Forget the pending first tap (a drag or gesture happened in between). */
export function resetTaps(): void {
  last = null
}

/**
 * Acts on a double tap: while editing, any double tap leaves edit mode; otherwise a double tap on
 * `target` selects it and enters edit mode. Returns whether it did anything.
 */
export function doubleTapEdit(target: Selection | null): boolean {
  const ui = useTableUi.getState()
  if (ui.editMode) {
    ui.set({ editMode: false, editPreview: null, editDrag: false })
    return true
  }
  if (!target) return false
  useGame.getState().setSelection(target)
  ui.set({ editMode: true, contextMenu: null })
  return true
}

/** Enter edit mode on `target` directly (context menu "Edit"). */
export function startEditing(target: Selection): void {
  useGame.getState().setSelection(target)
  useTableUi.getState().set({ editMode: true, contextMenu: null })
}

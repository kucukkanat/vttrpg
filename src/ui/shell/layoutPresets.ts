/**
 * Layout presets: Standard (the table layout, sized to the screen), Compact (the phone arrangement
 * at any width: bottom bar and sheets over a wide board) and Display (a TV or shared screen: the
 * board, the turn order and the dice only). Per device. Pure, so the shell and the tests share it.
 * See docs/UX.md, "Layout presets".
 */
import type { Breakpoint } from './useBreakpoint'

export type LayoutPresetId = 'auto' | 'compact' | 'display'

export interface LayoutPresetDef {
  id: LayoutPresetId
  label: string
  hint: string
}

export const LAYOUT_PRESETS: readonly LayoutPresetDef[] = [
  { id: 'auto', label: 'Standard', hint: 'The table, fitted to the screen' },
  { id: 'compact', label: 'Compact', hint: 'Phone layout on any screen: bottom bar and sheets over a wide board' },
  { id: 'display', label: 'Display', hint: 'For a TV or shared screen: the board, turn order and dice only' },
]

/** The arrangement to render: `compact` uses the phone layout at any width. */
export function presetBreakpoint(id: LayoutPresetId, device: Breakpoint): Breakpoint {
  return id === 'compact' ? 'phone' : device
}

/** Display hides every control; Zen (a separate toggle) hides the read-outs too. */
export const isDisplayPreset = (id: LayoutPresetId) => id === 'display'

/** The preset a device starts with when it never picked one. */
export const DEFAULT_PRESET: LayoutPresetId = 'auto'

/** Stored ids from the column layouts ("gm", "player" desks) read as Standard. */
export function isPresetId(v: unknown): v is LayoutPresetId {
  return typeof v === 'string' && LAYOUT_PRESETS.some((p) => p.id === v)
}

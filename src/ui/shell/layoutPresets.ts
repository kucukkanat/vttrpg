/**
 * Layout presets: a few fixed arrangements per role and device instead of a free-form editor.
 * Picking one rewrites the desktop columns and tablet drawer once (the user can still resize and
 * fold afterwards); `compact` and `display` also change the arrangement for as long as they are
 * picked. Pure, so the shell and the tests share it. See docs/UX.md, "Layout presets".
 */
import type { Breakpoint } from './useBreakpoint'
import { DESKTOP_DEFAULT, DESKTOP_LAYOUT_VERSION, type DesktopLayout } from './SideColumn'

export type LayoutPresetId = 'auto' | 'gm' | 'player' | 'compact' | 'display'

export interface LayoutPresetDef {
  id: LayoutPresetId
  label: string
  hint: string
}

export const LAYOUT_PRESETS: readonly LayoutPresetDef[] = [
  { id: 'auto', label: 'Standard', hint: 'Fits the screen size; your own column widths and folds' },
  { id: 'gm', label: 'GM desk', hint: 'Scenes, tokens, turns and sound on the left; chat and sheet on the right' },
  { id: 'player', label: 'Player desk', hint: 'Sheet, skills and chat on the right; the left column folded away' },
  { id: 'compact', label: 'Compact', hint: 'Phone layout on any screen: tab bar and sheets over a wide table' },
  { id: 'display', label: 'Display', hint: 'For a TV or shared screen: the table, turn order and rolls only' },
]

export interface TabletLayout { tab: string; open: boolean; pinned: boolean }

/** Desktop sections folded by each desk preset (ids from `PANELS`). */
const GM_FOLDED: Record<string, boolean> = { skills: true, journal: true, players: true, prep: true, 'skills-editor': true, sound: false, scenes: false, tokens: false, initiative: false, character: false, chat: false }
const PLAYER_FOLDED: Record<string, boolean> = { scenes: true, tokens: true, players: true, initiative: false, journal: true, character: false, skills: false, chat: false }

/**
 * What a preset writes into the persisted layouts when picked. `auto` restores the defaults;
 * `compact` and `display` leave the columns alone (they replace the arrangement while active).
 */
export function presetLayouts(id: LayoutPresetId): { desktop?: DesktopLayout; tablet?: TabletLayout } {
  switch (id) {
    case 'auto':
      return { desktop: { ...DESKTOP_DEFAULT, collapsed: { ...DESKTOP_DEFAULT.collapsed } } }
    case 'gm':
      return {
        desktop: { version: DESKTOP_LAYOUT_VERSION, left: { width: 300, open: true }, right: { width: 340, open: true }, collapsed: { ...GM_FOLDED } },
        tablet: { tab: 'scenes', open: true, pinned: true },
      }
    case 'player':
      return {
        desktop: { version: DESKTOP_LAYOUT_VERSION, left: { width: 260, open: false }, right: { width: 380, open: true }, collapsed: { ...PLAYER_FOLDED } },
        tablet: { tab: 'character', open: true, pinned: false },
      }
    default:
      return {}
  }
}

/** The arrangement to render: `compact` uses the phone layout at any width. */
export function presetBreakpoint(id: LayoutPresetId, device: Breakpoint): Breakpoint {
  return id === 'compact' ? 'phone' : device
}

/** Display hides every control; Zen (a separate toggle) hides the read-outs too. */
export const isDisplayPreset = (id: LayoutPresetId) => id === 'display'

/** The preset a device starts with when it never picked one. */
export const DEFAULT_PRESET: LayoutPresetId = 'auto'

export function isPresetId(v: unknown): v is LayoutPresetId {
  return typeof v === 'string' && LAYOUT_PRESETS.some((p) => p.id === v)
}

/** Presets offered to a role: the GM desk for GMs and co-GMs, the player desk for players. */
export function presetsFor(isGm: boolean): LayoutPresetDef[] {
  return LAYOUT_PRESETS.filter((p) => (isGm ? p.id !== 'player' : p.id !== 'gm'))
}

/**
 * The table layout's own state (docs/UX.md "Table layout"). The board fills the screen; around it:
 *
 *   - the GM screen (bottom left, GM only): Play / Prep / Build. Prep raises the screen's three
 *     leaves over the board, Build folds it into a tool tray so the board stays usable.
 *   - one paper card at a time (character, journal, players, initiative, sound, skills…)
 *   - the scroll (chat) on the right edge, rolled up or open
 *   - the command palette (Ctrl/⌘-K) and the bell (things waiting for you)
 *
 * `routePanel` decides where a registry panel opens, so `openPanel(id)` (shortcuts, toasts,
 * panels asking for each other) needs no knowledge of the layout. UI-only; never synced.
 */
import { create } from 'zustand'

export type TableMode = 'play' | 'prep' | 'build'

/** The GM screen's three leaves in Prep, each a few registry panels shown as tabs. */
export const LEAVES = [
  { id: 'world', title: 'Scenes & encounters', panels: ['scenes', 'prep'] },
  { id: 'cast', title: 'Cast', panels: ['tokens', 'skills-editor'] },
  { id: 'reference', title: 'Reference', panels: ['sound', 'players', 'journal'] },
] as const

export type LeafId = (typeof LEAVES)[number]['id']

/** Reference-leaf panels that open as a card when asked for directly (the leaf still shows them in Prep). */
const PLAY_CARDS = new Set(['journal', 'players', 'sound'])

/** Panels the Build tray shows as tabs: the model library, the tools, and the scene's own settings. */
export const BUILD_TABS = ['library', 'build', 'scenes'] as const

/** Tab labels in the tray where the panel title would read oddly. */
export const BUILD_TAB_LABELS: Record<string, string> = { library: 'Library', build: 'Tools', scenes: 'Scene' }

export type PanelRoute =
  | { kind: 'scroll' }
  | { kind: 'card'; id: string }
  | { kind: 'build'; tab: (typeof BUILD_TABS)[number] }
  | { kind: 'prep'; leaf: LeafId; tab: string }

/**
 * Where a panel opens. Chat is the scroll; Build is the tray; the authoring panels open their
 * Prep leaf for the GM; everything else is the one card. Players have no Prep or Build, so their
 * Scenes and Tokens open as cards (read-only lists, claiming).
 */
export function routePanel(id: string, isGm: boolean): PanelRoute {
  if (id === 'chat') return { kind: 'scroll' }
  if (!isGm) return { kind: 'card', id }
  if (id === 'build' || id === 'library') return { kind: 'build', tab: id }
  // Sound, Players and the Journal are used at the table as much as in prep: a card, in any mode.
  if (PLAY_CARDS.has(id)) return { kind: 'card', id }
  const leaf = LEAVES.find((l) => (l.panels as readonly string[]).includes(id))
  return leaf ? { kind: 'prep', leaf: leaf.id, tab: id } : { kind: 'card', id }
}

interface TableLayoutState {
  mode: TableMode
  /** The panel shown as the floating card, or null. */
  card: string | null
  /** Tab per Prep leaf. */
  leafTabs: Record<LeafId, string>
  /** On phones the leaves are one sheet with the active leaf on top. */
  leaf: LeafId
  buildTab: (typeof BUILD_TABS)[number]
  scrollOpen: boolean
  palette: boolean
  bell: boolean
  /** Phones: the bottom bar's own sheets (dice pad, tools, the GM screen); one sheet at a time. */
  phone: PhoneSheet | null
  set(partial: Partial<Omit<TableLayoutState, 'set' | 'open'>>): void
  /** Open a registry panel wherever this layout keeps it; on phones every place is one sheet, so the others close. */
  open(id: string, isGm: boolean, phone?: boolean): void
}

export type PhoneSheet = 'dice' | 'tools' | 'screen'

export const DEFAULT_LEAF_TABS: Record<LeafId, string> = { world: 'scenes', cast: 'tokens', reference: 'sound' }

export const useTableLayout = create<TableLayoutState>((set) => ({
  mode: 'play',
  card: null,
  leafTabs: { ...DEFAULT_LEAF_TABS },
  leaf: 'world',
  buildTab: 'library',
  scrollOpen: false,
  palette: false,
  bell: false,
  phone: null,
  set: (partial) => set(partial),
  open: (id, isGm, phone = false) => {
    const r = routePanel(id, isGm)
    // On a phone the scroll, the card and the screen are all the one bottom sheet.
    const solo = phone ? { scrollOpen: false, card: null, phone: null } : {}
    if (r.kind === 'scroll') set({ ...solo, scrollOpen: true })
    else if (r.kind === 'card') set({ ...solo, card: id })
    else if (r.kind === 'build') set({ ...solo, mode: 'build', buildTab: r.tab, card: null, ...(phone ? { phone: 'screen' as const } : {}) })
    else set((s) => ({ ...solo, mode: 'prep', leaf: r.leaf, leafTabs: { ...s.leafTabs, [r.leaf]: r.tab }, card: null, ...(phone ? { phone: 'screen' as const } : {}) }))
  },
}))

/** True when the panel is on screen in the current layout state (for unread counters). */
export function panelShown(s: Pick<TableLayoutState, 'mode' | 'card' | 'leafTabs' | 'leaf' | 'buildTab' | 'scrollOpen'>, id: string, isGm: boolean, phone: boolean): boolean {
  const r = routePanel(id, isGm)
  if (r.kind === 'scroll') return s.scrollOpen
  if (s.card === id) return true
  if (r.kind === 'build') return s.mode === 'build' && s.buildTab === r.tab
  if (r.kind === 'prep') return s.mode === 'prep' && s.leafTabs[r.leaf] === r.tab && (!phone || s.leaf === r.leaf)
  return false
}

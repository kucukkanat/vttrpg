/**
 * The table layout's own state (docs/UX.md "Table layout"). The board fills the screen; around it:
 *
 *   - the GM screen (bottom left, GM only): the GM drawer and the live line
 *   - the Library dock (left edge, GM only): folded to a slim rail, or open on a shelf
 *   - the Inspector (right, GM only): shown while something is selected (src/ui/build/)
 *   - one paper card at a time (character, journal, players, initiative, sound, skills…)
 *   - the scroll (chat) on the right edge, rolled up or open
 *   - the command palette (Ctrl/⌘-K) and the bell (things waiting for you)
 *
 * There is one mode: the GM runs the table and changes the world from the Library at any moment.
 * `routePanel` decides where a registry panel opens, so `openPanel(id)` (shortcuts, toasts,
 * panels asking for each other) needs no knowledge of the layout. UI-only; never synced, except
 * whether the Library dock is open, which is remembered per device.
 */
import { create } from 'zustand'
import { useLibraryView, type LibraryFilter, type LibraryShelf } from '../library/libraryView'

export type PanelRoute =
  | { kind: 'scroll' }
  | { kind: 'card'; id: string }
  /** The GM's Library dock, on a shelf (and filter). */
  | { kind: 'library'; shelf?: LibraryShelf; filter?: LibraryFilter }

/**
 * Where a panel opens. Chat is the scroll for everyone. For the GM, the things that add to the
 * world open the Library on their shelf (models, kit, creatures for the old Prep, the scene's
 * tokens as the in-scene outliner; the old Build opens it as it stands); everything else is the
 * one card. Players have no Library dock, so every panel is a card for them.
 */
export function routePanel(id: string, isGm: boolean): PanelRoute {
  if (id === 'chat') return { kind: 'scroll' }
  if (!isGm) return { kind: 'card', id }
  switch (id) {
    case 'library': return { kind: 'library', shelf: 'models' }
    case 'kit': return { kind: 'library', shelf: 'kit' }
    case 'prep': return { kind: 'library', shelf: 'creatures' }
    case 'tokens': return { kind: 'library', filter: 'in-scene' }
    case 'build': return { kind: 'library' }
    default: return { kind: 'card', id }
  }
}

export const LIBRARY_DOCK_KEY = 'vtt.library.dock'

/** Whether the stored dock state says open; a first visit (or anything unreadable) starts folded. */
export function readLibraryOpen(raw: string | null): boolean {
  if (!raw) return false
  try {
    const v = JSON.parse(raw) as { open?: unknown } | null
    return typeof v?.open === 'boolean' ? v.open : false
  } catch {
    return false
  }
}

function loadLibraryOpen(): boolean {
  try { return readLibraryOpen(localStorage.getItem(LIBRARY_DOCK_KEY)) } catch { return false }
}
function saveLibraryOpen(open: boolean) {
  try { localStorage.setItem(LIBRARY_DOCK_KEY, JSON.stringify({ open })) } catch { /* private mode, quota */ }
}

/**
 * Phones: the bottom bar's own sheets; one sheet at a time. The dice pad, Tools (with the GM
 * drawer), the GM's Library, and the Inspector while something is selected.
 */
export type PhoneSheet = 'dice' | 'tools' | 'library' | 'inspector'

interface TableLayoutState {
  /** The panel shown as the floating card, or null. */
  card: string | null
  scrollOpen: boolean
  palette: boolean
  bell: boolean
  phone: PhoneSheet | null
  /** The GM's Library dock is open (else folded to its rail); per device. */
  libraryOpen: boolean
  set(partial: Partial<Omit<TableLayoutState, 'set' | 'open'>>): void
  /** Open a registry panel wherever this layout keeps it; on phones every place is one sheet, so the others close. */
  open(id: string, isGm: boolean, phone?: boolean): void
}

export const useTableLayout = create<TableLayoutState>((set, get) => ({
  card: null,
  scrollOpen: false,
  palette: false,
  bell: false,
  phone: null,
  libraryOpen: loadLibraryOpen(),
  set: (partial) => {
    set(partial)
    if ('libraryOpen' in partial) saveLibraryOpen(get().libraryOpen)
  },
  open: (id, isGm, phone = false) => {
    const r = routePanel(id, isGm)
    const s = get()
    // On a phone the scroll, the card and the bar's sheets are all the one bottom sheet.
    const solo = phone ? { scrollOpen: false, card: null, phone: null } : {}
    if (r.kind === 'scroll') s.set({ ...solo, scrollOpen: true })
    else if (r.kind === 'card') s.set({ ...solo, card: id })
    else openLibrary(phone, r.shelf, r.filter)
  },
}))

/**
 * Open the GM's Library, on phones as the one sheet. With a shelf or a filter it shows that
 * (the filter defaults to All); with neither, the shelf and filter stay as they were.
 */
export function openLibrary(phone: boolean, shelf?: LibraryShelf, filter?: LibraryFilter): void {
  if (shelf || filter) useLibraryView.getState().set({ ...(shelf ? { shelf } : {}), filter: filter ?? 'all' })
  const s = useTableLayout.getState()
  s.set(phone ? { scrollOpen: false, card: null, phone: 'library' } : { libraryOpen: true })
}

/** True when the panel is on screen in the current layout state (for unread counters). */
export function panelShown(s: Pick<TableLayoutState, 'card' | 'scrollOpen'>, id: string, isGm: boolean): boolean {
  const r = routePanel(id, isGm)
  if (r.kind === 'scroll') return s.scrollOpen
  return s.card === id
}

/**
 * The table layout's own state (docs/UX.md "Table layout"). The board fills the screen; around it:
 *
 *   - the GM screen (bottom left, GM only): Play / Build. Build opens the Build workspace (the
 *     scene bar, the Library dock, the Inspector dock and the tool strip; `src/ui/build/`).
 *   - one paper card at a time (character, journal, players, initiative, sound, skills…)
 *   - the scroll (chat) on the right edge, rolled up or open
 *   - the command palette (Ctrl/⌘-K) and the bell (things waiting for you)
 *
 * `routePanel` decides where a registry panel opens, so `openPanel(id)` (shortcuts, toasts,
 * panels asking for each other) needs no knowledge of the layout. UI-only; never synced, except
 * the Build docks' fold state, which is remembered per device.
 */
import { create } from 'zustand'
import { useGame } from '@/state/store'
import { useBuildUi } from '@/table/build/buildState'
import { useKitUi } from '@/table/kits/kitState'
import { useLibraryView, type LibraryFilter, type LibraryShelf } from '../library/libraryView'

/** Play is running the table; Build is making the world. */
export type TableMode = 'play' | 'build'

/**
 * Any mode value, old or new, as a mode. Prep is gone: its scenes, creatures and encounters moved
 * into Build, so a stored or in-memory 'prep' opens Build.
 */
export function normalizeMode(mode: unknown): TableMode {
  return mode === 'build' || mode === 'prep' ? 'build' : 'play'
}

export type PanelRoute =
  | { kind: 'scroll' }
  | { kind: 'card'; id: string }
  /** The Build workspace: the Library on a shelf (and filter), or the Inspector on the scene. */
  | { kind: 'build'; shelf?: LibraryShelf; filter?: LibraryFilter; inspector?: 'scene' }

/**
 * Where a panel opens. Chat is the scroll for everyone. For the GM, the things that add to the
 * world open the Build Library on their shelf (models, kit, creatures for the old Prep, the
 * scene's tokens as the in-scene outliner), and 'build' opens the Inspector on the scene;
 * everything else is the one card. Players have no Build, so every panel is a card for them.
 */
export function routePanel(id: string, isGm: boolean): PanelRoute {
  if (id === 'chat') return { kind: 'scroll' }
  if (!isGm) return { kind: 'card', id }
  switch (id) {
    case 'library': return { kind: 'build', shelf: 'models' }
    case 'kit': return { kind: 'build', shelf: 'kit' }
    case 'prep': return { kind: 'build', shelf: 'creatures' }
    case 'tokens': return { kind: 'build', filter: 'in-scene' }
    case 'build': return { kind: 'build', inspector: 'scene' }
    default: return { kind: 'card', id }
  }
}

/** The Build docks' fold state, per device. */
export interface BuildFolds {
  buildLibraryOpen: boolean
  buildInspectorOpen: boolean
}

export const BUILD_FOLDS_KEY = 'vtt.build.docks'
/**
 * First visit: the Inspector open, the Library folded to its rail (the Library's own controls
 * would put an idle Build over its control budget). Asking for anything the Library holds opens it.
 */
const DEFAULT_FOLDS: BuildFolds = { buildLibraryOpen: false, buildInspectorOpen: true }

/** The stored fold state (the defaults when nothing, or something unreadable, is stored). */
export function readBuildFolds(raw: string | null): BuildFolds {
  if (!raw) return { ...DEFAULT_FOLDS }
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof BuildFolds, unknown>>
    return {
      buildLibraryOpen: typeof v.buildLibraryOpen === 'boolean' ? v.buildLibraryOpen : DEFAULT_FOLDS.buildLibraryOpen,
      buildInspectorOpen: typeof v.buildInspectorOpen === 'boolean' ? v.buildInspectorOpen : DEFAULT_FOLDS.buildInspectorOpen,
    }
  } catch {
    return { ...DEFAULT_FOLDS }
  }
}

function loadFolds(): BuildFolds {
  try { return readBuildFolds(localStorage.getItem(BUILD_FOLDS_KEY)) } catch { return { ...DEFAULT_FOLDS } }
}
function saveFolds(f: BuildFolds) {
  try { localStorage.setItem(BUILD_FOLDS_KEY, JSON.stringify(f)) } catch { /* private mode, quota */ }
}

/**
 * Phones: the bottom bar's own sheets; one sheet at a time. Play: the dice pad, Tools, the GM
 * screen. Build: the Library, the build tools, the Inspector and the scene bar.
 */
export type PhoneSheet = 'dice' | 'tools' | 'screen' | 'library' | 'inspector' | 'scene'

interface TableLayoutState extends BuildFolds {
  mode: TableMode
  /** The panel shown as the floating card, or null. */
  card: string | null
  scrollOpen: boolean
  palette: boolean
  bell: boolean
  phone: PhoneSheet | null
  set(partial: Partial<Omit<TableLayoutState, 'set' | 'open'>>): void
  /** Open a registry panel wherever this layout keeps it; on phones every place is one sheet, so the others close. */
  open(id: string, isGm: boolean, phone?: boolean): void
}

export const useTableLayout = create<TableLayoutState>((set, get) => ({
  mode: 'play',
  card: null,
  scrollOpen: false,
  palette: false,
  bell: false,
  phone: null,
  ...loadFolds(),
  set: (partial) => {
    const next = 'mode' in partial ? { ...partial, mode: normalizeMode(partial.mode) } : partial
    set(next)
    if ('buildLibraryOpen' in partial || 'buildInspectorOpen' in partial) {
      const s = get()
      saveFolds({ buildLibraryOpen: s.buildLibraryOpen, buildInspectorOpen: s.buildInspectorOpen })
    }
  },
  open: (id, isGm, phone = false) => {
    const r = routePanel(id, isGm)
    const s = get()
    // On a phone the scroll, the card and the bar's sheets are all the one bottom sheet.
    const solo = phone ? { scrollOpen: false, card: null, phone: null } : {}
    if (r.kind === 'scroll') s.set({ ...solo, scrollOpen: true })
    else if (r.kind === 'card') s.set({ ...solo, card: id })
    else if (r.inspector) {
      showSceneInInspector()
      s.set({ ...solo, mode: 'build', card: null, buildInspectorOpen: true, ...(phone ? { phone: 'inspector' as const } : {}) })
    } else {
      useLibraryView.getState().set({ ...(r.shelf ? { shelf: r.shelf } : {}), filter: r.filter ?? 'all' })
      s.set({ ...solo, mode: 'build', card: null, buildLibraryOpen: true, ...(phone ? { phone: 'library' as const } : {}) })
    }
  },
}))

/** Put the build tool away and let go of the selection, so the Inspector shows the scene. */
export function showSceneInInspector(): void {
  useKitUi.getState().set({ tool: null })
  useBuildUi.getState().set({ tool: null })
  useGame.getState().setSelection(null)
}

/** True when the panel is on screen in the current layout state (for unread counters). */
export function panelShown(s: Pick<TableLayoutState, 'card' | 'scrollOpen'>, id: string, isGm: boolean): boolean {
  const r = routePanel(id, isGm)
  if (r.kind === 'scroll') return s.scrollOpen
  return s.card === id
}

/** Switch the GM's mode; leaving Build puts any build tool away so the board is plain again. */
export function setTableMode(mode: TableMode | 'prep') {
  const s = useTableLayout.getState()
  const next = normalizeMode(mode)
  if (s.mode === next) return
  if (s.mode === 'build') {
    useKitUi.getState().set({ tool: null })
    useBuildUi.getState().set({ tool: null })
  }
  s.set({ mode: next, phone: null })
}

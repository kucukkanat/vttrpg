/**
 * The GM's Edit toggle (the pencil on the Library rail and dock): a safety catch over the world.
 *
 *   Off  props, walls, doors and lights can't be selected or moved; clicks reach the board and the
 *        tokens beneath them. Doors still open and close on a click.
 *   On   everything is editable: selection, the gizmo, box select, the prop keys.
 *
 * Picking any Library card turns it on. Tokens behave the same either way, and Esc never toggles
 * it. Per device, off on a first visit. The shell publishes it to the table as
 * `tableState.buildMode` (GM only), which the prop pointer, the prop keys and box select read.
 */
import { create } from 'zustand'
import { useGame } from '@/state/store'
import { useBuildUi, type BuildTool } from '@/table/build/buildState'
import { useKitUi } from '@/table/kits/kitState'
import { useTableUi } from '@/table/tableState'

export const EDIT_MODE_KEY = 'vtt.edit'

/** The stored toggle; off when nothing (or something unreadable) is stored. */
export function readEditMode(raw: string | null): boolean {
  if (!raw) return false
  try { return JSON.parse(raw) === true } catch { return false }
}

function load(): boolean {
  try { return readEditMode(localStorage.getItem(EDIT_MODE_KEY)) } catch { return false }
}

/** Build tools that come from a Library card: holding one means the GM is editing. */
export const LIBRARY_TOOLS: ReadonlySet<BuildTool> = new Set<BuildTool>(['place', 'kit', 'creature', 'prefab-stamp', 'eyedropper'])

interface EditModeState {
  on: boolean
  set(on: boolean): void
  toggle(): void
}

export const useEditMode = create<EditModeState>((set, get) => ({
  on: load(),
  set: (on) => {
    if (get().on === on) return
    set({ on })
    try { localStorage.setItem(EDIT_MODE_KEY, JSON.stringify(on)) } catch { /* private mode, quota */ }
    if (!on) letGoOfTheWorld()
  },
  toggle: () => get().set(!get().on),
}))

/**
 * Turning Edit off: let go of selected props, put down whatever came from the Library and leave
 * the double-tap edit mode. Tokens stay selected.
 */
function letGoOfTheWorld(): void {
  const g = useGame.getState()
  if (g.propSelection.length) g.clearPropSelection()
  if (g.selection?.kind === 'prop' || g.selection?.kind === 'node') g.setSelection(null)
  const build = useBuildUi.getState()
  if (build.tool && LIBRARY_TOOLS.has(build.tool)) build.set({ tool: null })
  if (useKitUi.getState().tool) useKitUi.getState().set({ tool: null })
  const ui = useTableUi.getState()
  if (ui.editMode) ui.set({ editMode: false, editPreview: null, editDrag: false, transformEntry: null })
}

/** Picking a Library card turns editing on (cards hand the board a model, a kit piece, creatures or a group). */
export function editOnLibraryPick(): void {
  useEditMode.getState().set(true)
}

// Whatever picks a Library tool (a card, the palette, the eyedropper) turns editing on.
useBuildUi.subscribe((s, prev) => {
  if (s.tool !== prev.tool && s.tool && LIBRARY_TOOLS.has(s.tool)) editOnLibraryPick()
})

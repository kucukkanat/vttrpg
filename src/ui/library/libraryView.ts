/**
 * Which part of the Library is showing: the shelf (what kind of thing) and the filter (which of
 * them). Shared by the Build workspace (which opens the Library on a shelf, e.g. "creatures" for
 * a GM asking for the old Prep panel) and the Library itself. UI-only; per session.
 */
import { create } from 'zustand'

/** What kind of thing: models (props), kit pieces, creatures (tokens), saved groups and encounters. */
export type LibraryShelf = 'models' | 'kit' | 'creatures' | 'saved'

/** Which of them: everything, recently placed, starred, placed in this scene (the outliner), the GM's imports. */
export type LibraryFilter = 'all' | 'recent' | 'favourites' | 'in-scene' | 'mine'

export const LIBRARY_SHELVES: readonly { id: LibraryShelf; label: string }[] = [
  { id: 'models', label: 'Models' },
  { id: 'kit', label: 'Kit' },
  { id: 'creatures', label: 'Creatures' },
  { id: 'saved', label: 'Saved' },
]

interface LibraryViewState {
  shelf: LibraryShelf
  filter: LibraryFilter
  query: string
  set(partial: Partial<Pick<LibraryViewState, 'shelf' | 'filter' | 'query'>>): void
}

export const useLibraryView = create<LibraryViewState>((set) => ({
  shelf: 'models',
  filter: 'all',
  query: '',
  set: (partial) => set(partial),
}))

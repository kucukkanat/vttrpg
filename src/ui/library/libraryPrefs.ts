/**
 * Per-device library lists: Recently placed (last 20) and Favourites, kept in localStorage so
 * each GM's own habits stay on their own device. Small on purpose: the placement layer calls
 * `noteRecentlyPlaced` without loading the library drawer.
 */
import { create } from 'zustand'
import { cleanIdList, MAX_RECENT, pushRecent, toggleFavourite } from './libraryLogic'

const RECENT_KEY = 'vtt.library.recent'
const FAVOURITES_KEY = 'vtt.library.favourites'

function read(key: string, max?: number): string[] {
  try { return cleanIdList(JSON.parse(localStorage.getItem(key) ?? '[]'), max) } catch { return [] }
}

function write(key: string, list: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* private mode, quota */ }
}

interface LibraryPrefs {
  recent: string[]
  favourites: string[]
}

export const useLibraryPrefs = create<LibraryPrefs>(() => ({
  recent: read(RECENT_KEY, MAX_RECENT),
  favourites: read(FAVOURITES_KEY),
}))

/** A model was just placed: it goes to the front of Recently placed. */
export function noteRecentlyPlaced(id: string | undefined): void {
  if (!id) return
  const recent = pushRecent(useLibraryPrefs.getState().recent, id)
  useLibraryPrefs.setState({ recent })
  write(RECENT_KEY, recent)
}

/** The card's star. */
export function toggleFavouriteModel(id: string): void {
  const favourites = toggleFavourite(useLibraryPrefs.getState().favourites, id)
  useLibraryPrefs.setState({ favourites })
  write(FAVOURITES_KEY, favourites)
}

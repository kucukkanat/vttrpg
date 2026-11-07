/**
 * The library drawer's pure logic: shelves (Recently placed, Favourites, In this scene, Built-in,
 * My models), the card badges, and the scene credits. No React, no storage; `libraryPrefs.ts`
 * keeps the per-device lists and `LibraryPanel.tsx` draws them.
 */
import { LICENCE_LABELS, needsCredit, type CatalogueEntry } from '@/core/catalogue'
import type { Prop } from '@/core/doc'
import type { SceneId } from '@/core/ids'
import { searchCatalogue } from '../catalogue'

/** Recently placed keeps this many model ids, newest first. */
export const MAX_RECENT = 20
/** The size badge's cell when the scene has no grid of its own (metres). */
export const DEFAULT_CELL_M = 1.5

export type ShelfId = 'all' | 'recent' | 'favourites' | 'scene' | 'builtin' | 'mine'

export const SHELVES: ReadonlyArray<{ id: ShelfId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'recent', label: 'Recent' },
  { id: 'favourites', label: 'Favourites' },
  { id: 'scene', label: 'In this scene' },
  { id: 'builtin', label: 'Built-in' },
  { id: 'mine', label: 'My models' },
]

/** `id` moved to the front of the recent list, without duplicates, at most `max` long. */
export function pushRecent(list: readonly string[], id: string, max = MAX_RECENT): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max)
}

/** Adds `id` to the favourites, or takes it off when it is already there. */
export function toggleFavourite(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

/** A stored list read back defensively: only strings, no duplicates, capped. */
export function cleanIdList(raw: unknown, max = Infinity): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(0, max)
}

function metres(v: number): string {
  const s = v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/** Cells a length covers: at least one, and a hair over a cell still counts as one. */
function cellsFor(v: number, cell: number): number {
  return Math.max(1, Math.ceil(v / cell - 0.08))
}

/**
 * The card's size badge: the footprint in cells (width × depth) and the height,
 * e.g. "1×2 cells · 1.1 m". The cell is the scene's grid (1.5 m by default).
 */
export function sizeBadge(size: readonly [number, number, number], cellSize = DEFAULT_CELL_M): string {
  const cell = cellSize > 0 ? cellSize : DEFAULT_CELL_M
  const [w, h, d] = size
  const cw = cellsFor(w, cell), cd = cellsFor(d, cell)
  return `${cw}×${cd} ${cw * cd === 1 ? 'cell' : 'cells'} · ${metres(h)} m`
}

/** The short licence badge for a card, or null for CC0 (nothing to show). */
export function licenceBadge(e: Pick<CatalogueEntry, 'licence'>): string | null {
  switch (e.licence.id) {
    case 'cc0': return null
    case 'cc-by': return 'CC BY'
    case 'cc-by-sa': return 'CC BY-SA'
    case 'own-work': return 'Own work'
    default: return LICENCE_LABELS[e.licence.id] ?? e.licence.id
  }
}

/** Catalogue ids placed in `scene`, most used first. */
export function sceneCatalogueIds(props: Record<string, Prop>, scene: SceneId | null): string[] {
  if (!scene) return []
  const counts = new Map<string, number>()
  for (const p of Object.values(props)) {
    if (p.scene !== scene || !p.catalogue) continue
    counts.set(p.catalogue, (counts.get(p.catalogue) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id)
}

export interface LibrarySources {
  builtin: readonly CatalogueEntry[]
  mine: readonly CatalogueEntry[]
  recent: readonly string[]
  favourites: readonly string[]
  /** Catalogue ids used in the active scene (`sceneCatalogueIds`). */
  scene: readonly string[]
}

/** Every entry by id, the game's own models first so an id in both reads as the GM's. */
export function catalogueIndex(builtin: readonly CatalogueEntry[], mine: readonly CatalogueEntry[]): Map<string, CatalogueEntry> {
  const m = new Map<string, CatalogueEntry>()
  for (const e of builtin) m.set(e.id, e)
  for (const e of mine) m.set(e.id, e)
  return m
}

/** The entries of one shelf; the id-list shelves keep their own order (newest, most used). */
export function shelfEntries(shelf: ShelfId, src: LibrarySources): CatalogueEntry[] {
  const index = catalogueIndex(src.builtin, src.mine)
  const byIds = (ids: readonly string[]) => ids.map((id) => index.get(id)).filter((e): e is CatalogueEntry => !!e)
  switch (shelf) {
    case 'recent': return byIds(src.recent)
    case 'favourites': return byIds(src.favourites)
    case 'scene': return byIds(src.scene)
    case 'builtin': return [...src.builtin]
    case 'mine': return [...src.mine]
    default: return [...src.mine, ...src.builtin]
  }
}

export interface LibraryQuery {
  shelf: ShelfId
  query: string
  category: string | null
  /** Kit pieces are hidden unless this chip is on (then only kit pieces show). */
  kit: boolean
}

/** The cards to show: the shelf, filtered and searched. An empty query keeps an id-list shelf's order. */
export function libraryResults(src: LibrarySources, q: LibraryQuery): CatalogueEntry[] {
  const pool = shelfEntries(q.shelf, src)
  const filters = { kit: q.kit, ...(q.category ? { category: q.category } : {}) }
  const ordered = q.shelf === 'recent' || q.shelf === 'favourites' || q.shelf === 'scene'
  if (!q.query.trim() && ordered) {
    return pool.filter((e) => (q.kit ? !!e.kit : !e.kit) && (!q.category || e.category === q.category))
  }
  return searchCatalogue(pool, q.query, filters)
}

/** True when the model must be credited in the scene: CC-BY / BY-SA, or from Poly Haven or Sketchfab. */
export function wantsCredit(e: CatalogueEntry): boolean {
  return needsCredit(e.licence) || e.origin === 'polyhaven' || e.origin === 'sketchfab'
}

export interface SceneCredits {
  /** Models to credit, by title. */
  credits: CatalogueEntry[]
  /** Distinct catalogue models in the scene (credited or not). */
  models: number
}

/**
 * The scene's credits: every distinct catalogue model placed in `scene` that needs a credit,
 * sorted by title. Props whose model is not in the catalogue (old props, unknown ids) are counted
 * out, since there is nothing to say about them.
 */
export function sceneCredits(props: Record<string, Prop>, scene: SceneId | null, lookup: (id: string) => CatalogueEntry | undefined): SceneCredits {
  const ids = sceneCatalogueIds(props, scene)
  const entries = ids.map(lookup).filter((e): e is CatalogueEntry => !!e)
  const credits = entries.filter(wantsCredit).sort((a, b) => a.title.localeCompare(b.title))
  return { credits, models: entries.length }
}

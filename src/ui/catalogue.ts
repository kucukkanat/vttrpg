/**
 * The built-in level-design catalogue (public/library/catalogue.json, built by
 * scripts/build-library-index.mjs) and the search the library drawer and the command palette use.
 */
import type { AssetRef } from '@/core/assets'
import type { CatalogueEntry } from '@/core/catalogue'
import { LIBRARY_BASE } from './library'

/** Absolute URL of a library-relative path, against the page. */
function libraryUrl(rel: string): string {
  return new URL(LIBRARY_BASE + rel, window.location.href).toString()
}

/** Turns the library-relative model source into an absolute URL the asset resolver can fetch. */
function resolveEntry(e: CatalogueEntry): CatalogueEntry {
  const model: AssetRef = { ...e.model, sources: e.model.sources.map((s) => (/^[a-z]+:/i.test(s) ? s : libraryUrl(s))) }
  return { ...e, model }
}

let cache: Promise<CatalogueEntry[]> | null = null

/** Loads the built-in catalogue once; an unreachable or broken file gives an empty list. */
export function loadBuiltinCatalogue(): Promise<CatalogueEntry[]> {
  cache ??= fetch(LIBRARY_BASE + 'catalogue.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((list: unknown) => (Array.isArray(list) ? (list as CatalogueEntry[]).map(resolveEntry) : []))
    .catch(() => [])
  return cache
}

/** URL of an entry's thumbnail image, or undefined when it has none or it is a blob ref. */
export function catalogueThumbnailUrl(e: CatalogueEntry): string | undefined {
  const t = e.thumbnail
  if (typeof t === 'string') return /^[a-z]+:/i.test(t) ? t : libraryUrl(t)
  return t?.sources[0]
}

export interface CatalogueFilters {
  /** One shelf or several. */
  category?: string | readonly string[]
  theme?: string
  /** true: kit pieces only; false: no kit pieces; a string: pieces of that kit. */
  kit?: boolean | string
  origin?: CatalogueEntry['origin']
}

/** Lowercase, accents stripped, apostrophes dropped, anything else non-alphanumeric a space. */
export function normalizeSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function words(s: string): string[] {
  const n = normalizeSearch(s)
  return n ? n.split(' ') : []
}

function matchesFilters(e: CatalogueEntry, f: CatalogueFilters): boolean {
  if (f.category !== undefined) {
    const cats = typeof f.category === 'string' ? [f.category] : f.category
    if (cats.length && !cats.includes(e.category)) return false
  }
  if (f.theme !== undefined && e.theme !== f.theme) return false
  if (f.origin !== undefined && e.origin !== f.origin) return false
  if (f.kit === true && !e.kit) return false
  if (f.kit === false && e.kit) return false
  if (typeof f.kit === 'string' && e.kit !== f.kit) return false
  return true
}

/**
 * Score of one query token against an entry, 0 when it matches nothing. Title words weigh most,
 * then tags, then the category; a whole-word hit beats a prefix, a prefix beats a substring.
 */
function tokenScore(token: string, title: string[], tags: string[], category: string[]): number {
  let best = 0
  for (const w of title) {
    if (w === token) best = Math.max(best, 10)
    else if (w.startsWith(token)) best = Math.max(best, 7)
    else if (token.length >= 3 && w.includes(token)) best = Math.max(best, 3)
  }
  for (const w of tags) {
    if (w === token) best = Math.max(best, 6)
    else if (w.startsWith(token)) best = Math.max(best, 4)
  }
  for (const w of category) {
    if (w === token) best = Math.max(best, 5)
    else if (w.startsWith(token)) best = Math.max(best, 3)
  }
  return best
}

/**
 * Filters and ranks catalogue entries for a search box. Every query word must match the title,
 * a tag or the category (accent- and case-insensitive, prefixes count, so "bar" finds barrels).
 * Results are ranked by match quality, with an exact or leading title match first; ties keep the
 * shortest title, then alphabetical order. An empty query returns the filtered entries by title.
 */
export function searchCatalogue(
  entries: readonly CatalogueEntry[],
  query: string,
  filters: CatalogueFilters = {},
): CatalogueEntry[] {
  const pool = entries.filter((e) => matchesFilters(e, filters))
  const tokens = words(query)
  const byTitle = (a: CatalogueEntry, b: CatalogueEntry) => a.title.localeCompare(b.title)
  if (!tokens.length) return [...pool].sort(byTitle)
  const q = tokens.join(' ')
  const scored: Array<{ e: CatalogueEntry; score: number }> = []
  for (const e of pool) {
    const title = words(e.title)
    const tags = e.tags.flatMap(words)
    const category = words(e.category)
    let score = 0
    let all = true
    for (const t of tokens) {
      const s = tokenScore(t, title, tags, category)
      if (!s) { all = false; break }
      score += s
    }
    if (!all) continue
    const t = title.join(' ')
    if (t === q) score += 20
    else if (t.startsWith(q)) score += 8
    scored.push({ e, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.e.title.length - b.e.title.length || byTitle(a.e, b.e))
    .map((s) => s.e)
}

/** The distinct categories of a catalogue with their counts, most populated first. */
export function catalogueCategories(entries: readonly CatalogueEntry[]): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>()
  for (const e of entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
  return [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

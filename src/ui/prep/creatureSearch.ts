/** Searching the creature compendium in the Prep panel. Pure. */
import type { CreatureEntry } from '@/core/pack'

export interface CreatureFilter {
  query: string
  /** Document key, or '' for every source. */
  source: string
  crMin?: number
  crMax?: number
  limit?: number
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Rank for a name match: 0 exact, 1 prefix, 2 word prefix, 3 contained, -1 none. */
function rank(name: string, q: string): number {
  if (!q) return 3
  const n = norm(name)
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  if (n.split(/[\s,()-]+/).some((w) => w.startsWith(q))) return 2
  return n.includes(q) ? 3 : -1
}

/**
 * Creatures whose name (or type) holds every word of the query, within the source and CR range,
 * best name matches first, then by name. `total` counts every match before the limit.
 */
export function searchCreatures(list: readonly CreatureEntry[], f: CreatureFilter): { results: CreatureEntry[]; total: number } {
  const q = norm(f.query.trim())
  const words = q.split(/\s+/).filter(Boolean)
  const hits: { c: CreatureEntry; r: number }[] = []
  for (const c of list) {
    if (f.source && c.source !== f.source) continue
    const cr = c.cr ?? 0
    if (f.crMin !== undefined && cr < f.crMin) continue
    if (f.crMax !== undefined && cr > f.crMax) continue
    const hay = norm(`${c.name} ${c.type ?? ''} ${c.size ?? ''}`)
    if (!words.every((w) => hay.includes(w))) continue
    const r = rank(c.name, q)
    hits.push({ c, r: r < 0 ? 4 : r })
  }
  hits.sort((a, b) => a.r - b.r || a.c.name.localeCompare(b.c.name) || a.c.source.localeCompare(b.c.source))
  return { results: hits.slice(0, f.limit ?? 40).map((h) => h.c), total: hits.length }
}

/** "1/4", "1/2", "3": how challenge ratings read. */
export function formatCr(cr: number | undefined): string {
  if (cr === undefined) return '—'
  if (cr === 0.125) return '1/8'
  if (cr === 0.25) return '1/4'
  if (cr === 0.5) return '1/2'
  return String(cr)
}

/** Challenge ratings a filter can pick, in order. */
export const CR_STEPS = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)]

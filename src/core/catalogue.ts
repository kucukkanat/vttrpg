/**
 * The level-design catalogue: one entry per model a GM can place, whether it ships with the app,
 * was imported from the internet (Poly Haven, Sketchfab) or uploaded. Shared contract between the
 * library index, the import pipeline, the library drawer and the placement tools
 * (reports/Level design plan.md, Phase 1 and 3).
 */
import type { AssetRef } from './assets'

/** Licences a model may carry in the catalogue. Only these may be re-hosted on Blossom for players. */
export type LicenceId = 'cc0' | 'cc-by' | 'cc-by-sa' | 'own-work'

export const SHAREABLE_LICENCES: readonly LicenceId[] = ['cc0', 'cc-by', 'cc-by-sa', 'own-work']

export const LICENCE_LABELS: Record<LicenceId, string> = {
  cc0: 'CC0 (public domain)',
  'cc-by': 'CC BY 4.0',
  'cc-by-sa': 'CC BY-SA 4.0',
  'own-work': 'Own work',
}

export interface Licence {
  id: LicenceId
  /** Who made it; required for cc-by and cc-by-sa. */
  author?: string
  authorUrl?: string
  /** Where it came from ("Poly Haven", "Sketchfab", "KayKit Dungeon Remastered"). */
  source?: string
  /** The model's own page, for the credits list. */
  sourceUrl?: string
}

/** Where a catalogue entry came from. */
export type CatalogueOrigin = 'builtin' | 'polyhaven' | 'sketchfab' | 'upload'

export interface CatalogueEntry {
  /** Stable id: `builtin:<path>`, `polyhaven:<id>`, `sketchfab:<uid>`, `upload:<sha256>`. */
  id: string
  origin: CatalogueOrigin
  title: string
  /** Broad shelf: furniture, container, light, nature, structure, decor, creature, kit… */
  category: string
  tags: string[]
  /** Visual theme or source pack ("dungeon", "tavern", "kaykit-dungeon"). */
  theme?: string
  /** Set when the model is a piece of a grid kit (Phase 4). */
  kit?: string
  /** The optimised GLB, normalised: metres, Y up, pivot at the bottom centre. */
  model: AssetRef
  /** Real-world bounds in metres after normalisation: [width x, height y, depth z]. */
  size: [number, number, number]
  triangles: number
  licence: Licence
  /** A square WebP thumbnail (≥ 256 px): a library-relative path for built-ins, else an AssetRef. */
  thumbnail?: string | AssetRef
}

export function isShareable(id: string): id is LicenceId {
  return (SHAREABLE_LICENCES as readonly string[]).includes(id)
}

/** True when the licence requires showing the author (the scene credits list). */
export function needsCredit(l: Licence): boolean {
  return l.id === 'cc-by' || l.id === 'cc-by-sa'
}

const ORIGINS: readonly CatalogueOrigin[] = ['builtin', 'polyhaven', 'sketchfab', 'upload']
/** Longest id, title, category, tag or theme a catalogue entry may carry. */
const MAX_TEXT = 300
const MAX_TAGS = 64

const isText = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max
const isAssetRef = (v: unknown): v is AssetRef =>
  !!v && typeof v === 'object' && typeof (v as AssetRef).sha256 === 'string' && Array.isArray((v as AssetRef).sources)
    && (v as AssetRef).sources.every((s) => typeof s === 'string')

/**
 * Why `e` may not be saved in a game's own catalogue (`catalogue.add`, the GM's "My models"), or
 * null. Built-in entries ship with the app and are never stored; the licence must be one that may
 * be re-hosted for players (`isShareable`), and CC-BY / CC-BY-SA need an author for the credits.
 */
export function badCatalogueEntry(e: unknown): string | null {
  if (!e || typeof e !== 'object') return 'not a catalogue entry'
  const x = e as CatalogueEntry
  if (!isText(x.id) || !x.id) return 'catalogue entry without an id'
  if (!ORIGINS.includes(x.origin)) return 'unknown origin'
  if (x.origin === 'builtin') return 'built-in models are part of the app'
  if (!isText(x.title) || !x.title.trim()) return 'catalogue entry without a title'
  if (!isText(x.category)) return 'category must be text'
  if (!Array.isArray(x.tags) || x.tags.length > MAX_TAGS || !x.tags.every((t) => isText(t))) return 'tags must be a list of words'
  if (x.theme !== undefined && !isText(x.theme)) return 'theme must be text'
  if (x.kit !== undefined && !isText(x.kit)) return 'kit must be text'
  if (!isAssetRef(x.model)) return 'catalogue entry without a model'
  if (!Array.isArray(x.size) || x.size.length !== 3 || !x.size.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e4)) return 'size must be three positive numbers'
  if (typeof x.triangles !== 'number' || !Number.isFinite(x.triangles) || x.triangles < 0) return 'triangles must be a number'
  const l = x.licence
  if (!l || typeof l !== 'object' || typeof l.id !== 'string') return 'catalogue entry without a licence'
  if (!isShareable(l.id)) return 'that licence cannot be shared with players'
  for (const k of ['author', 'authorUrl', 'source', 'sourceUrl'] as const) if (l[k] !== undefined && !isText(l[k], 2000)) return `licence ${k} must be text`
  if (needsCredit(l) && !l.author?.trim()) return 'CC BY and CC BY-SA models need an author'
  if (x.thumbnail !== undefined && !isText(x.thumbnail, 2000) && !isAssetRef(x.thumbnail)) return 'thumbnail must be a path or an asset'
  return null
}

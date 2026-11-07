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

const ORIGINS: readonly CatalogueOrigin[] = ['polyhaven', 'sketchfab', 'upload']

const isText = (v: unknown, max = 300): v is string => typeof v === 'string' && v.length <= max
const optText = (v: unknown, max?: number) => v === undefined || isText(v, max)
const isRef = (v: unknown): v is AssetRef =>
  !!v && typeof (v as AssetRef).sha256 === 'string' && Array.isArray((v as AssetRef).sources) && (v as AssetRef).sources.every((s) => typeof s === 'string')

/**
 * Why `e` may not be saved in a game's own catalogue (`catalogue.add`, the GM's "My models"), or
 * null. Only imported or uploaded entries are stored (built-ins ship with the app); the licence
 * must be one that may be re-hosted for players (`isShareable`), and CC-BY / CC-BY-SA need an
 * author for the credits.
 */
export function badCatalogueEntry(e: unknown): string | null {
  const x = e as CatalogueEntry
  if (!x || typeof x !== 'object' || !isText(x.id) || !x.id || !isText(x.title) || !x.title.trim() || !isText(x.category)) return 'not a catalogue entry'
  if (!ORIGINS.includes(x.origin)) return 'only imported models are saved in the game'
  if (!Array.isArray(x.tags) || x.tags.length > 64 || !x.tags.every((t) => isText(t)) || !optText(x.theme) || !optText(x.kit)) return 'bad tags'
  if (!isRef(x.model) || (x.thumbnail !== undefined && !isText(x.thumbnail, 2000) && !isRef(x.thumbnail))) return 'bad model or thumbnail'
  if (!Array.isArray(x.size) || x.size.length !== 3 || !x.size.every((n) => typeof n === 'number' && n > 0 && n < 1e4) || !(x.triangles >= 0)) return 'bad size'
  const l = x.licence
  if (!l || !isShareable(l.id) || ![l.author, l.authorUrl, l.source, l.sourceUrl].every((v) => optText(v, 2000))) return 'that licence cannot be shared with players'
  return needsCredit(l) && !l.author?.trim() ? 'CC BY and CC BY-SA models need an author' : null
}

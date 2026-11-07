/**
 * What each Library shelf shows for the active filter and search: kit pieces by slot, creatures
 * (the game's stat blocks and the pack compendium), saved groups and encounters, and an encounter
 * turned into a group of tokens to pick up. Pure: no React, no store. The models shelf keeps
 * `libraryLogic.libraryResults`; `modelShelfFor` maps the filter onto it.
 */
import type { CreatureTemplate, Encounter, EncounterRow, Prefab } from '@/core/doc'
import type { CatalogueEntry } from '@/core/catalogue'
import { catalogueParts, kitPieceParts, litModelLight, type PropParts } from '@/core/catalogueParts'
import type { KitManifest, KitPiece, KitSlot } from '@/core/kits'
import { LIGHT_SOURCES, type LightSourceId } from '@/table/build/lightSources'
import type { CreatureEntry } from '@/core/pack'
import { prefabSummary } from '@/table/build/prefab'
import type { HeldCreatureToken } from '@/table/build/creaturePickup'
import { formatCr, searchCreatures } from '../prep/creatureSearch'
import { encounterSize, gameRef, packRef, resolveCreature, rowName, tokenNames } from '../prep/encounters'
import type { ShelfId } from './libraryLogic'
import type { LibraryFilter } from './libraryView'

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** True when every word of `query` is in `text` (accents and case ignored); an empty query matches. */
export function matchesQuery(text: string, query: string): boolean {
  const words = norm(query.trim()).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = norm(text)
  return words.every((w) => hay.includes(w))
}

/** The models shelf's list for a filter ('in-scene' is the outliner, so it never reaches here). */
export function modelShelfFor(filter: LibraryFilter): ShelfId {
  switch (filter) {
    case 'recent': return 'recent'
    case 'favourites': return 'favourites'
    case 'mine': return 'mine'
    case 'in-scene': return 'scene'
    default: return 'all'
  }
}

/** Keeps the items whose id is in `ids`, in the order of `ids` (newest first, starred order). */
function inOrderOf<T>(items: readonly T[], ids: readonly string[], idOf: (t: T) => string): T[] {
  const by = new Map(items.map((t) => [idOf(t), t]))
  return ids.map((id) => by.get(id)).filter((t): t is T => !!t)
}

export interface ShelfPrefs {
  query: string
  filter: LibraryFilter
  /** Recently picked ids (catalogue ids, creature refs, group and encounter ids), newest first. */
  recent: readonly string[]
  favourites: readonly string[]
}

// ------------------------------------------------------------------ kit

/** The kit shelf's sections, in the order the plan lists them. */
export const KIT_GROUPS: readonly { label: string; slots: readonly KitSlot[] }[] = [
  { label: 'Floors', slots: ['floor'] },
  { label: 'Walls', slots: ['wall'] },
  { label: 'Doors', slots: ['door'] },
  { label: 'Windows', slots: ['window'] },
  { label: 'Stairs', slots: ['stair'] },
  { label: 'Roofs', slots: ['roof'] },
  { label: 'Pillars', slots: ['pillar', 'corner'] },
]

export interface KitGroup {
  label: string
  pieces: KitPiece[]
}

/** A kit's pieces by slot, searched (title, slot, kit name) and filtered; empty sections dropped. */
export function kitShelf(manifest: KitManifest | undefined, p: ShelfPrefs): KitGroup[] {
  if (!manifest || p.filter === 'mine') return []
  const fav = new Set(p.favourites), recent = new Set(p.recent)
  const keep = (piece: KitPiece) =>
    (p.filter === 'favourites' ? fav.has(piece.catalogue) : p.filter === 'recent' ? recent.has(piece.catalogue) : true)
    && matchesQuery(`${piece.title} ${piece.slot} ${manifest.title ?? manifest.id}`, p.query)
  return KIT_GROUPS.map((g) => ({ label: g.label, pieces: manifest.pieces.filter((x) => g.slots.includes(x.slot) && keep(x)) })).filter((g) => g.pieces.length)
}

// ------------------------------------------------------------------ lights

/** The recent / favourite id of a light source card (catalogue ids are `builtin:…`, so no clash). */
export const lightSourceRef = (id: LightSourceId) => `light:${id}`

export interface LightShelf {
  sources: (typeof LIGHT_SOURCES)[number][]
  /** Lit models (torch, candle, lantern, campfire, brazier…), each with the light it carries. */
  models: { entry: CatalogueEntry; light: NonNullable<PropParts['light']> }[]
}

/** Keeps `items` whose ref passes the filter (recent and favourites keep their own order). */
function byFilter<T>(items: T[], refOf: (t: T) => string, p: ShelfPrefs): T[] {
  if (p.filter === 'recent') return inOrderOf(items, p.recent, refOf)
  if (p.filter === 'favourites') return inOrderOf(items, p.favourites, refOf)
  return items
}

/**
 * The Lights shelf: the three light sources, then every model that shines (its light from
 * `litModelLight`), searched by title and tags. 'mine' keeps the game's own lit models.
 */
export function lightShelf(entries: readonly CatalogueEntry[], p: ShelfPrefs, mine: ReadonlySet<string> = new Set()): LightShelf {
  const sources = p.filter === 'mine' ? [] : byFilter(LIGHT_SOURCES.filter((s) => matchesQuery(`${s.title} ${s.hint} light source`, p.query)), (s) => lightSourceRef(s.id), p)
  const lit = entries.filter((e) => !e.kit && (p.filter !== 'mine' || mine.has(e.id)) && matchesQuery(`${e.title} ${e.tags.join(' ')}`, p.query))
    .flatMap((entry) => { const light = litModelLight(entry); return light ? [{ entry, light }] : [] })
    .sort((a, b) => a.entry.title.localeCompare(b.entry.title))
  return { sources, models: byFilter(lit, (m) => m.entry.id, p) }
}

// ------------------------------------------------------------------ walls & doors

export type InvisibleSegment = 'wall' | 'door'

export const INVISIBLE_SEGMENTS: readonly { id: InvisibleSegment; title: string; hint: string }[] = [
  { id: 'wall', title: 'Invisible wall', hint: 'Click to start, click to end; clicks chain. Esc stops.' },
  { id: 'door', title: 'Invisible door', hint: 'Drag across the doorway (or click both ends).' },
]

export const segmentRef = (id: InvisibleSegment) => `segment:${id}`

export interface WallShelf {
  invisible: (typeof INVISIBLE_SEGMENTS)[number][]
  /** Wall, gate and door models of the catalogue, with the parts they carry. */
  models: { entry: CatalogueEntry; parts: PropParts }[]
  /** Straight kit wall, door and window pieces, placed as props (the Kit shelf still paints them). */
  kit: { piece: KitPiece; kit: string; parts: PropParts }[]
}

/** The Walls & doors shelf: the invisible wall and door, wall and door models, and kit walls as props. */
export function wallShelf(entries: readonly CatalogueEntry[], manifests: readonly KitManifest[], p: ShelfPrefs, mine: ReadonlySet<string> = new Set()): WallShelf {
  const invisible = p.filter === 'mine' ? [] : byFilter(INVISIBLE_SEGMENTS.filter((s) => matchesQuery(`${s.title} invisible map ${s.id}`, p.query)), (s) => segmentRef(s.id), p)
  const models = entries.filter((e) => !e.kit && e.category !== 'kit' && (p.filter !== 'mine' || mine.has(e.id)) && matchesQuery(`${e.title} ${e.tags.join(' ')}`, p.query))
    .flatMap((entry) => { const parts = catalogueParts(entry); return parts && (parts.wall || parts.door) ? [{ entry, parts }] : [] })
    .sort((a, b) => a.entry.title.localeCompare(b.entry.title))
  const kit = p.filter === 'mine' ? [] : manifests.flatMap((m) => m.pieces
    .filter((piece) => matchesQuery(`${piece.title} ${piece.slot} ${m.title ?? m.id}`, p.query))
    .flatMap((piece) => { const parts = kitPieceParts(piece); return parts ? [{ piece, kit: m.id, parts }] : [] }))
  return { invisible, models: byFilter(models, (m) => m.entry.id, p), kit: byFilter(kit, (k) => k.piece.catalogue, p) }
}

// ------------------------------------------------------------------ creatures

export interface CreatureCard {
  /** `game:<template id>` or `pack:<compendium key>`, as encounter rows store it. */
  ref: string
  name: string
  /** "CR 1/4 · humanoid" or "This game". */
  meta: string
  custom: boolean
}

/** How many compendium cards the shelf draws at once; the search narrows the rest. */
export const CREATURE_LIMIT = 60

/**
 * The creatures shelf: the game's own stat blocks first, then the pack compendium, both searched.
 * 'mine' keeps the game's stat blocks, 'recent' and 'favourites' keep their own order. `total`
 * counts every match before the limit.
 */
export function creatureShelf(
  src: { templates: Readonly<Record<string, CreatureTemplate>>; compendium: readonly CreatureEntry[] },
  p: ShelfPrefs,
  limit = CREATURE_LIMIT,
): { cards: CreatureCard[]; total: number } {
  const own: CreatureCard[] = Object.values(src.templates)
    .filter((t) => matchesQuery(t.name, p.query))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ ref: gameRef(t.id), name: t.name, meta: 'This game', custom: true }))
  const fromPack = (c: CreatureEntry): CreatureCard => ({
    ref: packRef(c.key), name: c.name, meta: [`CR ${formatCr(c.cr)}`, c.type].filter(Boolean).join(' · '), custom: false,
  })
  if (p.filter === 'mine') return { cards: own.slice(0, limit), total: own.length }
  if (p.filter === 'recent' || p.filter === 'favourites') {
    const ids = p.filter === 'recent' ? p.recent : p.favourites
    const wanted = new Set(ids)
    const pack = src.compendium.filter((c) => wanted.has(packRef(c.key)) && matchesQuery(`${c.name} ${c.type ?? ''}`, p.query)).map(fromPack)
    const cards = inOrderOf([...own, ...pack], ids, (c) => c.ref)
    return { cards: cards.slice(0, limit), total: cards.length }
  }
  const room = Math.max(0, limit - own.length)
  const { results, total } = searchCreatures(src.compendium, { query: p.query, source: '', limit: room })
  return { cards: [...own.slice(0, limit), ...results.map(fromPack)], total: own.length + total }
}

// ------------------------------------------------------------------ saved

export type SavedCard =
  | { kind: 'group'; id: string; name: string; meta: string; prefab: Prefab }
  | { kind: 'encounter'; id: string; name: string; meta: string; encounter: Encounter }

/** "4 tokens · Goblin, Bugbear" for an encounter card; row names resolve through `nameOf`. */
export function encounterMeta(e: Pick<Encounter, 'rows'>, nameOf: (row: EncounterRow) => string = (r) => rowName(r)): string {
  const n = encounterSize(e as Encounter)
  const names = [...new Set(e.rows.filter((r) => r.count > 0).map(nameOf))]
  return `${n} ${n === 1 ? 'token' : 'tokens'}${names.length ? ` · ${names.join(', ')}` : ''}`
}

/** Saved groups and encounters, oldest first, searched by name and filtered. */
export function savedShelf(
  src: {
    prefabs: Readonly<Record<string, Prefab>>
    encounters: Readonly<Record<string, Encounter>>
    /** For the creature names on encounter cards. */
    compendium?: readonly CreatureEntry[]
    templates?: Readonly<Record<string, CreatureTemplate>>
  },
  p: ShelfPrefs,
): { groups: SavedCard[]; encounters: SavedCard[] } {
  const nameOf = (r: EncounterRow) => rowName(r, resolveCreature(r.creatureRef, src.compendium, src.templates as Record<string, CreatureTemplate> | undefined))
  const groups: SavedCard[] = Object.values(src.prefabs).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((prefab) => ({ kind: 'group', id: prefab.id, name: prefab.name, meta: prefabSummary(prefab), prefab }))
  const encounters: SavedCard[] = Object.values(src.encounters).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
    .map((encounter) => ({ kind: 'encounter', id: encounter.id, name: encounter.name || 'Encounter', meta: encounterMeta(encounter, nameOf), encounter }))
  const pick = (list: SavedCard[]) => {
    const found = list.filter((c) => matchesQuery(`${c.name} ${c.meta}`, p.query))
    if (p.filter === 'recent') return inOrderOf(found, p.recent, (c) => c.id)
    if (p.filter === 'favourites') return inOrderOf(found, p.favourites, (c) => c.id)
    return found
  }
  return { groups: pick(groups), encounters: pick(encounters) }
}

// ------------------------------------------------------------------ encounter -> group

export interface EncounterGroup {
  title: string
  /** One per token the encounter places, row by row, named as `placeRows` names them. */
  tokens: (HeldCreatureToken & { row: string })[]
  /** Rows whose stat block is gone: left out, as `placeRows` leaves them out. */
  missing: string[]
}

/**
 * An encounter as a group to pick up: its rows of creature refs become the tokens the ghost
 * shows. The stored encounter keeps its shape; placing still goes through `placeRows`.
 */
export function encounterAsGroup(
  e: Pick<Encounter, 'name' | 'rows'>,
  compendium: readonly CreatureEntry[] | undefined,
  templates: Readonly<Record<string, CreatureTemplate>> | undefined,
): EncounterGroup {
  const tokens: EncounterGroup['tokens'] = []
  const missing: string[] = []
  for (const row of e.rows as EncounterRow[]) {
    const n = Math.max(0, Math.floor(row.count || 0))
    if (!n) continue
    const creature = resolveCreature(row.creatureRef, compendium, templates as Record<string, CreatureTemplate> | undefined)
    if (row.creatureRef && !creature) { missing.push(rowName(row)); continue }
    for (const name of tokenNames(rowName(row, creature), n)) tokens.push({ name, color: row.color, row: row.id })
  }
  return { title: e.name || 'Encounter', tokens, missing }
}

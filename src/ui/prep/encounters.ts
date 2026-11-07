/**
 * Encounters: rows of "N of this creature" kept in the shared document (`encounters`), with
 * per-row overrides, hit point mode and friendlies, plus the pure helpers the Prep panel needs:
 * resolving a row's creature, building each token's sheet, the difficulty arithmetic and the
 * one-time move of encounters that older versions kept in this device's localStorage.
 */
import type { Character, CreatureTemplate, Encounter, EncounterRow, Token } from '@/core/doc'
import type { CreatureConfig, CreatureEntry, EncounterRules } from '@/core/pack'
import type { TokenId } from '@/core/ids'
import { getPath, setPath } from '@/rules/expr'

export type { Encounter, EncounterRow }

export const ENCOUNTER_COLORS = ['#f28b82', '#e0a458', '#ffd166', '#8fd18f', '#7cc4ff', '#c58af9', '#9aa0a6']
/** Default colour for friendly rows. */
export const FRIENDLY_COLOR = '#8fd18f'

export function newRow(index: number, patch: Partial<EncounterRow> = {}): EncounterRow {
  return { id: crypto.randomUUID(), count: 1, color: ENCOUNTER_COLORS[index % ENCOUNTER_COLORS.length]!, hpMode: 'average', ...patch }
}

export function newEncounter(index: number, now = Date.now()): Encounter {
  return { id: crypto.randomUUID(), name: `Encounter ${index + 1}`, rows: [], placed: [], createdAt: now }
}

const rowCount = (r: EncounterRow): number => Math.max(0, Math.floor(r.count || 0))

/** Total tokens an encounter places. */
export function encounterSize(e: Encounter): number {
  return e.rows.reduce((n, r) => n + rowCount(r), 0)
}

/** Encounters in a stable order for the list: oldest first by when they were last saved, then id. */
export function sortEncounters(list: Record<string, Encounter> | undefined): Encounter[] {
  return Object.values(list ?? {}).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
}

// ----------------------------------------------------------------- creature refs

export const packRef = (key: string): string => `pack:${key}`
export const gameRef = (id: string): string => `game:${id}`

export interface ResolvedCreature {
  ref: string
  name: string
  /** Document key of the stat block's source, for attribution; 'homebrew' for game-made ones. */
  source: string
  data: Record<string, unknown>
  /** True for a game-level template (edited or homebrew). */
  custom: boolean
}

/** The stat block a row points at, or undefined when it is gone (or the row is a plain mini). */
export function resolveCreature(
  ref: string | undefined,
  compendium: readonly CreatureEntry[] | undefined,
  templates: Record<string, CreatureTemplate> | undefined,
): ResolvedCreature | undefined {
  if (!ref) return undefined
  if (ref.startsWith('game:')) {
    const t = templates?.[ref.slice(5)]
    return t && { ref, name: t.name, source: t.source ?? 'homebrew', data: t.data, custom: true }
  }
  if (ref.startsWith('pack:')) {
    const key = ref.slice(5)
    const e = compendium?.find((c) => c.key === key)
    return e && { ref, name: e.name, source: e.source, data: e.data, custom: false }
  }
  return undefined
}

/** What tokens of a row are called: the override, else the creature's name, else "Creature". */
export function rowName(row: EncounterRow, creature?: Pick<ResolvedCreature, 'name'>): string {
  return row.overrides?.name?.trim() || creature?.name || 'Creature'
}

/** A game template copied from a compendium entry (or another template), for "Edit stat block". */
export function templateFrom(creature: ResolvedCreature, now = Date.now()): CreatureTemplate {
  const from = creature.ref.startsWith('pack:') ? creature.ref.slice(5) : undefined
  return { id: crypto.randomUUID(), name: creature.name, ...(from ? { from } : {}), source: creature.source, data: structuredClone(creature.data), updatedAt: now }
}

// ----------------------------------------------------------------- sheets

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** The creature's average hit points (the stored maximum). */
export function averageHp(config: Pick<CreatureConfig, 'hp'>, data: Record<string, unknown>): number | undefined {
  const v = getPath(data, config.hp.split('.'))
  return num(v) ?? num(getPath(v, ['max']))
}

/** The hit dice formula to roll for `hpMode: 'roll'`, when the creature has one. */
export function hpFormula(config: Pick<CreatureConfig, 'hpFormula'>, data: Record<string, unknown>): string | undefined {
  if (!config.hpFormula) return undefined
  const f = getPath(data, config.hpFormula.split('.'))
  return typeof f === 'string' && /\dd\d/.test(f) ? f : undefined
}

/**
 * Sheet data for one placed token: a deep copy of the stat block with the row's overrides
 * written through the pack's creature paths. `hp` (rolled or overridden) sets current and max.
 */
export function creatureSheetData(config: CreatureConfig, base: Record<string, unknown>, row: EncounterRow, hp?: number): Record<string, unknown> {
  const data = structuredClone(base)
  const o = row.overrides ?? {}
  const points = num(o.hp) ?? hp
  if (points !== undefined) {
    const path = config.hp.split('.')
    const cur = getPath(data, path)
    const value = Math.max(1, Math.round(points))
    if (cur && typeof cur === 'object') setPath(data, path, { ...(cur as object), current: value, max: value })
    else setPath(data, path, value)
  }
  if (config.ac && num(o.ac) !== undefined) setPath(data, config.ac.split('.'), num(o.ac))
  if (config.notes && o.notes?.trim()) {
    const path = config.notes.split('.')
    const prev = getPath(data, path)
    setPath(data, path, typeof prev === 'string' && prev.trim() ? `${prev}\n${o.notes.trim()}` : o.notes.trim())
  }
  return data
}

/** Names for a row's tokens: "Goblin" alone, "Goblin 1", "Goblin 2"... for several. */
export function tokenNames(base: string, count: number): string[] {
  return count === 1 ? [base] : Array.from({ length: count }, (_, i) => `${base} ${i + 1}`)
}

// ----------------------------------------------------------------- difficulty

export interface PartySpec {
  size: number
  level: number
  /** Where the numbers came from: players' sheets, set by hand, or nothing found. */
  from: 'sheets' | 'manual' | 'none'
  /** Levels of each detected character (for the arithmetic line). */
  levels: number[]
}

/**
 * The party: characters on player-owned tokens in `scene` (or anywhere when no token is in it),
 * each read for the pack's level path. `manual` overrides size and level.
 */
export function detectParty(
  rules: Pick<EncounterRules, 'level'>,
  tokens: Record<TokenId, Token>,
  characters: Record<string, Character>,
  scene: string | null | undefined,
  manual?: Encounter['party'],
): PartySpec {
  if (manual && manual.size > 0 && manual.level > 0) {
    return { size: Math.floor(manual.size), level: Math.floor(manual.level), from: 'manual', levels: Array.from({ length: Math.floor(manual.size) }, () => Math.floor(manual.level)) }
  }
  const owned = Object.values(tokens).filter((t) => t.owner && t.character && characters[t.character])
  const here = owned.filter((t) => t.scene === scene)
  const seen = new Set<string>()
  const levels: number[] = []
  for (const t of here.length ? here : owned) {
    if (seen.has(t.character!)) continue
    seen.add(t.character!)
    const lv = num(getPath(characters[t.character!]!.data, rules.level.split('.')))
    if (lv !== undefined && lv > 0) levels.push(Math.floor(lv))
  }
  if (!levels.length) return { size: 0, level: 0, from: 'none', levels: [] }
  const avg = Math.round(levels.reduce((a, b) => a + b, 0) / levels.length)
  return { size: levels.length, level: avg, from: 'sheets', levels }
}

export interface DifficultyLine {
  name: string
  count: number
  xp: number
}

export interface Difficulty {
  /** Total budget per band for the whole party, in band order. */
  budgets: { id: string; name: string; xp: number }[]
  /** Hostile creatures counted, and their XP. */
  lines: DifficultyLine[]
  total: number
  /**
   * Index of the first band whose budget covers the total (at or under the Low budget is Low);
   * -1 without a party or hostile XP. Over the last budget it is the last band with `over` set.
   */
  band: number
  over: boolean
  /** Friendly tokens left out of the count. */
  friendlies: number
}

/** Budget per band for one character of `level`, clamped to the table's levels. */
export function budgetFor(rules: Pick<EncounterRules, 'budget'>, level: number): number[] | undefined {
  const levels = Object.keys(rules.budget).map(Number).sort((a, b) => a - b)
  if (!levels.length) return undefined
  const lv = Math.min(levels[levels.length - 1]!, Math.max(levels[0]!, Math.floor(level)))
  return rules.budget[String(lv)] ?? rules.budget[String(levels.find((l) => l >= lv) ?? levels[0])]
}

/**
 * The encounter's XP against the party's budget: sum each character's per-band budget, sum the
 * XP of every hostile creature, and report the band the total falls in. Pure arithmetic over
 * pack data; the engine knows nothing about the bands.
 */
export function encounterDifficulty(rules: EncounterRules, party: Pick<PartySpec, 'levels'>, rows: { name: string; count: number; xp: number | undefined; friendly?: boolean }[]): Difficulty {
  const sums = rules.bands.map(() => 0)
  for (const lv of party.levels) {
    const b = budgetFor(rules, lv)
    if (b) b.forEach((x, i) => (sums[i] += x))
  }
  const budgets = rules.bands.map((b, i) => ({ id: b.id, name: b.name, xp: sums[i]! }))
  const lines: DifficultyLine[] = []
  let friendlies = 0
  for (const r of rows) {
    const count = Math.max(0, Math.floor(r.count || 0))
    if (!count) continue
    if (r.friendly) { friendlies += count; continue }
    lines.push({ name: r.name, count, xp: r.xp ?? 0 })
  }
  const total = lines.reduce((n, l) => n + l.count * l.xp, 0)
  const band = party.levels.length && total > 0 ? budgets.findIndex((b) => total <= b.xp) : -1
  const over = party.levels.length > 0 && total > (budgets[budgets.length - 1]?.xp ?? Infinity)
  return { budgets, lines, total, band: over ? budgets.length - 1 : band, over, friendlies }
}

/** The meter's verdict: "Low", "Moderate", "High", "Above High" or "No party". */
export function difficultyLabel(d: Difficulty, hasParty: boolean): string {
  if (!hasParty) return 'No party'
  if (d.total === 0) return 'Nothing hostile'
  if (d.over) return `Above ${d.budgets[d.budgets.length - 1]!.name}`
  return d.budgets[d.band]?.name ?? '—'
}

/** "4 × Goblin Warrior (50) + 1 × Bugbear (200) = 400 XP" */
export function difficultyArithmetic(d: Difficulty): string {
  if (!d.lines.length) return '0 XP'
  return `${d.lines.map((l) => `${l.count} × ${l.name} (${l.xp})`).join(' + ')} = ${d.total} XP`
}

// ----------------------------------------------------------------- initiative

/**
 * A group joining the turn order: every token in `groups` gets its group's single score, the
 * tokens already listed are replaced, and the order is sorted highest first (ties keep order,
 * so a group stays together).
 */
export function mergeGroupInitiative(order: { token: TokenId; score: number }[], groups: { tokens: TokenId[]; score: number }[]): { token: TokenId; score: number }[] {
  const joining = new Set(groups.flatMap((g) => g.tokens))
  const next = [...order.filter((e) => !joining.has(e.token)), ...groups.flatMap((g) => g.tokens.map((token) => ({ token, score: g.score })))]
  return next.map((e, i) => ({ e, i })).sort((a, b) => b.e.score - a.e.score || a.i - b.i).map(({ e }) => e)
}

// ----------------------------------------------------------------- legacy localStorage

/** Where versions before shared encounters kept them, per game, on the GM's device. */
export function legacyEncountersKey(gameId: string): string { return `vtt.prep.encounters.${gameId}` }

interface LegacyRow { id?: unknown; name?: unknown; count?: unknown; color?: unknown; generateSheet?: unknown }

/** Old `{ name, count, color, generateSheet }` rows as current encounters. */
export function migrateLegacyEncounters(raw: unknown, now = Date.now()): Encounter[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string').map((e, i) => ({
    id: e.id as string,
    name: typeof e.name === 'string' ? e.name : 'Encounter',
    rows: (Array.isArray(e.rows) ? (e.rows as LegacyRow[]) : []).filter((r) => r && typeof r === 'object').map((r, j) => {
      const name = typeof r.name === 'string' ? r.name.trim() : ''
      const row: EncounterRow = {
        id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
        count: typeof r.count === 'number' && Number.isFinite(r.count) ? r.count : 1,
        color: typeof r.color === 'string' ? r.color : ENCOUNTER_COLORS[j % ENCOUNTER_COLORS.length]!,
      }
      if (name) row.overrides = { name }
      if (r.generateSheet === true) row.generateSheet = true
      return row
    }),
    placed: Array.isArray(e.placed) ? (e.placed.filter((x) => typeof x === 'string') as TokenId[]) : [],
    createdAt: now + i,
  }))
}

/** Encounters still on this device from before they moved into the game; empty when none or unreadable. */
export function loadLegacyEncounters(gameId: string, now = Date.now()): Encounter[] {
  try {
    const raw = localStorage.getItem(legacyEncountersKey(gameId))
    return raw ? migrateLegacyEncounters(JSON.parse(raw) as unknown, now) : []
  } catch { return [] }
}

export function clearLegacyEncounters(gameId: string): void {
  try { localStorage.removeItem(legacyEncountersKey(gameId)) } catch { /* private mode */ }
}

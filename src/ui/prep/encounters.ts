/**
 * Saved encounters live in localStorage on the GM's device, keyed per game. An encounter is a name
 * plus rows of "N of this creature in this colour"; placing it records the token ids so Reveal /
 * Hide / Remove act on exactly those tokens.
 */
import type { TokenId } from '@/core/ids'

export interface EncounterRow {
  id: string
  name: string
  count: number
  color: string
  /** Roll a character sheet for each token (chargen) instead of a plain mini. */
  generateSheet: boolean
}

export interface Encounter {
  id: string
  name: string
  rows: EncounterRow[]
  /** Tokens created by the last Place. */
  placed: TokenId[]
}

export const ENCOUNTER_COLORS = ['#f28b82', '#e0a458', '#ffd166', '#8fd18f', '#7cc4ff', '#c58af9', '#9aa0a6']

export function encountersKey(gameId: string): string { return `vtt.prep.encounters.${gameId}` }

export function loadEncounters(gameId: string): Encounter[] {
  try {
    const raw = localStorage.getItem(encountersKey(gameId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is Encounter => !!e && typeof e === 'object' && typeof (e as Encounter).id === 'string').map((e) => ({
      id: e.id, name: String(e.name ?? 'Encounter'), rows: Array.isArray(e.rows) ? e.rows : [], placed: Array.isArray(e.placed) ? e.placed : [],
    }))
  } catch { return [] }
}

export function saveEncounters(gameId: string, list: Encounter[]): void {
  try { localStorage.setItem(encountersKey(gameId), JSON.stringify(list)) } catch { /* private mode, quota */ }
}

export function newRow(index: number): EncounterRow {
  return { id: crypto.randomUUID(), name: '', count: 1, color: ENCOUNTER_COLORS[index % ENCOUNTER_COLORS.length]!, generateSheet: false }
}

export function newEncounter(index: number): Encounter {
  return { id: crypto.randomUUID(), name: `Encounter ${index + 1}`, rows: [newRow(0)], placed: [] }
}

/** Total tokens an encounter places. */
export function encounterSize(e: Encounter): number {
  return e.rows.reduce((n, r) => n + Math.max(0, Math.floor(r.count || 0)), 0)
}

/**
 * The GM drawer's items and their live-state lines (docs/UX.md "Table layout"): Sound, Players,
 * Journal, Tables, NPC, Encounters and Credits, each opening as the one card. Pure, so the labels
 * are tested without the shell.
 */
import type { IconName } from '../icons'

export interface DrawerState {
  /** Sounds playing on this GM's soundboard. */
  playing: number
  /** People at the table besides this GM. */
  here: number
  /** Journal entries not seen yet. */
  journalNew: number
  /** Saved encounters, oldest first (the newest is offered by name). */
  encounters: readonly { name: string }[]
}

export interface DrawerItem {
  /** The registry panel it opens. */
  panel: string
  label: string
  glyph: IconName
  /** The live line under the label; empty when there is nothing to say. */
  state: string
  /** Something waits in it (the journal's "new"): the drawer button carries a mark. */
  attention?: boolean
}

export function soundState(playing: number): string {
  return playing > 0 ? `${playing} playing` : ''
}

export function playersState(here: number): string {
  return here > 0 ? `${here} here` : 'nobody yet'
}

export function journalState(unread: number): string {
  return unread > 0 ? `${unread} new` : ''
}

/** One encounter: "Ambush ready"; several: "3 saved"; none: nothing. */
export function encountersState(encounters: readonly { name: string }[]): string {
  if (encounters.length === 0) return ''
  if (encounters.length === 1) return `${encounters[0]!.name.trim() || 'Encounter'} ready`
  return `${encounters.length} saved`
}

export function drawerItems(s: DrawerState): DrawerItem[] {
  return [
    { panel: 'sound', label: 'Sound', glyph: 'sound', state: soundState(s.playing) },
    { panel: 'players', label: 'Players', glyph: 'users', state: playersState(s.here) },
    { panel: 'journal', label: 'Journal', glyph: 'book', state: journalState(s.journalNew), attention: s.journalNew > 0 },
    { panel: 'tables', label: 'Tables', glyph: 'dice', state: '' },
    { panel: 'npc', label: 'NPC', glyph: 'pawn', state: '' },
    { panel: 'encounters', label: 'Encounters', glyph: 'swords', state: encountersState(s.encounters) },
    { panel: 'credits', label: 'Credits', glyph: 'ribbon', state: '' },
  ]
}

/** The drawer button's accessible name: what it is plus anything waiting. */
export function drawerButtonLabel(items: readonly DrawerItem[]): string {
  const waiting = items.filter((i) => i.attention && i.state).map((i) => `${i.label} ${i.state}`)
  return waiting.length ? `GM drawer: ${waiting.join(', ')}` : 'GM drawer: sound, players, journal, tables, NPC, encounters, credits'
}

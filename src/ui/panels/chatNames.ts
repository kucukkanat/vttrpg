/** Pure name matching for chat commands (`/w <name>`), kept apart from the panel so it can be tested. */

export interface Person {
  pubkey: string
  name: string
}

export type WhisperMatch =
  | { kind: 'found'; person: Person }
  | { kind: 'ambiguous'; matches: Person[] }
  | { kind: 'none' }

/**
 * Resolve the `<name>` of a whisper. Matching is case-insensitive on a display-name prefix; an exact
 * match wins over longer names that merely start with it; `gm` always reaches the GM.
 */
export function findWhisperTarget(who: string, people: Person[], gm: string): WhisperMatch {
  const q = who.trim().toLowerCase()
  if (!q) return { kind: 'none' }
  if (q === 'gm') {
    const person = people.find((p) => p.pubkey === gm) ?? { pubkey: gm, name: 'GM' }
    return { kind: 'found', person }
  }
  const exact = people.filter((p) => p.name.toLowerCase() === q)
  if (exact.length === 1) return { kind: 'found', person: exact[0] }
  if (exact.length > 1) return { kind: 'ambiguous', matches: exact }
  const prefix = people.filter((p) => p.name.toLowerCase().startsWith(q))
  if (prefix.length === 1) return { kind: 'found', person: prefix[0] }
  if (prefix.length > 1) return { kind: 'ambiguous', matches: prefix }
  return { kind: 'none' }
}

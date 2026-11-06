import { describe, expect, it } from 'vitest'
import { findWhisperTarget, type Person } from './chatNames'

const gm = 'gm'.repeat(32)
const people: Person[] = [
  { pubkey: gm, name: 'Tolga GM' },
  { pubkey: 'a'.repeat(64), name: 'Pip' },
  { pubkey: 'b'.repeat(64), name: 'Pippin' },
  { pubkey: 'c'.repeat(64), name: 'nettle' },
]

describe('findWhisperTarget', () => {
  it('matches a display-name prefix case-insensitively', () => {
    expect(findWhisperTarget('NET', people, gm)).toEqual({ kind: 'found', person: people[3] })
    expect(findWhisperTarget('tolga', people, gm)).toEqual({ kind: 'found', person: people[0] })
  })
  it('prefers an exact match over longer names with the same prefix', () => {
    expect(findWhisperTarget('pip', people, gm)).toEqual({ kind: 'found', person: people[1] })
    expect(findWhisperTarget('pipp', people, gm)).toEqual({ kind: 'found', person: people[2] })
  })
  it('reports ambiguity when several names share the prefix', () => {
    const r = findWhisperTarget('p', people, gm)
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.matches.map((p) => p.name)).toEqual(['Pip', 'Pippin'])
  })
  it('accepts gm whether or not the GM is in the list', () => {
    expect(findWhisperTarget('GM', people, gm)).toEqual({ kind: 'found', person: people[0] })
    expect(findWhisperTarget('gm', people.slice(1), gm)).toEqual({ kind: 'found', person: { pubkey: gm, name: 'GM' } })
  })
  it('reports when no one matches', () => {
    expect(findWhisperTarget('Zed', people, gm)).toEqual({ kind: 'none' })
    expect(findWhisperTarget('', people, gm)).toEqual({ kind: 'none' })
  })
})

import { describe, expect, it } from 'vitest'
import type { InitiativeState, Token } from '@/core/doc'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { discSlots, STRIP_METRICS, turnStrip } from './turnStrip'

const me = 'me'.padEnd(64, '0') as PlayerPubkey
const token = (id: string, over: Partial<Token> = {}): Token => ({
  id: id as TokenId, scene: 's' as SceneId, name: id, color: '#336699', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [], ...over,
})
const names = ['Pip', 'Rat', 'Ghost', 'Owl', 'Toad', 'Newt']
const tokens = Object.fromEntries(names.map((n) => [n, token(n, { hidden: n === 'Ghost', owner: n === 'Owl' ? me : undefined })])) as Record<TokenId, Token>
const state = (turn: number, over: Partial<InitiativeState> = {}): InitiativeState => ({
  active: true, round: 2, turn, order: names.map((n, i) => ({ token: n as TokenId, score: 20 - i })), ...over,
})
const ids = (s: ReturnType<typeof turnStrip>) => s?.discs.map((d) => d.token)

describe('turnStrip', () => {
  it('is null between encounters', () => {
    expect(turnStrip(null, tokens, true, me, 9)).toBeNull()
    expect(turnStrip(state(0, { active: false }), tokens, true, me, 9)).toBeNull()
    expect(turnStrip(state(0, { order: [] }), tokens, true, me, 9)).toBeNull()
  })
  it('starts at the current combatant and wraps into the next round', () => {
    const s = turnStrip(state(3), tokens, true, null, 9)!
    expect(s.round).toBe(2)
    expect(ids(s)).toEqual(['Owl', 'Toad', 'Newt', 'Pip', 'Rat', 'Ghost'])
    expect(s.discs[0]!.current).toBe(true)
    expect(s.discs.slice(1).every((d) => !d.current)).toBe(true)
    expect(s.overflow).toBe(0)
  })
  it('leaves hidden tokens out for players and dims them for the GM', () => {
    expect(ids(turnStrip(state(0), tokens, false, me, 9))).toEqual(['Pip', 'Rat', 'Owl', 'Toad', 'Newt'])
    expect(turnStrip(state(0), tokens, true, me, 9)!.discs.find((d) => d.token === 'Ghost')!.hidden).toBe(true)
  })
  it('shows an anonymous disc when a hidden token has the turn', () => {
    const s = turnStrip(state(2), tokens, false, me, 9)!
    expect(s.discs[0]).toMatchObject({ current: true, name: 'Someone', initials: '?' })
    expect(s.discs[0]!.color).not.toBe(tokens['Ghost' as TokenId]!.color)
  })
  it("marks the viewer's own tokens for players only", () => {
    expect(turnStrip(state(0), tokens, false, me, 9)!.discs.find((d) => d.token === 'Owl')!.mine).toBe(true)
    expect(turnStrip(state(0), tokens, true, me, 9)!.discs.find((d) => d.token === 'Owl')!.mine).toBe(false)
  })
  it('turns the last slot into "+N" when they do not all fit', () => {
    const s = turnStrip(state(0), tokens, true, null, 4)!
    expect(ids(s)).toEqual(['Pip', 'Rat', 'Ghost'])
    expect(s.overflow).toBe(3)
    const one = turnStrip(state(0), tokens, true, null, 1)!
    expect(ids(one)).toEqual(['Pip'])
    expect(one.overflow).toBe(5)
  })
  it('names deleted tokens "Gone"', () => {
    const s = turnStrip({ active: true, round: 1, turn: 0, order: [{ token: 'x' as TokenId, score: 1 }] }, tokens, true, null, 3)!
    expect(s.discs[0]).toMatchObject({ name: 'Gone', initials: '?' })
  })
})

describe('discSlots', () => {
  const m = STRIP_METRICS
  const base = m.chrome + m.badge + m.current
  it('always leaves room for the current combatant', () => {
    expect(discSlots(0)).toBe(1)
    expect(discSlots(base)).toBe(1)
    expect(discSlots(Number.NaN)).toBe(1)
  })
  it('adds a slot per disc and gap that fits', () => {
    expect(discSlots(base + m.disc + m.gap - 1)).toBe(1)
    expect(discSlots(base + m.disc + m.gap)).toBe(2)
    expect(discSlots(base + 3 * (m.disc + m.gap))).toBe(4)
  })
  it('fits several discs on a 320 px phone next to the camera rail', () => {
    // 320 wide, 8 px HUD padding either side, the 60 px rail and its gap.
    expect(discSlots(320 - 16 - 60 - 8)).toBeGreaterThanOrEqual(5)
  })
})

describe('turnStrip groups and declared actions', () => {
  const grouped = (turn: number): InitiativeState => ({
    active: true, round: 1, turn,
    order: [
      { token: 'Pip' as TokenId, score: 20 },
      { token: 'Rat' as TokenId, score: 12, group: 'r' },
      { token: 'Ghost' as TokenId, score: 12, group: 'r' },
      { token: 'Toad' as TokenId, score: 12, group: 'r' },
      { token: 'Owl' as TokenId, score: 3 },
    ],
  })
  it('draws a group as one disc with its size', () => {
    const s = turnStrip(grouped(1), tokens, true, me, 9)!
    expect(ids(s)).toEqual(['Rat', 'Owl', 'Pip'])
    expect(s.discs[0]).toMatchObject({ current: true, count: 3 })
    expect(s.discs[1]!.count).toBeUndefined()
  })
  it('players count only the members they can see', () => {
    const s = turnStrip(grouped(0), tokens, false, me, 9)!
    expect(s.discs.find((d) => d.token === 'Rat')!.count).toBe(2)
  })
  it('carries a declared action on the disc', () => {
    const s = turnStrip({ ...grouped(0), declared: { Toad: { token: 'Toad' as TokenId, label: 'Bite', icon: 'fang', targets: [], at: 1 } } }, tokens, true, me, 9)!
    expect(s.discs.find((d) => d.token === 'Rat')!.intent).toEqual({ label: 'Bite', icon: 'fang' })
    expect(s.discs[0]!.intent).toBeUndefined()
  })
})

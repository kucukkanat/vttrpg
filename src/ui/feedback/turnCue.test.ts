import { describe, expect, it } from 'vitest'
import type { InitiativeState, Token } from '@/core/doc'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { cuesViewer, turnKey } from './TurnCue'

const me = 'me'.padEnd(64, '0') as PlayerPubkey
const other = 'ot'.padEnd(64, '0') as PlayerPubkey
const token = (id: string, owner?: PlayerPubkey): Token => ({
  id: id as TokenId, scene: 's' as SceneId, name: id, color: '#336699', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [], owner,
})
const tokens = { a: token('a', me), b: token('b', other), c: token('c') }
const init = (turn: number, round = 1): InitiativeState => ({
  active: true, round, turn, order: [{ token: 'a' as TokenId, score: 15 }, { token: 'b' as TokenId, score: 10 }, { token: 'c' as TokenId, score: 5 }],
})

describe('turn cue', () => {
  it('keys the turn by round and token, null between encounters', () => {
    expect(turnKey(init(1))).toBe('1:b')
    expect(turnKey({ ...init(0), active: false })).toBeNull()
    expect(turnKey(null)).toBeNull()
  })
  it('cues the owner when their turn starts, not others, not the GM, not a repeat', () => {
    expect(cuesViewer('1:c', init(0, 2), tokens, me, false)).toBe(true)
    expect(cuesViewer('2:a', init(0, 2), tokens, me, false)).toBe(false)
    expect(cuesViewer('1:a', init(1), tokens, me, false)).toBe(false)
    expect(cuesViewer('1:b', init(2), tokens, me, false)).toBe(false)
    expect(cuesViewer('1:c', init(0, 2), tokens, me, true)).toBe(false)
  })
})

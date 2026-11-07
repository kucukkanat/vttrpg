import { describe, expect, it } from 'vitest'
import type { InitiativeState, Token } from '@/core/doc'
import type { SceneId, TokenId } from '@/core/ids'
import { CUE_PREFS_DEFAULT, endedConditions, parseCuePrefs, turnStarted } from './cues'

const me = 'me'
const tok = (id: string, owner?: string, conditions: string[] = []): Token => ({
  id: id as TokenId, scene: 's' as SceneId, name: id.toUpperCase(), color: '#fff', owner: owner as never,
  position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions,
})
const init = (turn: number, round = 1, active = true): InitiativeState => ({ active, round, turn, order: [{ token: 'a' as TokenId, score: 10 }, { token: 'b' as TokenId, score: 5 }] })

describe('cue prefs', () => {
  it('are off by default and read only booleans', () => {
    expect(parseCuePrefs(null)).toEqual(CUE_PREFS_DEFAULT)
    expect(parseCuePrefs('garbage')).toEqual(CUE_PREFS_DEFAULT)
    expect(parseCuePrefs(JSON.stringify({ turn: { sound: true, speech: 'yes' } }))).toEqual({ turn: { sound: true, speech: false }, expired: { sound: false, speech: false } })
  })
})

describe('turnStarted', () => {
  const tokens = { a: tok('a', 'other'), b: tok('b', me) }
  it('fires when the turn moves to a token you own, once', () => {
    expect(turnStarted(init(0), init(1), tokens, me)?.id).toBe('b')
    expect(turnStarted(init(1), init(1), tokens, me)).toBeNull()
    expect(turnStarted(init(1), init(0, 2), tokens, me)).toBeNull()
  })
  it('fires when combat starts on your token, not when it is inactive', () => {
    const mine = { a: tok('a', me), b: tok('b') }
    expect(turnStarted(null, init(0), mine, me)?.id).toBe('a')
    expect(turnStarted(init(0, 1, false), init(0), mine, me)?.id).toBe('a')
    expect(turnStarted(init(0), init(0, 1, false), mine, me)).toBeNull()
  })
})

describe('endedConditions', () => {
  it('lists conditions removed from your tokens only', () => {
    const prev = { a: tok('a', me, ['poisoned', 'prone']), b: tok('b', 'x', ['prone']) }
    const next = { a: tok('a', me, ['prone']), b: tok('b', 'x', []) }
    expect(endedConditions(prev, next, me).map((e) => `${e.token.id}:${e.condition}`)).toEqual(['a:poisoned'])
    expect(endedConditions({}, next, me)).toEqual([])
  })
})

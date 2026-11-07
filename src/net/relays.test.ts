import { describe, expect, it } from 'vitest'
import type { RelayHealth } from './pool'
import { gradeRelay, planRelayRotation, relaysToAdd } from './relays'

const h = (url: string, state: RelayHealth['state'], extra: Partial<RelayHealth> = {}): RelayHealth => ({
  url, state, failures: state === 'down' ? 3 : 0, publishOk: 0, publishFailed: 0, rejectStreak: 0, ...extra,
})

describe('gradeRelay', () => {
  it('grades open, refusing, connecting and down relays', () => {
    expect(gradeRelay(h('wss://a/', 'open'))).toBe('good')
    expect(gradeRelay(h('wss://a/', 'open', { rejectStreak: 3 }))).toBe('refusing')
    expect(gradeRelay(h('wss://a/', 'connecting'))).toBe('connecting')
    expect(gradeRelay(h('wss://a/', 'idle'))).toBe('connecting')
    expect(gradeRelay(h('wss://a/', 'down'))).toBe('down')
  })
})

describe('planRelayRotation', () => {
  const reserves = ['wss://r1', 'wss://r2', 'wss://r3']
  it('adds nothing while enough relays are healthy or still coming up', () => {
    const health = [h('wss://a/', 'open'), h('wss://b/', 'open'), h('wss://c/', 'connecting')]
    expect(planRelayRotation({ health, current: ['wss://a', 'wss://b', 'wss://c'], reserves })).toEqual([])
  })
  it('brings in reserves for relays that are down or refusing, skipping ones in use', () => {
    const health = [h('wss://a/', 'open'), h('wss://b/', 'down'), h('wss://r1/', 'open', { rejectStreak: 5 })]
    expect(planRelayRotation({ health, current: ['wss://a', 'wss://b', 'wss://r1'], reserves })).toEqual(['wss://r2/', 'wss://r3/'])
  })
  it('never grows the game past the cap', () => {
    const health = [h('wss://a/', 'down'), h('wss://b/', 'down')]
    expect(planRelayRotation({ health, current: ['wss://a', 'wss://b'], reserves, maxRelays: 3 })).toEqual(['wss://r1/'])
    expect(planRelayRotation({ health, current: ['wss://a', 'wss://b'], reserves, maxRelays: 2 })).toEqual([])
  })
  it('counts a relay that is retrying after failures as not healthy', () => {
    const health = [h('wss://a/', 'open'), h('wss://b/', 'connecting', { failures: 4 }), h('wss://c/', 'open')]
    expect(planRelayRotation({ health, current: ['wss://a', 'wss://b', 'wss://c'], reserves })).toEqual(['wss://r1/'])
  })
})

describe('relaysToAdd', () => {
  it('returns new, well-formed relays in order, normalized and capped', () => {
    expect(relaysToAdd(['wss://a'], ['wss://a/', 'wss://b', 'https://nope', 42 as never, 'wss://c'], 3)).toEqual(['wss://b/', 'wss://c/'])
    expect(relaysToAdd(['wss://a', 'wss://b'], ['wss://c', 'wss://d'], 3)).toEqual(['wss://c/'])
  })
})

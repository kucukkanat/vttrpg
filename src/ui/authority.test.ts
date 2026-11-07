import { describe, expect, it } from 'vitest'
import type { PlayerPubkey } from '@/core/ids'
import type { GameController } from './controller'
import { readAuthority, roleLabel } from './authority'
import { relayDetail } from './panels/RelayStatus'

const F = 'f'.repeat(64) as PlayerPubkey
const C = 'c'.repeat(64) as PlayerPubkey
const conn = (over: Partial<GameController['connection']>) =>
  ({ gm: F, isGm: false, role: 'player', authority: { founder: F, coGms: [], host: F }, processing: false, ...over }) as GameController['connection']

describe('readAuthority', () => {
  it('asks for a reopen when the manifest role and the running connection disagree', () => {
    expect(readAuthority(conn({ role: 'co-gm', isGm: false })).needsReopen).toBe(true)
    expect(readAuthority(conn({ role: 'player', isGm: true })).needsReopen).toBe(true)
    expect(readAuthority(conn({ role: 'co-gm', isGm: true, authority: { founder: F, coGms: [C], host: C } })).needsReopen).toBe(false)
    expect(readAuthority(conn({ role: 'gm', isGm: true })).needsReopen).toBe(false)
  })
  it('labels roles', () => {
    expect([roleLabel('gm'), roleLabel('co-gm'), roleLabel('player')]).toEqual(['GM', 'Co-GM', 'Player'])
  })
})

describe('relayDetail', () => {
  const base = { url: 'wss://r/', failures: 0, publishOk: 0, publishFailed: 0, rejectStreak: 0 }
  it('describes down relays with the retry countdown and the reason', () => {
    expect(relayDetail({ ...base, state: 'down', failures: 3, nextRetryAt: 5_400, lastError: 'connect failed: refused' }, 1_000)).toBe('retry in 5s · 3 failed attempts · refused')
  })
  it('describes refusing and working relays', () => {
    expect(relayDetail({ ...base, state: 'open', rejectStreak: 4, lastError: undefined }, 0)).toBe('4 writes refused in a row')
    expect(relayDetail({ ...base, state: 'open', publishOk: 12, publishFailed: 1 }, 0)).toBe('12 sent, 1 refused')
    expect(relayDetail({ ...base, state: 'connecting' }, 0)).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import type { PlayerPubkey } from '@/core/ids'
import type { Manifest } from './codec'
import { GRANT_SKEW_S, authorityOf, canWriteAt, grantCoGm, isWriter, processorOrder, revokeCoGm, sanitizeGrants, setHost } from './authority'

const F = 'f'.repeat(64) as PlayerPubkey
const C1 = '1'.repeat(64) as PlayerPubkey
const C2 = '2'.repeat(64) as PlayerPubkey
const base: Manifest = { name: 'g', gm: F, relays: [] }

describe('authority', () => {
  it('sanitizes grants: hex keys only, never the founder, one per key, until after since', () => {
    const raw = [
      { pubkey: C1, since: 10 },
      { pubkey: 'nothex', since: 1 },
      { pubkey: F, since: 1 },
      { pubkey: C2, since: 10, until: 5 },
      { pubkey: C1, since: 20, until: 30 },
      null,
    ]
    expect(sanitizeGrants(raw, F)).toEqual([{ pubkey: C1, since: 20, until: 30 }])
    expect(sanitizeGrants('x', F)).toEqual([])
  })

  it('grant, revoke and host edits keep the founder in charge', () => {
    let m = grantCoGm(base, C1, 100)
    m = grantCoGm(m, C2, 110)
    expect(isWriter(authorityOf(m), C1)).toBe(true)
    expect(() => grantCoGm(m, F, 1)).toThrow()
    expect(() => grantCoGm(m, 'abc', 1)).toThrow()
    m = setHost(m, C1)
    expect(authorityOf(m).host).toBe(C1)
    expect(processorOrder(authorityOf(m))).toEqual([C1, F, C2])
    m = revokeCoGm(m, C1, 200)
    const a = authorityOf(m)
    expect(a.host).toBe(F)
    expect(isWriter(a, C1)).toBe(false)
    expect(processorOrder(a)).toEqual([F, C2])
    expect(() => setHost(m, C1)).toThrow()
    expect(setHost(m, F).host).toBeUndefined()
    // Re-granting opens a new window.
    expect(isWriter(authorityOf(grantCoGm(m, C1, 300)), C1)).toBe(true)
  })

  it('accepts deltas only inside the grant window (with a little clock skew before it)', () => {
    const a = authorityOf(revokeCoGm(grantCoGm(base, C1, 1000), C1, 2000))
    expect(canWriteAt(a, F, 1)).toBe(true)
    expect(canWriteAt(a, C1, 1500)).toBe(true)
    expect(canWriteAt(a, C1, 1000 - GRANT_SKEW_S)).toBe(true)
    expect(canWriteAt(a, C1, 1000 - GRANT_SKEW_S - 1)).toBe(false)
    expect(canWriteAt(a, C1, 2001)).toBe(false)
    expect(canWriteAt(a, C2, 1500)).toBe(false)
  })

  it('a host that is not an active co-GM falls back to the founder', () => {
    expect(authorityOf({ ...base, host: C1 }).host).toBe(F)
  })
})

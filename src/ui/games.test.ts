import { describe, expect, it } from 'vitest'
import type { GameId, PlayerPubkey } from '@/core/ids'
import { createGamesRegistry, decideRejoin, formatLastOpened, naddrFromInvite, type SavedGame } from './games'

function memStore() {
  const m = new Map<string, string>()
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

const NADDR = 'naddr1qqxnzd3cxqmrzv3exgmr2wfeqgsxu35yyt0mwjjh8pcz4zprhxegz69t4wr9t74vk6zne58wzh0waycrqsqqqa28pjfdhz'
const INVITE = `https://user.github.io/vttrpg/#/join/${NADDR}?k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`

const game = (id: string, over: Partial<SavedGame> = {}): Omit<SavedGame, 'lastOpened'> & { lastOpened?: number } => ({
  gameId: id as GameId,
  naddr: '',
  invite: INVITE,
  name: `Game ${id}`,
  isGm: false,
  gm: 'f'.repeat(64) as PlayerPubkey,
  relays: ['wss://a', 'wss://b'],
  pack: 'mausritter',
  ...over,
})

describe('games registry', () => {
  it('round-trips an entry through storage and fills in naddr from the invite', () => {
    const store = memStore()
    let t = 1000
    const reg = createGamesRegistry({ store, now: () => t })
    const saved = reg.remember(game('g1', { isGm: true, displayName: 'Tolga' }))
    expect(saved.lastOpened).toBe(1000)
    expect(saved.naddr).toBe(NADDR)

    // A second registry over the same store sees the same thing.
    const again = createGamesRegistry({ store, now: () => (t += 1) })
    expect(again.get('g1' as GameId)).toEqual(saved)
    expect(again.list()).toHaveLength(1)
    const raw = store.m.get('vttrpg.games')!
    expect(raw).toContain('"isGm":true')
    expect(raw).toContain('"displayName":"Tolga"')
    // The secret key never lives here; only the invite (game key) does.
    expect(raw).not.toContain('nostr.secret')
  })

  it('orders by lastOpened descending and touch moves a game to the top', () => {
    const store = memStore()
    let t = 0
    const reg = createGamesRegistry({ store, now: () => ++t })
    reg.remember(game('a'))
    reg.remember(game('b'))
    reg.remember(game('c'))
    expect(reg.list().map((g) => g.gameId)).toEqual(['c', 'b', 'a'])
    expect(reg.mostRecent()?.gameId).toBe('c')

    reg.touch('a' as GameId, { name: 'Renamed', isGm: true })
    expect(reg.list().map((g) => g.gameId)).toEqual(['a', 'c', 'b'])
    expect(reg.get('a' as GameId)).toMatchObject({ name: 'Renamed', isGm: true, lastOpened: 4 })
    expect(reg.touch('nope' as GameId)).toBeUndefined()
  })

  it('remember replaces an existing entry instead of duplicating it', () => {
    const reg = createGamesRegistry({ store: memStore() })
    reg.remember(game('a', { name: 'One' }))
    reg.remember(game('a', { name: 'Two' }))
    expect(reg.list()).toHaveLength(1)
    expect(reg.get('a' as GameId)?.name).toBe('Two')
  })

  it('forget removes an entry and notifies subscribers', () => {
    const reg = createGamesRegistry({ store: memStore() })
    let fired = 0
    const off = reg.subscribe(() => fired++)
    reg.remember(game('a'))
    reg.remember(game('b'))
    reg.forget('a' as GameId)
    expect(reg.list().map((g) => g.gameId)).toEqual(['b'])
    expect(fired).toBe(3)
    off()
    reg.forget('b' as GameId)
    expect(fired).toBe(3)
    expect(reg.list()).toEqual([])
  })

  it('ignores corrupt storage and malformed entries', () => {
    const store = memStore()
    store.setItem('vttrpg.games', 'not json')
    expect(createGamesRegistry({ store }).list()).toEqual([])
    store.setItem('vttrpg.games', JSON.stringify([{ gameId: 'ok', invite: INVITE, gm: 'f'.repeat(64) }, { nope: true }, 42]))
    const list = createGamesRegistry({ store }).list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ gameId: 'ok', name: '', isGm: false, relays: [], pack: '', naddr: NADDR })
  })

  it('extracts the naddr from invites in every accepted form', () => {
    expect(naddrFromInvite(INVITE)).toBe(NADDR)
    expect(naddrFromInvite(`#/join/${NADDR}?k=abc`)).toBe(NADDR)
    expect(naddrFromInvite(`${NADDR}?k=abc`)).toBe(NADDR)
    expect(naddrFromInvite('https://example.com/')).toBe('')
  })
})

describe('decideRejoin', () => {
  const me = 'a'.repeat(64)
  const other = 'b'.repeat(64)

  it('restores a GM whose identity still matches the manifest and the doc', () => {
    expect(decideRejoin({ saved: { isGm: true, name: 'X' }, pubkey: me, connectionIsGm: true, metaGm: me })).toEqual({ role: 'gm' })
  })

  it('falls back to player with a notice when net refused GM powers', () => {
    const d = decideRejoin({ saved: { isGm: true, name: 'X' }, pubkey: me, connectionIsGm: false, metaGm: other })
    expect(d.role).toBe('player')
    expect(d).toHaveProperty('notice')
    expect((d as { notice: string }).notice).toMatch(/rejoined as a player/)
  })

  it('falls back to player when the doc names another GM even if net agreed', () => {
    const d = decideRejoin({ saved: { isGm: true, name: 'X' }, pubkey: me, connectionIsGm: true, metaGm: other })
    expect(d.role).toBe('player')
  })

  it('is a plain player rejoin for saved players, with no notice', () => {
    expect(decideRejoin({ saved: { isGm: false, name: 'X' }, pubkey: me, connectionIsGm: false, metaGm: other })).toEqual({ role: 'player' })
  })

  it('errors instead of taking over an empty doc when nothing came back from the relays', () => {
    const d = decideRejoin({ saved: { isGm: true, name: 'Lost' }, pubkey: me, connectionIsGm: true, metaGm: undefined })
    expect(d.role).toBe('error')
    expect((d as { message: string }).message).toMatch(/Lost/)
  })
})

describe('formatLastOpened', () => {
  it('rounds to human units', () => {
    const now = 10_000_000_000
    expect(formatLastOpened(now, now)).toBe('just now')
    expect(formatLastOpened(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(formatLastOpened(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(formatLastOpened(now - 2 * 86_400_000, now)).toBe('2 d ago')
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { SECRET_STORAGE_KEY, loadIdentity, profileFromUrl, secretStorageKey } from './identity'

const hex64 = /^[0-9a-f]{64}$/

describe('dev profiles', () => {
  it('reads ?as= from the page query or the hash query, page query first', () => {
    expect(profileFromUrl('http://localhost:5173/')).toBeNull()
    expect(profileFromUrl('http://localhost:5173/?as=bob#/join/naddr1xyz?k=abc')).toBe('bob')
    expect(profileFromUrl('http://localhost:5173/#/join/naddr1xyz?k=abc&as=player1')).toBe('player1')
    expect(profileFromUrl('http://localhost:5173/?as=page#/join/naddr1xyz?k=abc&as=hash')).toBe('page')
    expect(profileFromUrl('http://localhost:5173/?other=1#/new')).toBeNull()
  })

  it('rejects names that are empty, long or carry odd characters', () => {
    expect(profileFromUrl('http://x/?as=')).toBeNull()
    expect(profileFromUrl('http://x/?as=bad%20name')).toBeNull()
    expect(profileFromUrl('http://x/?as=' + 'a'.repeat(33))).toBeNull()
    expect(profileFromUrl('http://x/?as=ok_name-1')).toBe('ok_name-1')
  })

  it('namespaces the secret storage key by profile', () => {
    expect(secretStorageKey(null)).toBe(SECRET_STORAGE_KEY)
    expect(secretStorageKey('bob')).toBe(`${SECRET_STORAGE_KEY}.bob`)
  })
})

describe('loadIdentity', () => {
  const g = globalThis as { window?: unknown }
  const hadWindow = 'window' in g
  const savedWindow = g.window
  afterEach(() => {
    if (hadWindow) g.window = savedWindow
    else delete g.window
  })

  it('persists one key per profile and keeps the default key separate', async () => {
    const withUrl = async (href: string) => {
      g.window = { location: { href } }
      return loadIdentity()
    }
    const plain = await withUrl('http://localhost/')
    const bob1 = await withUrl('http://localhost/?as=bob#/join/x?k=y')
    const bob2 = await withUrl('http://localhost/#/join/x?k=y&as=bob')
    const alice = await withUrl('http://localhost/?as=alice')
    const plainAgain = await withUrl('http://localhost/#/new')
    expect(bob1.pubkey).toMatch(hex64)
    expect(bob1.pubkey).toBe(bob2.pubkey)
    expect(alice.pubkey).not.toBe(bob1.pubkey)
    expect(plain.pubkey).not.toBe(bob1.pubkey)
    expect(plainAgain.pubkey).toBe(plain.pubkey)
  })
})

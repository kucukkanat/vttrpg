import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import type { GameId, PlayerPubkey } from '@/core/ids'
import {
  CHUNK_BYTES,
  Reassembler,
  base64UrlToBytes,
  bytesToBase64Url,
  concatBytes,
  decodeInvite,
  decryptBytes,
  decryptJson,
  decryptText,
  encodeInvite,
  encryptBytes,
  encryptJson,
  encryptText,
  parseChunkTag,
  randomGameKey,
  sha256Hex,
  splitUpdate,
} from './codec'

const gm = getPublicKey(generateSecretKey()) as PlayerPubkey
const gameId = crypto.randomUUID() as GameId

describe('invite links', () => {
  it('round trips through encode and parse', () => {
    const gameKey = randomGameKey()
    const relays = ['wss://relay.damus.io', 'wss://nos.lol']
    const url = encodeInvite({ gameId, gm, relays, gameKey }, { origin: 'https://user.github.io', base: '/vttrpg/' })
    expect(url.startsWith('https://user.github.io/vttrpg/#/join/naddr1')).toBe(true)
    expect(url).toContain('?k=')
    const info = decodeInvite(url)
    expect(info).not.toBeNull()
    expect(info!.gameId).toBe(gameId)
    expect(info!.gm).toBe(gm)
    expect(info!.relays).toEqual(relays)
    expect(Array.from(info!.gameKey)).toEqual(Array.from(gameKey))
  })

  it('accepts the fragment alone and a bare naddr', () => {
    const gameKey = randomGameKey()
    const url = encodeInvite({ gameId, gm, relays: [], gameKey }, { origin: 'http://localhost:5173', base: '/' })
    const frag = url.slice(url.indexOf('#'))
    expect(decodeInvite(frag)?.gameId).toBe(gameId)
    expect(decodeInvite(frag.slice('#/join/'.length))?.gm).toBe(gm)
    expect(decodeInvite(frag)?.relays).toEqual([])
  })

  it('rejects garbage, missing keys and wrong key lengths', () => {
    const gameKey = randomGameKey()
    const url = encodeInvite({ gameId, gm, relays: [], gameKey }, { origin: '', base: '/' })
    expect(decodeInvite('')).toBeNull()
    expect(decodeInvite('https://example.com/#/join/nope?k=abc')).toBeNull()
    expect(decodeInvite(url.slice(0, url.indexOf('?')))).toBeNull()
    expect(decodeInvite(url.replace(/k=.*$/, 'k=' + bytesToBase64Url(new Uint8Array(16))))).toBeNull()
    const npub = url.replace(/naddr1[^?]+/, 'npub1' + 'q'.repeat(58))
    expect(decodeInvite(npub)).toBeNull()
  })

  it('base64url survives bytes that need padding and url-unsafe characters', () => {
    for (const len of [1, 2, 3, 31, 32, 33]) {
      const bytes = crypto.getRandomValues(new Uint8Array(len))
      const s = bytesToBase64Url(bytes)
      expect(s).not.toMatch(/[+/=]/)
      expect(Array.from(base64UrlToBytes(s))).toEqual(Array.from(bytes))
    }
  })
})

describe('encryption with the game key', () => {
  const key = randomGameKey()

  it('round trips text, json and bytes', () => {
    expect(decryptText(key, encryptText(key, 'hello mice'))).toBe('hello mice')
    const obj = { name: 'Brambleburrow', gm, relays: ['wss://x'], snapshot: { url: 'https://a/b', sha256: 'ff', at: 1 } }
    expect(decryptJson(key, encryptJson(key, obj))).toEqual(obj)
    const bytes = crypto.getRandomValues(new Uint8Array(5000))
    expect(Array.from(decryptBytes(key, encryptBytes(key, bytes)))).toEqual(Array.from(bytes))
  })

  it('fails with the wrong key and rejects non-32-byte keys', () => {
    const payload = encryptText(key, 'secret')
    expect(() => decryptText(randomGameKey(), payload)).toThrow()
    expect(() => encryptText(new Uint8Array(16), 'x')).toThrow(/32 bytes/)
  })

  it('a full-size chunk fits NIP-44 and stays under 64 KB on the wire', () => {
    const chunk = crypto.getRandomValues(new Uint8Array(CHUNK_BYTES))
    const payload = encryptBytes(key, chunk)
    expect(payload.length).toBeLessThan(64 * 1024)
    expect(Array.from(decryptBytes(key, payload))).toEqual(Array.from(chunk))
  })

  it('hashes with sha256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('chunking', () => {
  it('splits only when over the chunk size and concatenates back', () => {
    const small = new Uint8Array(100)
    expect(splitUpdate(small)).toHaveLength(1)
    const big = crypto.getRandomValues(new Uint8Array(CHUNK_BYTES * 2 + 17))
    const parts = splitUpdate(big)
    expect(parts).toHaveLength(3)
    expect(parts[2]).toHaveLength(17)
    expect(Array.from(concatBytes(parts))).toEqual(Array.from(big))
  })

  it('reassembles chunks arriving out of order and ignores repeats', () => {
    const big = crypto.getRandomValues(new Uint8Array(1000))
    const parts = splitUpdate(big, 300)
    const r = new Reassembler()
    expect(r.push('b1', 2, 4, parts[2])).toBeNull()
    expect(r.push('b1', 0, 4, parts[0])).toBeNull()
    expect(r.push('b1', 0, 4, parts[0])).toBeNull()
    expect(r.push('b1', 3, 4, parts[3])).toBeNull()
    expect(r.pending).toBe(1)
    const whole = r.push('b1', 1, 4, parts[1])
    expect(whole && Array.from(whole)).toEqual(Array.from(big))
    expect(r.pending).toBe(0)
  })

  it('keeps batches apart and evicts stale incomplete ones', () => {
    let t = 0
    const r = new Reassembler(1000, () => t)
    expect(r.push('a', 0, 2, new Uint8Array([1]))).toBeNull()
    expect(r.push('b', 0, 2, new Uint8Array([3]))).toBeNull()
    expect(Array.from(r.push('b', 1, 2, new Uint8Array([4]))!)).toEqual([3, 4])
    t = 5000
    expect(r.push('c', 0, 2, new Uint8Array([9]))).toBeNull()
    expect(r.pending).toBe(1) // 'a' was evicted
    expect(r.push('a', 1, 2, new Uint8Array([2]))).toBeNull()
  })

  it('parses chunk tags', () => {
    expect(parseChunkTag(undefined)).toEqual({ index: 0, total: 1 })
    expect(parseChunkTag('2/5')).toEqual({ index: 2, total: 5 })
    expect(() => parseChunkTag('5/5')).toThrow()
    expect(() => parseChunkTag('x')).toThrow()
  })
})

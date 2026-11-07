import { describe, expect, it } from 'vitest'
import { decryptBlob, encryptBlob, newBlobKey } from './blobCrypto'

const enc = (s: string) => new TextEncoder().encode(s)

describe('blob encryption', () => {
  it('round-trips bytes under a fresh 256-bit key', async () => {
    const plain = enc('a dungeon map')
    const { ciphertext, key } = await encryptBlob(plain)
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(ciphertext.length).toBe(plain.length + 16) // GCM tag
    expect(new TextDecoder().decode(ciphertext)).not.toContain('dungeon')
    expect(await decryptBlob(ciphertext, key)).toEqual(plain)
  })

  it('round-trips empty and large inputs', async () => {
    const big = new Uint8Array(256 * 1024).map((_, i) => i & 0xff)
    for (const plain of [new Uint8Array(0), big]) {
      const { ciphertext, key } = await encryptBlob(plain)
      expect(await decryptBlob(ciphertext, key)).toEqual(plain)
    }
  })

  it('gives a new key, and so new ciphertext, on every call', async () => {
    const a = await encryptBlob(enc('same'))
    const b = await encryptBlob(enc('same'))
    expect(a.key).not.toBe(b.key)
    expect(a.ciphertext).not.toEqual(b.ciphertext)
  })

  it('is deterministic for one key, so an upload can be redone from the plaintext', async () => {
    const key = newBlobKey()
    const a = await encryptBlob(enc('same'), key)
    const b = await encryptBlob(enc('same'), key)
    expect(a.ciphertext).toEqual(b.ciphertext)
  })

  it('refuses a wrong key, tampered bytes and malformed keys', async () => {
    const { ciphertext, key } = await encryptBlob(enc('secret'))
    await expect(decryptBlob(ciphertext, newBlobKey())).rejects.toThrow(/does not decrypt/)
    const bad = ciphertext.slice()
    bad[0] ^= 1
    await expect(decryptBlob(bad, key)).rejects.toThrow(/does not decrypt/)
    await expect(decryptBlob(ciphertext, 'c2hvcnQ')).rejects.toThrow(/32 bytes/)
    await expect(decryptBlob(ciphertext, '!!')).rejects.toThrow(/base64url/)
  })
})

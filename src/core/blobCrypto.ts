/**
 * Blob encryption for anything put on a public Blossom server: shared assets and doc snapshots.
 *
 * AES-256-GCM via WebCrypto. Every blob gets its own random 256-bit key, and a key only ever
 * encrypts one plaintext, so a fixed all-zero 96-bit IV is safe. This also makes encryption
 * deterministic per key: re-encrypting the same file with the same key gives the same ciphertext
 * and hash, so an upload interrupted by a reload can be redone from the plaintext cache and the key
 * on the ref.
 *
 * Wire format: the raw GCM output (ciphertext followed by the 16-byte tag). Keys are base64url
 * without padding.
 */

const IV = new Uint8Array(12)

function toB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function importKey(key: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = fromB64url(key)
  } catch {
    throw new Error('blob key is not base64url')
  }
  if (raw.length !== 32) throw new Error('blob key must be 32 bytes')
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage])
}

function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.byteLength)
  out.set(bytes)
  return out
}

/** A fresh random key, base64url. */
export function newBlobKey(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(32)))
}

/** Encrypts with `key` (a fresh one when omitted). */
export async function encryptBlob(plain: Uint8Array, key: string = newBlobKey()): Promise<{ ciphertext: Uint8Array<ArrayBuffer>; key: string }> {
  const k = await importKey(key, 'encrypt')
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: IV }, k, copy(plain))
  return { ciphertext: new Uint8Array(ct), key }
}

/** Decrypts and authenticates; throws on a wrong key or tampered bytes. */
export async function decryptBlob(ciphertext: Uint8Array, key: string): Promise<Uint8Array<ArrayBuffer>> {
  const k = await importKey(key, 'decrypt')
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: IV }, k, copy(ciphertext)))
  } catch {
    throw new Error('blob does not decrypt with this key (wrong key or corrupted bytes)')
  }
}

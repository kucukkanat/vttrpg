import type { AssetHash } from './ids'

export type AssetKind = 'glb' | 'image' | 'audio' | 'json' | 'other'

/**
 * How a shared asset is stored on Blossom: the AES-256-GCM ciphertext of the file, under a key used
 * for this file only (see `blobCrypto.ts`).
 *
 * `sha256` is the hash of the **ciphertext**, the bytes Blossom stores and serves at
 * `<server>/<sha256>`. `key` is the base64url AES key.
 *
 * Why the key lives on the ref and not in a separate doc map: a ref is copied wherever an asset is
 * used (props, tokens, scenes, journal pages, sounds, game exports, pasted objects). Carrying the
 * key with it keeps every copy self-sufficient. No second lookup can arrive out of order over sync,
 * there is no map to garbage-collect, and the resolver stays independent of the game doc. Refs only
 * ever live inside the game document, which is encrypted under the game key, so the key is never
 * public.
 */
export interface AssetCipher {
  sha256: AssetHash
  key: string
}

/**
 * Content-addressed reference to a blob. `sources` are URLs where the bytes may be fetched
 * (Blossom servers, pasted URLs, the Pages starter library).
 *
 * The hash contract:
 * - `sha256` is always the hash of the **plaintext** file. It is the identity used for dedupe, the
 *   local IndexedDB cache key, and the final check on whatever the resolver produces.
 * - Without `enc` (the built-in library, packs, older games), `sources` serve the plaintext and the
 *   Blossom fallbacks are tried at `<server>/<sha256>`.
 * - With `enc`, `sources` serve the ciphertext and the Blossom fallbacks are tried at
 *   `<server>/<enc.sha256>`. The resolver checks the ciphertext hash, decrypts with `enc.key`, then
 *   checks the plaintext against `sha256`.
 */
export interface AssetRef {
  sha256: AssetHash
  kind: AssetKind
  mime: string
  size: number
  name?: string
  sources: string[]
  /** Present on encrypted (shared) uploads; absent on public and legacy refs. */
  enc?: AssetCipher
}

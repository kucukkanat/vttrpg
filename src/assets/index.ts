/**
 * Asset resolver: content-addressed fetch with verification and an IndexedDB cache.
 * Sources tried in order: memory, IndexedDB cache, Pages starter library, ref.sources (URLs), Blossom defaults.
 */
import type { AssetRef } from '@/core/assets'

export interface AssetResolver {
  /** Returns an object URL for the verified bytes. Cached across calls. */
  resolve(ref: AssetRef): Promise<string>
  /** Verify + cache local bytes and build a ref. Does not upload: use `shareFile` for anything other devices need. */
  importFile(file: File): Promise<AssetRef>
  /**
   * The upload path for every file a game uses. Stores the file locally, encrypts it under a fresh
   * per-asset key and returns a ref carrying the key (`enc`) and its Blossom URLs at once; the
   * upload runs in the background with retries, reported through `useAssetStatus`. Without an
   * uploader configured this is `importFile`.
   */
  shareFile(file: File): Promise<AssetRef>
  /** Uploads an encrypted ref's ciphertext again, re-derived from the local plaintext (e.g. after a reload). */
  reshare(ref: AssetRef): Promise<void>
  /** Resolves when the running upload of `ref` lands; rejects if it fails or none is known. */
  whenShared(ref: AssetRef): Promise<void>
  /** Upload to a Blossom server, append the resulting URL to ref.sources. Encrypted refs upload their ciphertext. */
  uploadToBlossom(ref: AssetRef, server: string, signer: (event: unknown) => Promise<unknown>): Promise<AssetRef>
  /** Add a user-pasted URL as a source after verifying its hash matches. */
  addUrlSource(ref: AssetRef, url: string): Promise<AssetRef>
  /** Drops one reference to the object URL; it is revoked when the last holder releases. */
  release(ref: AssetRef): void
  /** Size of the IndexedDB cache. */
  stats(): Promise<{ count: number; bytes: number }>
  /** Delete least-recently-used cached blobs until the cache is at most maxBytes. */
  evict(maxBytes: number): Promise<{ evicted: number; freedBytes: number }>
}

export { createAssetResolver, DEFAULT_BLOSSOM_SERVERS } from './impl'
export type { ResolverOptions, LibraryEntry } from './impl'
export { putBlob, putBlobWithRetry, UPLOAD_RETRY_DELAYS_MS, type BlossomSigner } from './blossom'
export { useAssetStatus, getAssetStatus, retryAsset, canRetryAsset, subscribeAssetStatus, type AssetStatus, type AssetStatusInfo } from './status'
export { readUnshared, reshareCandidates, trackUnshared } from './unshared'

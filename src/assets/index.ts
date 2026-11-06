/**
 * Asset resolver: content-addressed fetch with verification and an IndexedDB cache.
 * Sources tried in order: memory, IndexedDB cache, Pages starter library, ref.sources (URLs), Blossom defaults.
 */
import type { AssetRef } from '@/core/assets'

export interface AssetResolver {
  /** Returns an object URL for the verified bytes. Cached across calls. */
  resolve(ref: AssetRef): Promise<string>
  /** Verify + cache local bytes and build a ref. Does not upload. */
  importFile(file: File): Promise<AssetRef>
  /** Upload to a Blossom server, append the resulting URL to ref.sources. */
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

/**
 * Asset resolver: content-addressed fetch with verification and an IndexedDB cache.
 * Sources tried in order: local cache, Pages starter library, ref.sources (URLs, Blossom).
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
  release(ref: AssetRef): void
}

export { createAssetResolver, DEFAULT_BLOSSOM_SERVERS } from './impl'

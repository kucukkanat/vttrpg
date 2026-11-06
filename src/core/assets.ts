import type { AssetHash } from './ids'

export type AssetKind = 'glb' | 'image' | 'audio' | 'json' | 'other'

/**
 * Content-addressed reference to a blob. `sources` are URLs where the same bytes
 * may be fetched (Blossom servers, pasted URLs, the Pages starter library).
 * The resolver verifies the sha256 of whatever it downloads.
 */
export interface AssetRef {
  sha256: AssetHash
  kind: AssetKind
  mime: string
  size: number
  name?: string
  sources: string[]
}

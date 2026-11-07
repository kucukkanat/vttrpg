/**
 * Upload status of shared assets in this session, keyed by the plaintext sha256.
 *
 *   local      the bytes are on this device only (no uploader configured, or not queued yet)
 *   uploading  the encrypted bytes are being sent to Blossom (retries included)
 *   shared     at least one Blossom server holds the ciphertext; other devices can load it
 *   failed     every retry failed; `retryAsset(sha256)` tries again
 *
 * An asset this session never touched has no status (`undefined`): a built-in, a pack asset, or an
 * upload from an earlier session.
 */
import { useSyncExternalStore } from 'react'

export type AssetStatus = 'local' | 'uploading' | 'shared' | 'failed'

export interface AssetStatusInfo {
  status: AssetStatus
  /** Last upload error, while uploading again or after giving up. */
  error?: string
  /** Attempts made so far in the current run. */
  attempts?: number
}

const entries = new Map<string, AssetStatusInfo>()
const retries = new Map<string, () => void>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function setAssetStatus(sha256: string, info: AssetStatusInfo): void {
  entries.set(sha256, info)
  emit()
}

export function getAssetStatus(sha256: string): AssetStatusInfo | undefined {
  return entries.get(sha256)
}

/** The resolver registers how to retry an upload; `retryAsset` calls it. */
export function setAssetRetry(sha256: string, retry: (() => void) | undefined): void {
  if (retry) retries.set(sha256, retry)
  else retries.delete(sha256)
}

/** Starts the upload of a failed (or stuck) asset again. False when there is nothing to retry. */
export function retryAsset(sha256: string): boolean {
  const r = retries.get(sha256)
  if (!r) return false
  r()
  return true
}

export function canRetryAsset(sha256: string): boolean {
  return retries.has(sha256)
}

export function subscribeAssetStatus(cb: () => void): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

/** Every asset this session has a status for. */
export function allAssetStatus(): IterableIterator<[string, AssetStatusInfo]> {
  return entries.entries()
}

/** Test helper: forget everything. */
export function resetAssetStatus(): void {
  entries.clear()
  retries.clear()
  emit()
}

/** The status of one asset, re-rendering when it changes. */
export function useAssetStatus(sha256: string | null | undefined): AssetStatusInfo | undefined {
  return useSyncExternalStore(
    subscribeAssetStatus,
    () => (sha256 ? entries.get(sha256) : undefined),
    () => undefined,
  )
}

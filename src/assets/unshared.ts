/**
 * Uploads that have not reached Blossom yet, remembered across reloads. The status store
 * (status.ts) only knows this session; a GM who closed the tab mid-upload, or whose upload failed,
 * would otherwise leave players with a model they can never load. `trackUnshared` keeps the hashes
 * of uploads that are local, uploading or failed in localStorage and forgets them once shared; on
 * the next start `reshareCandidates` picks the game's refs that still need sending and the GM's
 * client calls `reshare` for each.
 */
import type { AssetRef } from '@/core/assets'
import { allAssetStatus, subscribeAssetStatus, type AssetStatus } from './status'

export const UNSHARED_KEY = 'vtt.assets.unshared'
/** Kept at most; the oldest fall off (a model this old and still unshared is long gone locally). */
const MAX_REMEMBERED = 500

type Store = Pick<Storage, 'getItem' | 'setItem'>

function storage(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function readUnshared(store: Store | null = storage()): Set<string> {
  try {
    const raw: unknown = JSON.parse(store?.getItem(UNSHARED_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128) : [])
  } catch {
    return new Set()
  }
}

/** The remembered set after this session's statuses: unfinished uploads added, shared ones dropped. */
export function nextUnshared(prev: ReadonlySet<string>, statuses: Iterable<[string, AssetStatus]>): Set<string> {
  const out = new Set(prev)
  for (const [sha, status] of statuses) {
    if (status === 'shared') out.delete(sha)
    else out.add(sha)
  }
  return new Set([...out].slice(-MAX_REMEMBERED))
}

/** Follows the status store into localStorage until the returned function is called. */
export function trackUnshared(store: Store | null = storage()): () => void {
  if (!store) return () => {}
  let last = ''
  const save = () => {
    const next = [...nextUnshared(readUnshared(store), [...allAssetStatus()].map(([sha, info]) => [sha, info.status] as [string, AssetStatus]))]
    const text = JSON.stringify(next)
    if (text === last) return
    last = text
    try { store.setItem(UNSHARED_KEY, text) } catch { /* quota, private mode */ }
  }
  return subscribeAssetStatus(save)
}

/**
 * The refs to upload again: encrypted ones (only those can be re-derived from the local copy)
 * whose upload is remembered as unfinished or whose status this session is local or failed. One
 * per asset hash; an upload already running is left alone.
 */
export function reshareCandidates(refs: Iterable<AssetRef | null | undefined>, unfinished: ReadonlySet<string>, statusOf: (sha256: string) => AssetStatus | undefined): AssetRef[] {
  const out = new Map<string, AssetRef>()
  for (const ref of refs) {
    if (!ref?.enc || out.has(ref.sha256)) continue
    const status = statusOf(ref.sha256)
    if (status === 'uploading' || status === 'shared') continue
    if (status === 'local' || status === 'failed' || unfinished.has(ref.sha256)) out.set(ref.sha256, ref)
  }
  return [...out.values()]
}

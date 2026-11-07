/**
 * GM-side snapshot loop: periodically uploads the whole Yjs state and points the
 * manifest at it so late joiners skip the delta replay, and prunes stale
 * transient events. Uploading is injected so net stays independent of assets.
 *
 * Each snapshot is encrypted under a fresh key before it leaves the device (`core/blobCrypto.ts`);
 * the key rides in the manifest pointer, which is itself encrypted under the game key. Joiners
 * check the ciphertext hash, then decrypt.
 */
import type { Intent } from '@/core/intents'
import { encryptBlob } from '@/core/blobCrypto'
import type { GameConnection } from './index'
import { REMOTE_ORIGIN } from './connection'

export interface SnapshotLoopOptions {
  /** Store the (already encrypted) bytes somewhere public (Blossom) and return where and their sha256. */
  upload(bytes: Uint8Array): Promise<{ url: string; sha256: string }>
  /** Applies a GM intent locally (the controller's dispatch). Receives `event.prune`. */
  prune?(intent: Intent): void | Promise<void>
  /** Tick period; a snapshot is taken on a tick only when the doc changed. */
  intervalMs?: number
  /** Snapshot immediately once this many local updates piled up since the last one. */
  maxDeltas?: number
  /** Events older than this are pruned on every tick. */
  pruneAfterMs?: number
  now?: () => number
  log?: (...args: unknown[]) => void
}

export const SNAPSHOT_INTERVAL_MS = 2 * 60_000
export const SNAPSHOT_MAX_DELTAS = 200
export const EVENT_PRUNE_AFTER_MS = 2 * 60_000

export interface SnapshotLoop {
  stop(): void
  /** Take a snapshot now if there is anything new (or `force`). Resolves when done or failed. */
  flush(force?: boolean): Promise<boolean>
  readonly pendingDeltas: number
  readonly dirty: boolean
}

/**
 * Starts the loop on a GM connection. Returns a stop function. Failures log and
 * retry on the next tick; nothing here throws.
 */
export function startSnapshotLoop(connection: GameConnection, opts: SnapshotLoopOptions): () => void {
  return createSnapshotLoop(connection, opts).stop
}

export function createSnapshotLoop(connection: GameConnection, opts: SnapshotLoopOptions): SnapshotLoop {
  const intervalMs = opts.intervalMs ?? SNAPSHOT_INTERVAL_MS
  const maxDeltas = opts.maxDeltas ?? SNAPSHOT_MAX_DELTAS
  const pruneAfterMs = opts.pruneAfterMs ?? EVENT_PRUNE_AFTER_MS
  const now = opts.now ?? Date.now
  const log = opts.log ?? ((...a: unknown[]) => console.log(...a))

  let dirty = false
  let deltas = 0
  let busy: Promise<boolean> | null = null
  let stopped = false

  if (!connection.isGm) {
    log('net: snapshot loop not started, this client is not the GM')
    return { stop() {}, flush: async () => false, pendingDeltas: 0, dirty: false }
  }

  async function snapshotNow(): Promise<boolean> {
    // Reset first so changes that land while uploading schedule another round.
    dirty = false
    deltas = 0
    try {
      const bytes = connection.snapshot()
      const { ciphertext, key } = await encryptBlob(bytes)
      const { url, sha256 } = await opts.upload(ciphertext)
      if (stopped) return false
      await connection.publishSnapshotPointer(url, sha256, key)
      log('net: snapshot published', bytes.length, 'bytes ->', url)
      return true
    } catch (e) {
      dirty = true
      log('net: snapshot failed, retrying next tick', e)
      return false
    }
  }

  function flush(force = false): Promise<boolean> {
    if (stopped) return Promise.resolve(false)
    if (busy) return busy
    if (!force && !dirty) return Promise.resolve(false)
    busy = snapshotNow().finally(() => {
      busy = null
    })
    return busy
  }

  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (stopped || origin === REMOTE_ORIGIN) return
    dirty = true
    deltas++
    if (deltas >= maxDeltas && !busy) void flush()
  }
  connection.doc.on('update', onUpdate)

  const tick = () => {
    if (stopped) return
    if (opts.prune) {
      try {
        const r = opts.prune({ type: 'event.prune', before: now() - pruneAfterMs })
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch((e) => log('net: event prune failed', e))
      } catch (e) {
        log('net: event prune failed', e)
      }
    }
    void flush()
  }
  const timer = setInterval(tick, intervalMs)

  return {
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      connection.doc.off('update', onUpdate)
    },
    flush,
    get pendingDeltas() {
      return deltas
    },
    get dirty() {
      return dirty
    },
  }
}

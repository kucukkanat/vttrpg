/**
 * Pure encoding helpers for the sync layer: event kinds and tags, NIP-44
 * encryption under the symmetric game key, Yjs update chunking, and the
 * invite link format. Everything here is side-effect free and unit tested.
 */
import { nip19, nip44 } from 'nostr-tools'
import type { GameId, PlayerPubkey } from '@/core/ids'
import type { InviteInfo } from './index'

/** Parameterized replaceable manifest: `d` = gameId, author = GM. */
export const KIND_MANIFEST = 30078
/** Regular event carrying one (chunk of one) encrypted Yjs update. GM only. */
export const KIND_DELTA = 1078
/** Ephemeral intent from a player to the GM. */
export const KIND_INTENT = 21078
/** Ephemeral presence (cursor, drag, roll commit). */
export const KIND_PRESENCE = 21079
/** `t` tag on manifests so relays can be searched for games. */
export const APP_TAG = 'vttrpg'

/**
 * Raw bytes per delta chunk. 30 KiB of update bytes becomes 40 960 base64
 * characters of plaintext, which NIP-44 pads to 40 960 and wraps into a
 * ~54 KB base64 payload: comfortably under the 64 KB message limit most
 * public relays enforce and under NIP-44's own 65 535-byte plaintext cap.
 */
export const CHUNK_BYTES = 30 * 1024

export interface SnapshotPointer {
  url: string
  /** Hash of the bytes at `url`: the ciphertext when `key` is set, else the raw Yjs update. */
  sha256: string
  /**
   * AES-256-GCM key the snapshot is encrypted under (see `core/blobCrypto.ts`), fresh per snapshot.
   * Safe here because the manifest itself is encrypted under the game key. Absent on snapshots
   * from older builds, which were uploaded unencrypted and are still read.
   */
  key?: string
  /** Unix seconds; deltas at or after this are replayed on top. */
  at: number
}

/** A co-GM the founder granted write access; `until` set once revoked (unix seconds). */
export interface CoGmGrant {
  pubkey: PlayerPubkey
  since: number
  until?: number
}

export interface Manifest {
  name: string
  /** The founder: author of the manifest and root of trust. Never changes for a game. */
  gm: PlayerPubkey
  relays: string[]
  snapshot?: SnapshotPointer
  /** Co-GMs who may also write deltas (see `authority.ts`). */
  coGms?: CoGmGrant[]
  /** Writer that processes player intents first; the founder when absent. */
  host?: PlayerPubkey
  /** Unix seconds the founder last published this manifest; newer wins between relays and the local copy. */
  updatedAt?: number
}

// --- bytes -----------------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  return base64ToBytes(b64 + pad)
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2) throw new Error('odd hex length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function randomGameKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(bytes.byteLength)
  buf.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return bytesToHex(new Uint8Array(digest))
}

// --- encryption --------------------------------------------------------------

function assertKey(key: Uint8Array) {
  if (key.length !== 32) throw new Error(`game key must be 32 bytes, got ${key.length}`)
}

/** NIP-44 v2 with the game key used directly as the conversation key. */
export function encryptText(key: Uint8Array, plaintext: string): string {
  assertKey(key)
  return nip44.v2.encrypt(plaintext, key)
}

export function decryptText(key: Uint8Array, payload: string): string {
  assertKey(key)
  return nip44.v2.decrypt(payload, key)
}

export function encryptJson(key: Uint8Array, value: unknown): string {
  return encryptText(key, JSON.stringify(value))
}

export function decryptJson<T>(key: Uint8Array, payload: string): T {
  return JSON.parse(decryptText(key, payload)) as T
}

export function encryptBytes(key: Uint8Array, bytes: Uint8Array): string {
  return encryptText(key, bytesToBase64(bytes))
}

export function decryptBytes(key: Uint8Array, payload: string): Uint8Array {
  return base64ToBytes(decryptText(key, payload))
}

// --- coordinates and tags ----------------------------------------------------

export function coordinate(gm: PlayerPubkey, gameId: GameId): string {
  return `${KIND_MANIFEST}:${gm}:${gameId}`
}

export function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1]
}

/** Parses a `chunk` tag value `i/n`; absent means a single whole update. */
export function parseChunkTag(v: string | undefined): { index: number; total: number } {
  if (!v) return { index: 0, total: 1 }
  const m = /^(\d+)\/(\d+)$/.exec(v)
  if (!m) throw new Error(`bad chunk tag: ${v}`)
  const index = Number(m[1])
  const total = Number(m[2])
  if (total < 1 || index < 0 || index >= total) throw new Error(`bad chunk tag: ${v}`)
  return { index, total }
}

// --- chunking ------------------------------------------------------------------

export function splitUpdate(update: Uint8Array, chunkBytes = CHUNK_BYTES): Uint8Array[] {
  if (update.length <= chunkBytes) return [update]
  const parts: Uint8Array[] = []
  for (let i = 0; i < update.length; i += chunkBytes) parts.push(update.subarray(i, i + chunkBytes))
  return parts
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

interface PendingBatch {
  total: number
  parts: (Uint8Array | undefined)[]
  received: number
  touched: number
}

/**
 * Collects chunks of multi-event updates keyed by batch id and returns the
 * whole update once every part is present. Stale, incomplete batches are
 * dropped after `ttlMs` so a lost chunk does not leak memory forever.
 */
export class Reassembler {
  private batches = new Map<string, PendingBatch>()
  constructor(private readonly ttlMs = 5 * 60_000, private readonly now: () => number = Date.now) {}

  push(batchId: string, index: number, total: number, bytes: Uint8Array): Uint8Array | null {
    if (total === 1) return bytes
    this.evict()
    let b = this.batches.get(batchId)
    if (!b || b.total !== total) {
      b = { total, parts: new Array<Uint8Array | undefined>(total), received: 0, touched: this.now() }
      this.batches.set(batchId, b)
    }
    if (index < 0 || index >= total) return null
    if (!b.parts[index]) {
      b.parts[index] = bytes
      b.received++
    }
    b.touched = this.now()
    if (b.received < total) return null
    this.batches.delete(batchId)
    return concatBytes(b.parts as Uint8Array[])
  }

  get pending(): number {
    return this.batches.size
  }

  private evict() {
    const cutoff = this.now() - this.ttlMs
    for (const [id, b] of this.batches) if (b.touched < cutoff) this.batches.delete(id)
  }
}

// --- invites ---------------------------------------------------------------------

export interface InviteBase {
  /** e.g. `https://user.github.io` */
  origin: string
  /** e.g. `/vttrpg/`; always ends with `/`. */
  base: string
}

export function encodeInvite(info: InviteInfo, where: InviteBase): string {
  if (info.gameKey.length !== 32) throw new Error('game key must be 32 bytes')
  const naddr = nip19.naddrEncode({
    kind: KIND_MANIFEST,
    pubkey: info.gm,
    identifier: info.gameId,
    relays: info.relays,
  })
  const base = where.base.endsWith('/') ? where.base : where.base + '/'
  return `${where.origin}${base}#/join/${naddr}?k=${bytesToBase64Url(info.gameKey)}`
}

/**
 * Accepts a full URL, just the fragment (`#/join/...` or `/join/...`), or a bare
 * `naddr1...?k=...`. Returns null for anything that does not decode to a
 * manifest pointer plus a 32-byte key.
 */
export function decodeInvite(url: string): InviteInfo | null {
  try {
    let s = url.trim()
    const hash = s.indexOf('#')
    if (hash >= 0) s = s.slice(hash + 1)
    if (s.startsWith('/')) s = s.slice(1)
    if (s.startsWith('join/')) s = s.slice('join/'.length)
    const q = s.indexOf('?')
    if (q < 0) return null
    const naddr = s.slice(0, q)
    const params = new URLSearchParams(s.slice(q + 1))
    const k = params.get('k')
    if (!k) return null
    const decoded = nip19.decode(naddr)
    if (decoded.type !== 'naddr') return null
    const ptr = decoded.data
    if (ptr.kind !== KIND_MANIFEST || !ptr.identifier || !ptr.pubkey) return null
    const gameKey = base64UrlToBytes(k)
    if (gameKey.length !== 32) return null
    return {
      gameId: ptr.identifier as GameId,
      gm: ptr.pubkey as PlayerPubkey,
      relays: ptr.relays ?? [],
      gameKey,
    }
  } catch {
    return null
  }
}

/** Where the app is being served from, for invite links. */
export function currentBase(): InviteBase {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : ''
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return { origin, base }
}

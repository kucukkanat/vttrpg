/**
 * Game export and import as one JSON file, so a game is never locked into this browser or these
 * relays. The file holds the whole document as plain JSON (readable without this app) and the
 * bytes of every referenced asset this device can get (maps, models, portraits, sounds), each
 * checked against its sha256 on import. Importing creates a new game with this identity as GM:
 * a new game key and invite, the same content. The transient event log is not exported.
 *
 *   { "format": "vttrpg-game", "version": 1, "exportedAt": ms, "doc": GameDocShape,
 *     "assets": { "<sha256>": { "mime", "name"?, "data": base64 } }, "missingAssets": [sha256] }
 */
import * as Y from 'yjs'
import type { AssetRef } from '@/core/assets'
import { DOC_KEYS, type GameDocShape, type GameMeta } from '@/core/doc'
import { readAllTiles, writeTilesJson } from '@/state/tilesDoc'
import type { AssetResolver } from '@/assets'

export const GAME_FILE_FORMAT = 'vttrpg-game'
export const GAME_FILE_VERSION = 1
/** Assets above this total are left out of the file (their refs and sources stay in the doc). */
export const MAX_EMBEDDED_BYTES = 80 * 1024 * 1024
/** Files larger than this are refused before parsing. */
export const MAX_GAME_FILE_BYTES = 150 * 1024 * 1024

export class GameFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GameFileError'
  }
}

export interface EmbeddedAsset { mime: string; name?: string; data: string }

export interface GameFile {
  format: typeof GAME_FILE_FORMAT
  version: number
  exportedAt: number
  doc: Omit<GameDocShape, 'events'>
  assets: Record<string, EmbeddedAsset>
  missingAssets: string[]
}

const HEX64 = /^[0-9a-f]{64}$/
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Every asset ref anywhere in the document (built-ins and the zero hash excluded), deduplicated by hash. */
export function collectAssetRefs(value: unknown): AssetRef[] {
  const out = new Map<string, AssetRef>()
  const walk = (v: unknown, depth: number) => {
    if (depth > 40 || v === null || typeof v !== 'object') return
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
    const r = v as Record<string, unknown>
    if (typeof r.sha256 === 'string' && HEX64.test(r.sha256) && Array.isArray(r.sources) && !/^0+$/.test(r.sha256)) {
      const ref = r as unknown as AssetRef
      if (!ref.sources.some((s) => typeof s === 'string' && s.startsWith('builtin:'))) out.set(ref.sha256, ref)
    }
    for (const x of Object.values(r)) walk(x, depth + 1)
  }
  walk(value, 0)
  return [...out.values()]
}

/**
 * A copy of `value` where every asset ref whose plaintext hash is in `shared` takes that ref's
 * `sources` and `enc` (the re-shared, encrypted copy). Everything else is left as is.
 */
export function withSharedRefs<T>(value: T, shared: ReadonlyMap<string, AssetRef>): T {
  if (!shared.size) return value
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 40 || v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))
    const r = v as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(r)) out[k] = walk(x, depth + 1)
    const next = typeof r.sha256 === 'string' && Array.isArray(r.sources) ? shared.get(r.sha256) : undefined
    if (next) {
      out.sources = [...next.sources]
      if (next.enc) out.enc = { ...next.enc }
    }
    return out
  }
  return walk(value, 0) as T
}

/** Plain JSON of the doc, every key from `DOC_KEYS` except the event log. */
export function docToJson(doc: Y.Doc): Omit<GameDocShape, 'events'> {
  const out: Record<string, unknown> = {}
  for (const key of DOC_KEYS) {
    if (key === 'events') continue
    out[key] = key === 'chat' ? doc.getArray(key).toJSON() : key === 'tiles' ? readAllTiles(doc) : doc.getMap(key).toJSON()
  }
  if (!isRec(out.initiative) || !Array.isArray((out.initiative as { order?: unknown }).order)) delete out.initiative
  return out as unknown as Omit<GameDocShape, 'events'>
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(bytes.byteLength)
  buf.set(bytes)
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Builds the export. `fetchBytes` gets an asset's verified bytes (the resolver plus a fetch of its
 * object URL in the app); assets it cannot get, or past the size budget, are listed as missing.
 */
export async function buildGameFile(doc: Y.Doc, fetchBytes: (ref: AssetRef) => Promise<Uint8Array>, opts: { now?: number; maxBytes?: number } = {}): Promise<GameFile> {
  const json = docToJson(doc)
  const assets: Record<string, EmbeddedAsset> = {}
  const missing: string[] = []
  let total = 0
  for (const ref of collectAssetRefs(json)) {
    try {
      if (total + (ref.size || 0) > (opts.maxBytes ?? MAX_EMBEDDED_BYTES)) throw new Error('over budget')
      const bytes = await fetchBytes(ref)
      if ((await sha256Hex(bytes)) !== ref.sha256) throw new Error('hash mismatch')
      total += bytes.length
      assets[ref.sha256] = { mime: ref.mime, ...(ref.name ? { name: ref.name } : {}), data: bytesToBase64(bytes) }
    } catch {
      missing.push(ref.sha256)
    }
  }
  return { format: GAME_FILE_FORMAT, version: GAME_FILE_VERSION, exportedAt: opts.now ?? Date.now(), doc: json, assets, missingAssets: missing }
}

export function gameFileName(name: string, at = Date.now()): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game'
  return `${slug}-${new Date(at).toISOString().slice(0, 10)}.vttgame.json`
}

/** Parses and validates a game file; every problem is reported as one plain sentence. */
export function parseGameFile(text: string): GameFile {
  if (text.length > MAX_GAME_FILE_BYTES) throw new GameFileError('The file is too large to be a game export.')
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    throw new GameFileError('This file is not a game export (it is not JSON).')
  }
  if (!isRec(v) || v.format !== GAME_FILE_FORMAT) throw new GameFileError('This file is not a game export from this app.')
  if (typeof v.version !== 'number' || v.version > GAME_FILE_VERSION) throw new GameFileError('This game file comes from a newer version of the app; update and try again.')
  const doc = v.doc
  if (!isRec(doc) || !isRec(doc.meta)) throw new GameFileError('The game file has no game in it.')
  const meta = doc.meta
  if (typeof meta.name !== 'string' || typeof meta.pack !== 'string' || !meta.pack) throw new GameFileError('The game file is missing its name or system pack.')
  for (const key of ['scenes', 'tokens', 'characters', 'fog', 'props', 'notes', 'customSkills'] as const) {
    if (doc[key] !== undefined && !isRec(doc[key])) throw new GameFileError(`The game file is damaged: "${key}" is not a list of records.`)
  }
  if (doc.chat !== undefined && !Array.isArray(doc.chat)) throw new GameFileError('The game file is damaged: "chat" is not a list.')
  const assets: Record<string, EmbeddedAsset> = {}
  if (v.assets !== undefined) {
    if (!isRec(v.assets)) throw new GameFileError('The game file is damaged: "assets" is not an object.')
    for (const [hash, a] of Object.entries(v.assets)) {
      if (!HEX64.test(hash) || !isRec(a) || typeof a.data !== 'string' || typeof a.mime !== 'string') throw new GameFileError('The game file is damaged: an embedded asset is malformed.')
      assets[hash] = { mime: a.mime, data: a.data, ...(typeof a.name === 'string' ? { name: a.name } : {}) }
    }
  }
  return {
    format: GAME_FILE_FORMAT,
    version: v.version,
    exportedAt: typeof v.exportedAt === 'number' ? v.exportedAt : 0,
    doc: doc as unknown as GameFile['doc'],
    assets,
    missingAssets: Array.isArray(v.missingAssets) ? v.missingAssets.filter((h): h is string => typeof h === 'string') : [],
  }
}

/** Decodes embedded assets and checks each against its hash; bad ones are skipped and counted. */
export async function decodeAssets(file: GameFile): Promise<{ ok: { sha256: string; bytes: Uint8Array; mime: string; name?: string }[]; bad: number }> {
  const ok: { sha256: string; bytes: Uint8Array; mime: string; name?: string }[] = []
  let bad = 0
  for (const [sha256, a] of Object.entries(file.assets)) {
    try {
      const bytes = base64ToBytes(a.data)
      if ((await sha256Hex(bytes)) !== sha256) throw new Error('mismatch')
      ok.push({ sha256, bytes, mime: a.mime, name: a.name })
    } catch {
      bad++
    }
  }
  return { ok, bad }
}

/**
 * Writes an imported document into a fresh game's doc in one transaction. `meta.gm` and
 * `createdAt` become the new game's; everything else is copied as is.
 */
export function writeImportedDoc(doc: Y.Doc, file: GameFile, gm: GameMeta['gm'], now = Date.now()) {
  const src = file.doc as unknown as Record<string, unknown>
  doc.transact(() => {
    for (const key of DOC_KEYS) {
      if (key === 'events') continue
      const value = src[key]
      if (value === undefined) continue
      if (key === 'chat') {
        const arr = doc.getArray(key)
        if (arr.length) arr.delete(0, arr.length)
        arr.push((value as unknown[]).filter(isRec))
        continue
      }
      if (key === 'tiles') { writeTilesJson(doc, value); continue }
      const map = doc.getMap(key)
      if (!isRec(value)) continue
      for (const [k, v] of Object.entries(value)) map.set(k, v)
    }
    const meta = doc.getMap('meta')
    meta.set('gm', gm)
    meta.set('createdAt', now)
  })
}

/** Export of the live game, with asset bytes from the resolver where it can get them. */
export async function exportGame(doc: Y.Doc, assets: Pick<AssetResolver, 'resolve'>): Promise<{ blob: Blob; name: string; missing: number }> {
  const file = await buildGameFile(doc, async (ref) => {
    const url = await assets.resolve(ref)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  })
  const name = gameFileName(file.doc.meta?.name ?? 'game', file.exportedAt)
  return { blob: new Blob([JSON.stringify(file)], { type: 'application/json' }), name, missing: file.missingAssets.length }
}

/** Saves a blob through a temporary download link. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

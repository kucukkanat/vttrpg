import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRef } from '@/core/assets'
import { decryptBlob } from '@/core/blobCrypto'
import { createAssetResolver, type ResolverOptions } from './impl'
import { sha256Hex } from './hash'
import { getAssetStatus, resetAssetStatus, retryAsset } from './status'
import { putBlobWithRetry } from './blossom'

const enc = (s: string) => new TextEncoder().encode(s)
const LIB = 'https://app.test/library'
const SERVER = 'https://blob.test'
let n = 0
const freshDb = () => `share-${n++}`
const signer = async (e: unknown) => ({ ...(e as object), id: 'i'.repeat(64), pubkey: 'p'.repeat(64), sig: 's'.repeat(128) })

/** A fake Blossom server behind the global fetch: PUT /upload stores, GET /<sha256> serves. */
let stored: Map<string, Uint8Array>
let puts: { url: string; sha: string; type: string; auth: string; body: Uint8Array }[]
let failPuts: number
let gets: string[]

beforeEach(() => {
  stored = new Map()
  puts = []
  failPuts = 0
  gets = []
  resetAssetStatus()
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'PUT') {
      const headers = init.headers as Record<string, string>
      const body = new Uint8Array(await (init.body as Blob).arrayBuffer())
      puts.push({ url, sha: headers['X-SHA-256']!, type: headers['Content-Type']!, auth: headers.Authorization!, body })
      if (failPuts > 0) {
        failPuts--
        return new Response('busy', { status: 503 })
      }
      const sha = await sha256Hex(body)
      const base = url.replace(/\/upload$/, '')
      stored.set(`${base}/${sha}`, body)
      return Response.json({ url: `${base}/${sha}`, sha256: sha, size: body.length })
    }
    gets.push(url)
    const bytes = stored.get(url)
    return bytes ? new Response(bytes as BlobPart) : new Response('nope', { status: 404 })
  })
})
afterEach(() => vi.unstubAllGlobals())

const gm = (o: Partial<ResolverOptions> = {}) =>
  createAssetResolver({ libraryBase: LIB, dbName: freshDb(), blossomServers: [SERVER], uploader: { sign: signer }, retryDelaysMs: [1, 1], ...o })
/** A player on another device: empty cache, no uploader. */
const player = () => createAssetResolver({ libraryBase: LIB, dbName: freshDb(), blossomServers: [SERVER] })

async function text(url: string) {
  return new TextDecoder().decode(await (await fetch(url)).arrayBuffer())
}

describe('shareFile', () => {
  it('encrypts, uploads the ciphertext, and returns a ref a player on another device can open', async () => {
    const r = gm()
    const ref = await r.shareFile(new File([enc('a goblin model')], 'goblin.glb'))
    expect(ref.sha256).toBe(await sha256Hex(enc('a goblin model')))
    expect(ref.enc).toBeDefined()
    expect(ref.sources).toEqual([`${SERVER}/${ref.enc!.sha256}`])
    await r.whenShared(ref)
    expect(getAssetStatus(ref.sha256)?.status).toBe('shared')

    expect(puts).toHaveLength(1)
    const put = puts[0]!
    expect(put.url).toBe(`${SERVER}/upload`)
    expect(put.sha).toBe(ref.enc!.sha256)
    expect(put.type).toBe('application/octet-stream')
    expect(new TextDecoder().decode(put.body)).not.toContain('goblin')
    expect(atob(put.auth.slice(6))).not.toContain('goblin') // the signed auth event is public too
    expect(await sha256Hex(put.body)).toBe(ref.enc!.sha256)
    expect(new TextDecoder().decode(await decryptBlob(put.body, ref.enc!.key))).toBe('a goblin model')

    const p = player()
    const url = await p.resolve(ref)
    vi.unstubAllGlobals() // blob: URLs are served by the real fetch
    expect(await text(url)).toBe('a goblin model')
  })

  it('is local only without an uploader', async () => {
    const r = createAssetResolver({ libraryBase: LIB, dbName: freshDb(), blossomServers: [SERVER] })
    const ref = await r.shareFile(new File([enc('local')], 'l.png'))
    expect(ref.enc).toBeUndefined()
    expect(ref.sources).toEqual([])
    expect(getAssetStatus(ref.sha256)?.status).toBe('local')
    expect(puts).toHaveLength(0)
  })

  it('shares one file once: the same key, ciphertext and upload', async () => {
    const r = gm()
    const a = await r.shareFile(new File([enc('twice')], 't.png'))
    await r.whenShared(a)
    const b = await r.shareFile(new File([enc('twice')], 't-copy.png'))
    expect(b.enc).toEqual(a.enc)
    expect(puts).toHaveLength(1)
  })

  it('retries with backoff, reports failure, and uploads again on retryAsset', async () => {
    const seen: string[] = []
    const r = gm({ retryDelaysMs: [1, 1] })
    failPuts = 99
    const ref = await r.shareFile(new File([enc('flaky')], 'f.ogg'))
    seen.push(getAssetStatus(ref.sha256)!.status)
    await expect(r.whenShared(ref)).rejects.toThrow(/503/)
    expect(puts).toHaveLength(3) // first try + two retries
    expect(getAssetStatus(ref.sha256)).toMatchObject({ status: 'failed', error: expect.stringMatching(/503/) })
    expect(seen).toEqual(['uploading'])

    failPuts = 0
    expect(retryAsset(ref.sha256)).toBe(true)
    expect(getAssetStatus(ref.sha256)?.status).toBe('uploading')
    await r.whenShared(ref)
    expect(getAssetStatus(ref.sha256)?.status).toBe('shared')
    expect(puts.at(-1)!.sha).toBe(ref.enc!.sha256) // same ciphertext, re-derived from the cached plaintext
    expect(retryAsset(ref.sha256)).toBe(false)
  })

  it('falls through to the next server when the first refuses', async () => {
    const r = gm({ uploader: { sign: signer, servers: ['https://down.test', SERVER] } })
    failPuts = 1
    const ref = await r.shareFile(new File([enc('mirror')], 'm.glb'))
    expect(ref.sources).toEqual([`https://down.test/${ref.enc!.sha256}`, `${SERVER}/${ref.enc!.sha256}`])
    await r.whenShared(ref)
    expect(puts.map((p) => p.url)).toEqual(['https://down.test/upload', `${SERVER}/upload`])
    const url = await player().resolve(ref)
    expect(url).toMatch(/^blob:/)
  })

  it('reshare uploads an encrypted ref again from the local copy (e.g. after a reload)', async () => {
    const db = freshDb()
    failPuts = 99
    const first = gm({ dbName: db, retryDelaysMs: [] })
    const ref = await first.shareFile(new File([enc('reload')], 'r.png'))
    await expect(first.whenShared(ref)).rejects.toThrow()
    failPuts = 0
    resetAssetStatus()
    const second = gm({ dbName: db })
    await second.reshare(ref)
    expect(getAssetStatus(ref.sha256)?.status).toBe('shared')
    expect(await player().resolve(ref)).toMatch(/^blob:/)
    await expect(second.reshare({ ...ref, enc: undefined })).rejects.toThrow(/encrypted/)
  })
})

describe('resolving encrypted refs', () => {
  it('refuses ciphertext that does not decrypt to the plaintext hash', async () => {
    const r = gm()
    const ref = await r.shareFile(new File([enc('real')], 'x.png'))
    await r.whenShared(ref)
    const wrongKey: AssetRef = { ...ref, enc: { ...ref.enc!, key: (await gm().shareFile(new File([enc('other')], 'o.png'))).enc!.key } }
    await expect(player().resolve(wrongKey)).rejects.toThrow(/does not decrypt/)
  })

  it('finds the ciphertext on the Blossom fallbacks by its hash when sources are empty', async () => {
    const r = gm()
    const ref = await r.shareFile(new File([enc('fallback')], 'x.png'))
    await r.whenShared(ref)
    expect(await player().resolve({ ...ref, sources: [] })).toMatch(/^blob:/)
    expect(gets).toContain(`${SERVER}/${ref.enc!.sha256}`)
  })

  it('still resolves legacy plaintext refs from sources and Blossom by plaintext hash', async () => {
    const bytes = enc('old upload')
    const sha = await sha256Hex(bytes)
    stored.set(`${SERVER}/${sha}`, bytes)
    const legacy: AssetRef = { sha256: sha, kind: 'image', mime: 'image/png', size: bytes.length, name: 'old.png', sources: [] }
    expect(await player().resolve(legacy)).toMatch(/^blob:/)
    expect(gets).toEqual([`${LIB}/index.json`, `${SERVER}/${sha}`])
  })

  it('uploadToBlossom sends the ciphertext for encrypted refs and the plaintext for public ones', async () => {
    const r = gm()
    const shared = await r.shareFile(new File([enc('pack-free')], 'p.glb'))
    await r.whenShared(shared)
    const again = await r.uploadToBlossom(shared, 'https://other.test', signer)
    expect(puts.at(-1)).toMatchObject({ url: 'https://other.test/upload', sha: shared.enc!.sha256 })
    expect(again.sources).toContain(`https://other.test/${shared.enc!.sha256}`)

    const pub = await r.importFile(new File([enc('{"pack":1}')], 'pack.json', { type: 'application/json' }))
    await r.uploadToBlossom(pub, SERVER, signer)
    expect(puts.at(-1)).toMatchObject({ sha: pub.sha256, type: 'application/json' })
  })
})

describe('putBlobWithRetry', () => {
  it('waits the given pauses between rounds and reports each attempt', async () => {
    failPuts = 2
    const sleeps: number[] = []
    const attempts: (string | undefined)[] = []
    const body = new Blob([enc('x')])
    const sha = await sha256Hex(enc('x'))
    const out = await putBlobWithRetry([SERVER], body, {
      sha256: sha, mime: 'application/octet-stream', sign: signer, delaysMs: [100, 400, 900],
      sleep: async (ms) => void sleeps.push(ms), onAttempt: (_n, err) => attempts.push(err),
    })
    expect(out).toEqual({ server: SERVER, url: `${SERVER}/${sha}` })
    expect(sleeps).toEqual([100, 400])
    expect(attempts).toEqual([undefined, expect.stringMatching(/503/), expect.stringMatching(/503/)])
  })
})

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRef } from '@/core/assets'
import { createAssetResolver } from './impl'
import { sha256Hex, inferKind } from './hash'
import { buildUploadAuthEvent } from './blossom'

const enc = (s: string) => new TextEncoder().encode(s)
const LIB = 'https://app.test/library'
let n = 0
const freshDb = () => `test-${n++}`

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>
let routes: Map<string, Handler>
let calls: string[]

beforeEach(() => {
  routes = new Map()
  calls = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    const h = routes.get(url)
    return h ? h(url, init) : new Response('nope', { status: 404 })
  })
})
afterEach(() => vi.unstubAllGlobals())

async function makeRef(text: string, sources: string[] = []): Promise<AssetRef> {
  const bytes = enc(text)
  return { sha256: await sha256Hex(bytes), kind: 'json', mime: 'application/json', size: bytes.length, name: 'a.json', sources }
}
const ok = (text: string) => () => new Response(text)

describe('hashing', () => {
  it('matches a known sha256', async () => {
    expect(await sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('infers kinds', () => {
    expect(inferKind('x.glb', '')).toBe('glb')
    expect(inferKind('x.bin', 'audio/ogg')).toBe('audio')
    expect(inferKind('x.weird', '')).toBe('other')
  })
})

describe('importFile', () => {
  it('hashes, caches, and resolves without network', async () => {
    const r = createAssetResolver({ libraryBase: LIB, dbName: freshDb() })
    const ref = await r.importFile(new File([enc('hello')], 'hello.png', { type: 'image/png' }))
    expect(ref).toMatchObject({ kind: 'image', mime: 'image/png', size: 5, name: 'hello.png', sources: [] })
    expect(ref.sha256).toBe(await sha256Hex(enc('hello')))
    const url = await r.resolve(ref)
    expect(url.startsWith('blob:')).toBe(true)
    expect(calls).toEqual([])
    expect(await r.stats()).toEqual({ count: 1, bytes: 5 })
  })
})

describe('importFile without IndexedDB', () => {
  it('keeps imported bytes in memory so they still resolve', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const r = createAssetResolver({ libraryBase: LIB, dbName: freshDb(), blossomServers: [] })
    const ref = await r.importFile(new File([enc('private mode')], 'p.json'))
    await expect(r.resolve(ref)).resolves.toMatch(/^blob:/)
    expect(calls.filter((u) => !u.endsWith('/index.json'))).toEqual([])
  })
})

describe('source order', () => {
  it('uses the library index before ref.sources and caches the result', async () => {
    const ref = await makeRef('lib-bytes', ['https://src.test/a'])
    routes.set(`${LIB}/index.json`, () => Response.json([{ sha256: ref.sha256, path: 'sub/a.json', kind: 'json', mime: ref.mime, size: ref.size, name: 'a.json', license: 'CC0-1.0' }]))
    routes.set(`${LIB}/sub/a.json`, ok('lib-bytes'))
    routes.set('https://src.test/a', ok('lib-bytes'))
    const db = freshDb()
    const r = createAssetResolver({ libraryBase: LIB, dbName: db })
    await r.resolve(ref)
    expect(calls).toEqual([`${LIB}/index.json`, `${LIB}/sub/a.json`])
    // A second resolver (fresh memory) hits the IndexedDB cache with no downloads.
    calls.length = 0
    await createAssetResolver({ libraryBase: LIB, dbName: db }).resolve(ref)
    expect(calls).toEqual([])
  })

  it('falls back library -> sources -> default Blossom, skipping failures', async () => {
    const ref = await makeRef('payload', ['https://dead.test/x', 'https://src.test/ok'])
    routes.set(`${LIB}/index.json`, () => Response.json([]))
    routes.set('https://src.test/ok', ok('payload'))
    const r = createAssetResolver({ libraryBase: LIB, dbName: freshDb(), blossomServers: ['https://b1.test/'] })
    await r.resolve(ref)
    expect(calls).toEqual([`${LIB}/index.json`, 'https://dead.test/x', 'https://src.test/ok'])

    const ref2 = await makeRef('only-on-blossom')
    routes.set(`https://b1.test/${ref2.sha256}`, ok('only-on-blossom'))
    calls.length = 0
    await r.resolve(ref2)
    expect(calls).toEqual([`https://b1.test/${ref2.sha256}`])
  })

  it('rejects hash mismatches and continues to the next source', async () => {
    const ref = await makeRef('good', ['https://evil.test/a', 'https://good.test/a'])
    routes.set(`${LIB}/index.json`, () => Response.json([]))
    routes.set('https://evil.test/a', ok('tampered'))
    routes.set('https://good.test/a', ok('good'))
    const r = createAssetResolver({ libraryBase: LIB, dbName: freshDb() })
    const url = await r.resolve(ref)
    expect(url).toMatch(/^blob:/)
    expect(calls).toContain('https://evil.test/a')
    expect(calls).toContain('https://good.test/a')
  })

  it('throws with a per-source report when nothing verifies', async () => {
    const ref = await makeRef('good', ['https://evil.test/a'])
    routes.set('https://evil.test/a', ok('tampered'))
    const r = createAssetResolver({ libraryBase: LIB, dbName: freshDb(), blossomServers: [] })
    await expect(r.resolve(ref)).rejects.toThrow(/hash mismatch/)
  })

  it('reports download progress', async () => {
    const ref = await makeRef('progress-bytes', ['https://src.test/p'])
    routes.set('https://src.test/p', ok('progress-bytes'))
    const seen: number[] = []
    const r = createAssetResolver({ libraryBase: LIB, dbName: freshDb(), onProgress: (_r, loaded) => seen.push(loaded) })
    await r.resolve(ref)
    expect(seen.at(-1)).toBe(ref.size)
  })
})

describe('in-flight dedupe and release', () => {
  it('shares one download between concurrent resolves of a hash', async () => {
    const ref = await makeRef('shared', ['https://src.test/s'])
    routes.set(`${LIB}/index.json`, () => Response.json([]))
    routes.set('https://src.test/s', ok('shared'))
    const r = createAssetResolver({ libraryBase: LIB, dbName: freshDb() })
    const [a, b, c] = await Promise.all([r.resolve(ref), r.resolve(ref), r.resolve({ ...ref })])
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(calls.filter((u) => u === 'https://src.test/s')).toHaveLength(1)
  })

  it('revokes the object URL only when the last holder releases', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const ref = await makeRef('rel', ['https://src.test/r'])
    routes.set('https://src.test/r', ok('rel'))
    const r = createAssetResolver({ libraryBase: LIB, dbName: freshDb() })
    const url = await r.resolve(ref)
    await r.resolve(ref)
    r.release(ref)
    expect(revoke).not.toHaveBeenCalled()
    r.release(ref)
    expect(revoke).toHaveBeenCalledWith(url)
    revoke.mockRestore()
  })
})

describe('addUrlSource', () => {
  it('appends a verified url once and rejects wrong bytes', async () => {
    const ref = await makeRef('pasted')
    routes.set('https://p.test/ok', ok('pasted'))
    routes.set('https://p.test/bad', ok('different'))
    const r = createAssetResolver({ libraryBase: LIB, dbName: freshDb() })
    const next = await r.addUrlSource(ref, 'https://p.test/ok')
    expect(next.sources).toEqual(['https://p.test/ok'])
    expect((await r.addUrlSource(next, 'https://p.test/ok')).sources).toEqual(['https://p.test/ok'])
    await expect(r.addUrlSource(ref, 'https://p.test/bad')).rejects.toThrow(/does not serve this file/)
  })
})

describe('Blossom upload', () => {
  it('builds a BUD-02 auth event', () => {
    const e = buildUploadAuthEvent('ab'.repeat(32), 'f.glb', 1000)
    expect(e.kind).toBe(24242)
    expect(e.created_at).toBe(1000)
    expect(e.tags).toContainEqual(['t', 'upload'])
    expect(e.tags).toContainEqual(['x', 'ab'.repeat(32)])
    expect(e.tags).toContainEqual(['expiration', '1300'])
  })

  async function setup() {
    const r = createAssetResolver({ libraryBase: LIB, dbName: freshDb() })
    const ref = await r.importFile(new File([enc('upload me')], 'm.glb'))
    return { r, ref }
  }
  const signer = async (e: unknown) => ({ ...(e as object), id: 'i'.repeat(64), pubkey: 'p'.repeat(64), sig: 's'.repeat(128) })

  it('PUTs raw bytes with a Nostr Authorization header and appends the descriptor url', async () => {
    const { r, ref } = await setup()
    let seen: { headers: Record<string, string>; body: unknown } | undefined
    routes.set('https://blob.test/upload', (_u, init) => {
      seen = { headers: init?.headers as Record<string, string>, body: init?.body }
      expect(init?.method).toBe('PUT')
      return Response.json({ url: `https://cdn.blob.test/${ref.sha256}.glb`, sha256: ref.sha256, size: ref.size, type: ref.mime, uploaded: 1 })
    })
    const out = await r.uploadToBlossom(ref, 'https://blob.test/', signer)
    expect(out.sources).toEqual([`https://cdn.blob.test/${ref.sha256}.glb`])
    const auth = seen!.headers.Authorization
    expect(auth.startsWith('Nostr ')).toBe(true)
    const event = JSON.parse(atob(auth.slice(6)))
    expect(event.kind).toBe(24242)
    expect(event.tags).toContainEqual(['x', ref.sha256])
    expect(event.tags).toContainEqual(['t', 'upload'])
    expect(event.sig).toBeTruthy()
    expect(await sha256Hex(seen!.body as Blob)).toBe(ref.sha256)
  })

  it('turns 4xx into a readable error', async () => {
    const { r, ref } = await setup()
    routes.set('https://blob.test/upload', () => new Response('', { status: 413, headers: { 'X-Reason': 'max 1MB' } }))
    await expect(r.uploadToBlossom(ref, 'https://blob.test', signer)).rejects.toThrow(/413 \(the file is too large.*max 1MB/)
  })

  it('rejects an unsigned signer result', async () => {
    const { r, ref } = await setup()
    await expect(r.uploadToBlossom(ref, 'https://blob.test', async (e) => e)).rejects.toThrow(/signed event/)
  })
})

describe('stats and evict', () => {
  it('evicts least recently used first', async () => {
    const db = freshDb()
    const r = createAssetResolver({ libraryBase: LIB, dbName: db, blossomServers: [] })
    const pause = () => new Promise((res) => setTimeout(res, 5))
    const old = await r.importFile(new File([enc('aaaa')], 'a.bin'))
    await pause()
    const mid = await r.importFile(new File([enc('bbbb')], 'b.bin'))
    await pause()
    await r.importFile(new File([enc('cccc')], 'c.bin'))
    await pause()
    await r.resolve(old) // touches `old`, so `mid` is now the least recently used
    expect(await r.stats()).toEqual({ count: 3, bytes: 12 })
    expect(await r.evict(8)).toEqual({ evicted: 1, freedBytes: 4 })
    expect(await r.stats()).toEqual({ count: 2, bytes: 8 })
    const fresh = createAssetResolver({ libraryBase: LIB, dbName: db, blossomServers: [] })
    await expect(fresh.resolve(mid)).rejects.toThrow()
    await expect(fresh.resolve(old)).resolves.toMatch(/^blob:/)
  })
})

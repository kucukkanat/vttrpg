import { describe, expect, it } from 'vitest'
import sketchfabSearch from './__fixtures__/sketchfab-search.json'
import polyhavenAssets from './__fixtures__/polyhaven-assets.json'
import polyhavenFiles from './__fixtures__/polyhaven-files.json'
import {
  downloadSketchfabModel, forgetSketchfabToken, getSketchfabToken, needsSizeWarning, parseDownloadLinks, parseSketchfabSearch,
  pickThumbnail, searchSketchfab, setSketchfabToken, sketchfabMeta, SKETCHFAB_TOKEN_KEY, SKETCHFAB_WARN_BYTES,
} from './sketchfab'
import { downloadPolyHavenModel, filterPolyHaven, parsePolyHavenAssets, parsePolyHavenCategories, parsePolyHavenFiles, polyHavenMeta } from './polyhaven'
import { fetchBytes } from './download'

const TOKEN = '0123456789abcdef0123456789abcdef'

function memoryStorage() {
  const m = new Map<string, string>()
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('Sketchfab search parsing', () => {
  const page = parseSketchfabSearch(sketchfabSearch)

  it('keeps only cc0, by and by-sa results', () => {
    expect(sketchfabSearch.results.length).toBe(6)
    expect(page.results.map((r) => r.licence)).toEqual(['cc0', 'cc-by', 'cc-by-sa'])
  })

  it('reads thumbnails, face count, archive sizes, author and URLs', () => {
    const r = page.results[0]
    expect(r).toMatchObject({
      uid: '72b757582d034946bf5cb44226b471a5',
      title: 'Barrel - Low Poly Medieval, CC0',
      author: 'Avramania',
      authorUrl: 'https://sketchfab.com/Avramania',
      pageUrl: expect.stringContaining('72b757582d034946bf5cb44226b471a5'),
      faceCount: 2348,
      licenceLabel: 'CC0 (public domain)',
    })
    expect(r.glb?.size).toBe(160304)
    expect(r.gltf?.size).toBe(25759)
    expect(r.thumbnail).toMatch(/^https:\/\/media\.sketchfab\.com\//)
    expect(page.next).toMatch(/^https:\/\/api\.sketchfab\.com\/v3\/search\?/)
  })

  it('ignores next links that leave the API', () => {
    expect(parseSketchfabSearch({ results: [], next: 'https://evil.example/search' }).next).toBeUndefined()
    expect(parseSketchfabSearch(null).results).toEqual([])
  })

  it('picks a card-sized thumbnail', () => {
    expect(pickThumbnail([{ url: 'a', width: 1920 }, { url: 'b', width: 720 }, { url: 'c', width: 200 }])).toBe('b')
    expect(pickThumbnail([{ url: 'c', width: 200 }])).toBe('c')
    expect(pickThumbnail(undefined)).toBeUndefined()
  })

  it('searches each allowed licence and interleaves the pages', async () => {
    const calls: string[] = []
    const f = (async (url: string) => {
      calls.push(url)
      const slug = new URL(url).searchParams.get('license')
      const idx = { cc0: 0, by: 2, 'by-sa': 5 }[slug as 'cc0']
      return jsonResponse({ results: [sketchfabSearch.results[idx]], next: slug === 'by' ? 'https://api.sketchfab.com/v3/search?cursor=8&license=by' : null })
    }) as typeof fetch
    const { results, cursor } = await searchSketchfab('barrel', { fetch: f, maxFaces: 20000 })
    expect(calls).toHaveLength(3)
    for (const c of calls) {
      const p = new URL(c).searchParams
      expect(p.get('downloadable')).toBe('true')
      expect(p.get('type')).toBe('models')
      expect(p.get('q')).toBe('barrel')
      expect(p.get('max_face_count')).toBe('20000')
      expect(['cc0', 'by', 'by-sa']).toContain(p.get('license'))
    }
    expect(results.map((r) => r.licence)).toEqual(['cc0', 'cc-by', 'cc-by-sa'])
    expect(cursor).toEqual({ by: 'https://api.sketchfab.com/v3/search?cursor=8&license=by' })
  })
})

describe('Sketchfab download', () => {
  it('warns above 30 MB', () => {
    expect(needsSizeWarning({ glb: { size: SKETCHFAB_WARN_BYTES + 1 } })).toBe(true)
    expect(needsSizeWarning({ glb: { size: 1000 } })).toBe(false)
    expect(needsSizeWarning({ gltf: { size: SKETCHFAB_WARN_BYTES * 2 } })).toBe(true)
  })

  it('parses the temporary links and drops non-https ones', () => {
    expect(parseDownloadLinks({ glb: { url: 'https://s3/x.glb', size: 5, expires: 300 }, gltf: { url: 'http://insecure' } })).toEqual({ glb: { url: 'https://s3/x.glb', size: 5, expires: 300 } })
  })

  it('sends the token only to the API, never to the file host', async () => {
    const seen: Array<{ url: string; auth: string | null }> = []
    const f = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') })
      if (url.startsWith('https://api.sketchfab.com/')) return jsonResponse({ glb: { url: 'https://sketchfab-prod-media.s3.amazonaws.com/x.glb?sig=1', size: 4, expires: 300 } })
      return new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]))
    }) as typeof fetch
    const files = await downloadSketchfabModel({ uid: '72b757582d034946bf5cb44226b471a5', title: 'Barrel' }, TOKEN, { fetch: f })
    expect(files).toHaveLength(1)
    expect(files[0].name).toMatch(/\.glb$/)
    expect(seen[0]).toEqual({ url: 'https://api.sketchfab.com/v3/models/72b757582d034946bf5cb44226b471a5/download', auth: `Token ${TOKEN}` })
    expect(seen[1].auth).toBeNull()
  })

  it('explains a rejected token', async () => {
    const f = (async () => jsonResponse({ detail: 'Invalid token' }, 401)) as unknown as typeof fetch
    await expect(downloadSketchfabModel({ uid: '72b757582d034946bf5cb44226b471a5', title: 'x' }, TOKEN, { fetch: f })).rejects.toMatchObject({ code: 'auth' })
    await expect(downloadSketchfabModel({ uid: '72b757582d034946bf5cb44226b471a5', title: 'x' }, '', { fetch: f })).rejects.toMatchObject({ code: 'auth' })
  })
})

describe('Sketchfab token storage', () => {
  it('stores, reads and forgets the token under vtt.sketchfab.token only', () => {
    const s = memoryStorage()
    expect(getSketchfabToken(s)).toBeNull()
    setSketchfabToken(`  ${TOKEN} `, s)
    expect([...s.m.keys()]).toEqual([SKETCHFAB_TOKEN_KEY])
    expect(getSketchfabToken(s)).toBe(TOKEN)
    forgetSketchfabToken(s)
    expect(s.m.size).toBe(0)
    setSketchfabToken(TOKEN, s)
    setSketchfabToken('   ', s)
    expect(getSketchfabToken(s)).toBeNull()
  })

  it('survives a storage that throws (private mode)', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
    expect(getSketchfabToken(broken)).toBeNull()
    expect(setSketchfabToken(TOKEN, broken)).toBe(false)
  })

  it('never puts the token in the import metadata that reaches the catalogue', () => {
    const s = memoryStorage()
    setSketchfabToken(TOKEN, s)
    const model = parseSketchfabSearch(sketchfabSearch).results[1]
    const meta = sketchfabMeta(model)
    expect(JSON.stringify(meta)).not.toContain(TOKEN)
    expect(meta.licence).toMatchObject({ id: 'cc-by', source: 'Sketchfab', author: model.author, sourceUrl: model.pageUrl })
  })
})

describe('Poly Haven parsing', () => {
  const models = parsePolyHavenAssets(polyhavenAssets)

  it('reads models with categories, thumbnails, authors and true size', () => {
    const table = models.find((m) => m.id === 'wooden_table_02')!
    expect(table.thumbnail).toMatch(/^https:\/\/cdn\.polyhaven\.com\//)
    expect(table.pageUrl).toBe('https://polyhaven.com/a/wooden_table_02')
    expect(table.authors.length).toBeGreaterThan(0)
    expect(table.categories).toContain('furniture')
    expect(table.dimensions?.every((d) => d > 0.1 && d < 3)).toBe(true)
    expect(models[0].downloads! >= models[models.length - 1].downloads!).toBe(true)
  })

  it('filters by words and category', () => {
    expect(filterPolyHaven(models, 'chair').map((m) => m.id)).toEqual(['ArmChair_01'])
    expect(filterPolyHaven(models, 'wooden table').map((m) => m.id)).toEqual(['wooden_table_02'])
    expect(filterPolyHaven(models, '', 'furniture').length).toBeGreaterThanOrEqual(2)
    expect(filterPolyHaven(models, 'nothing-like-this')).toEqual([])
  })

  it('maps categories, skipping collections', () => {
    expect(parsePolyHavenCategories({ all: 9, furniture: 3, 'collection: moon': 2, props: 5 })).toEqual([{ id: 'props', count: 5 }, { id: 'furniture', count: 3 }])
  })

  it('prefers the 1k glTF and lists its companions', () => {
    const set = parsePolyHavenFiles(polyhavenFiles)!
    expect(set.resolution).toBe('1k')
    expect(set.gltfUrl).toMatch(/_1k\.gltf$/)
    expect(Object.keys(set.include)).toContain('wooden_table_02.bin')
    expect(set.totalBytes).toBeGreaterThan(400_000)
    expect(parsePolyHavenFiles(polyhavenFiles, '8k')!.resolution).toBe('4k')
    expect(parsePolyHavenFiles({})).toBeUndefined()
  })

  it('imports as CC0 from Poly Haven with the asset page as source', () => {
    const meta = polyHavenMeta(models.find((m) => m.id === 'wooden_table_02')!)
    expect(meta).toMatchObject({ origin: 'polyhaven', sourceId: 'wooden_table_02', category: 'furniture' })
    expect(meta.licence).toMatchObject({ id: 'cc0', source: 'Poly Haven', sourceUrl: 'https://polyhaven.com/a/wooden_table_02' })
    expect(meta.knownSize).toBeDefined()
  })

  it('downloads the glTF set with relative names', async () => {
    const f = (async (url: string) => (url.includes('/files/') ? jsonResponse(polyhavenFiles) : new Response(new Uint8Array(8)))) as typeof fetch
    const { files } = await downloadPolyHavenModel({ id: 'wooden_table_02' }, { fetch: f })
    expect(files.map((x) => x.name).sort()).toEqual(['textures/wooden_table_02_arm_1k.jpg', 'textures/wooden_table_02_diff_1k.jpg', 'textures/wooden_table_02_nor_gl_1k.jpg', 'wooden_table_02.bin', 'wooden_table_02.gltf'])
  })
})

describe('fetchBytes', () => {
  it('rejects downloads over the limit', async () => {
    const f = (async () => new Response(new Uint8Array(100), { headers: { 'content-length': '100' } })) as unknown as typeof fetch
    await expect(fetchBytes('https://x.test/a', { fetch: f, limit: 50 })).rejects.toMatchObject({ code: 'too-large' })
    const g = (async () => new Response(new Uint8Array(100))) as unknown as typeof fetch
    await expect(fetchBytes('https://x.test/a', { fetch: g, limit: 50 })).rejects.toMatchObject({ code: 'too-large' })
  })
})

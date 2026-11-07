/**
 * Live Sketchfab check, skipped unless SKETCHFAB_API_TOKEN is set in the environment (never read
 * from a file, never printed). Run with:
 *
 *   SKETCHFAB_API_TOKEN=... npx vitest run src/import/model/sketchfab.live.test.ts
 *
 * Node's fetch ignores CORS, so the test checks the headers a browser would need explicitly.
 */
import { describe, expect, it } from 'vitest'
import { getSketchfabDownloadLinks, searchSketchfab, sketchfabMeta } from './sketchfab'
import { fetchBytes } from './download'

const token = process.env.SKETCHFAB_API_TOKEN?.trim()
const ORIGIN = 'https://kucukkanat.github.io'

describe.skipIf(!token)('Sketchfab live', () => {
  it('finds a small CC0 model, downloads its GLB with the token and the file host allows CORS', async () => {
    const { results } = await searchSketchfab('barrel', { licence: 'cc0', maxFaces: 5000, count: 12 })
    const model = results.find((r) => r.glb && r.glb.size < 5 * 1024 * 1024)
    expect(model, 'a small CC0 GLB in the results').toBeDefined()

    const pre = await fetch(`https://api.sketchfab.com/v3/models/${model!.uid}/download`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    })
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization')

    const links = await getSketchfabDownloadLinks(model!.uid, token!)
    expect(links.glb?.url).toMatch(/^https:\/\//)
    const head = await fetch(links.glb!.url, { headers: { Origin: ORIGIN, Range: 'bytes=0-15' } })
    const acao = head.headers.get('access-control-allow-origin')
    expect(acao === '*' || acao === ORIGIN, `file host ACAO was ${acao}`).toBe(true)
    await head.arrayBuffer()

    const glb = await fetchBytes(links.glb!.url)
    expect(new TextDecoder().decode(glb.subarray(0, 4))).toBe('glTF')

    const { prepareModel } = await import('./pipeline')
    const prepared = await prepareModel([{ name: `${model!.uid}.glb`, bytes: glb }], sketchfabMeta(model!), {
      useWorker: false,
      renderThumbnail: async () => new Blob([new Uint8Array(1)], { type: 'image/webp' }),
    })
    expect(prepared.entry.id).toBe(`sketchfab:${model!.uid}`)
    expect(prepared.entry.triangles).toBeGreaterThan(0)
    expect(prepared.entry.size.every((v) => v > 0)).toBe(true)
    expect(JSON.stringify(prepared.entry)).not.toContain(token!)
  }, 60_000)
})

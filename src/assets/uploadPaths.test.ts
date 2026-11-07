/**
 * Every way a file enters a game goes through `shareFile`, so players on other devices can load it.
 * The import helpers run against a real resolver and a fake Blossom; the panels (React) are held to
 * the same rule by a source check.
 */
import 'fake-indexeddb/auto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRef } from '@/core/assets'
import type { AssetHash } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { createImageScene } from '@/import/mapImage'
import { importSceneFile } from '@/import/importSceneFile'
import uvtt from '@/import/__fixtures__/tiny.dd2vtt.json'
import { withSharedRefs } from '@/ui/gameFile'
import { snapshotUploader } from '@/ui/bootstrap'
import { createAssetResolver } from './impl'
import { sha256Hex } from './hash'
import { resetAssetStatus } from './status'

const SERVER = 'https://blob.test'
let n = 0
const signer = async (e: unknown) => ({ ...(e as object), id: 'i'.repeat(64), pubkey: 'p'.repeat(64), sig: 's'.repeat(128) })
let puts: { url: string; sha: string; body: Uint8Array }[]

beforeEach(() => {
  puts = []
  resetAssetStatus()
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (init?.method !== 'PUT') return new Response('nope', { status: 404 })
    const body = new Uint8Array(await (init.body as Blob).arrayBuffer())
    const sha = await sha256Hex(body)
    puts.push({ url, sha: (init.headers as Record<string, string>)['X-SHA-256']!, body })
    return Response.json({ url: `${SERVER}/${sha}`, sha256: sha })
  })
})
afterEach(() => vi.unstubAllGlobals())

function gameController() {
  const assets = createAssetResolver({ libraryBase: 'https://app.test/library', dbName: `paths-${n++}`, blossomServers: [SERVER], uploader: { sign: signer }, retryDelaysMs: [] })
  const intents: Intent[] = []
  return { assets, intents, dispatch: async (i: Intent) => void intents.push(i) }
}

describe('import helpers upload through shareFile', () => {
  it('map image import', async () => {
    const c = gameController()
    const scene = await createImageScene(new File([new Uint8Array([1, 2, 3])], 'cave.png', { type: 'image/png' }), c, { columns: 10, cellSize: 1 }, { width: 700, height: 700 })
    const asset = scene.image!.asset
    expect(asset.enc).toBeDefined()
    await c.assets.whenShared(asset)
    expect(puts).toEqual([expect.objectContaining({ url: `${SERVER}/upload`, sha: asset.enc!.sha256 })])
  })

  it('UVTT / Foundry scene import', async () => {
    const c = gameController()
    const file = new File([JSON.stringify(uvtt)], 'tiny.dd2vtt', { type: 'application/octet-stream' })
    const result = await importSceneFile(file, c, { cellSize: 1 })
    const asset = result!.scene.image!.asset
    expect(asset.enc).toBeDefined()
    await c.assets.whenShared(asset)
    expect(puts.map((p) => p.sha)).toEqual([asset.enc!.sha256])
  })

  it('game import: refs in the imported doc pick up the re-shared key and URLs', () => {
    const plain = 'a'.repeat(64) as AssetHash
    const other = 'b'.repeat(64) as AssetHash
    const old: AssetRef = { sha256: plain, kind: 'glb', mime: 'model/gltf-binary', size: 3, name: 'm.glb', sources: [] }
    const shared: AssetRef = { ...old, sources: [`${SERVER}/${'c'.repeat(64)}`], enc: { sha256: 'c'.repeat(64) as AssetHash, key: 'k' } }
    const doc = {
      props: { p1: { id: 'p1', model: old } },
      tokens: { t1: { id: 't1', model: { ...old, sha256: other } } },
      notes: { n1: { pages: [{ image: old }] } },
    }
    const out = withSharedRefs(doc, new Map([[plain, shared]]))
    expect(out.props.p1.model).toEqual({ ...old, sources: shared.sources, enc: shared.enc })
    expect(out.notes.n1.pages[0]!.image.enc).toEqual(shared.enc)
    expect(out.tokens.t1.model).toEqual({ ...old, sha256: other })
    expect(doc.props.p1.model.sources).toEqual([]) // the input is not mutated
  })

  it('snapshot uploader puts the bytes it is given (ciphertext from the loop) and reports their hash', async () => {
    const upload = snapshotUploader({ sign: signer }, [SERVER], [])
    const bytes = new Uint8Array([9, 8, 7])
    const out = await upload(bytes)
    expect(out).toEqual({ url: `${SERVER}/${await sha256Hex(bytes)}`, sha256: await sha256Hex(bytes) })
    expect(puts).toHaveLength(1)
  })
})

/** All .ts/.tsx files under src, test files excluded. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('no upload path bypasses shareFile', () => {
  const root = join(__dirname, '..')
  const files = sources(root)
  const text = (rel: string) => readFileSync(join(root, rel), 'utf8')

  it.each([
    'ui/panels/ObjectPanel.tsx', // prop and token GLBs
    'ui/panels/ScenesPanel.tsx', // scene GLBs and map images
    'ui/panels/JournalPanel.tsx', // journal images
    'ui/panels/SoundboardPanel.tsx', // sounds
    'ui/importGame.ts', // embedded assets of a game file
    'import/mapImage.ts',
    'import/importSceneFile.ts',
  ])('%s shares its files', (rel) => {
    expect(text(rel)).toMatch(/assets\.shareFile\(/)
  })

  it('only the resolver itself and pack bundles (public by design) call importFile', () => {
    const callers = files
      .filter((f) => /\.importFile\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f))
      .filter((f) => !f.startsWith('assets/'))
    expect(callers).toEqual(['ui/pages/PackPicker.tsx'])
  })
})

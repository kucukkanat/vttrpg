import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PackSourceError, explainPackError, loadPackFromBundle, loadPackFromUrl, normalizePackUrl, packChoiceOf, parsePackBundle } from './packSource'

/** The Mausritter pack folder as a bundle, the way a pack author would ship one. */
function mausritterBundle(): Record<string, unknown> {
  const dir = join(__dirname, '../../packs/mausritter')
  const files: Record<string, unknown> = {}
  const add = (rel: string) => { files[rel] = JSON.parse(readFileSync(join(dir, rel), 'utf8')) }
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) add(f)
  for (const f of readdirSync(join(dir, 'skills'))) if (f.endsWith('.json')) add(`skills/${f}`)
  return files
}

describe('pack addresses', () => {
  it('normalizes to the pack folder and refuses non-web addresses', () => {
    expect(normalizePackUrl(' https://x.org/packs/foo/pack.json?x=1#y ')).toBe('https://x.org/packs/foo/')
    expect(normalizePackUrl('https://x.org/packs/foo')).toBe('https://x.org/packs/foo/')
    expect(() => normalizePackUrl('')).toThrow(PackSourceError)
    expect(() => normalizePackUrl('packs/foo')).toThrow(/web address/)
    expect(() => normalizePackUrl('ftp://x.org/p/')).toThrow(/https/)
  })

  it('explains network, missing-file and validation failures', () => {
    expect(explainPackError(new Error('pack: pack.json: fetch failed (Failed to fetch)'), 'x.org')).toMatch(/Could not reach x.org.*CORS/)
    expect(explainPackError(new Error('pack: pack.json: HTTP 404 at https://x/pack.json'), 'x')).toMatch(/folder that holds pack.json/)
    expect(explainPackError(new Error('pack: pack.json: "id" required'), 'x')).toBe('The pack is not valid: pack.json: "id" required')
  })

  it('loads and validates a pack by address through the pack loader', async () => {
    const files = mausritterBundle()
    const fetcher = async (url: string) => {
      const key = url.replace('https://packs.test/m/', '')
      return key in files ? { ok: true, status: 200, json: async () => files[key] } : { ok: false, status: 404, json: async () => null }
    }
    const { url, pack } = await loadPackFromUrl('https://packs.test/m/pack.json', fetcher)
    expect(url).toBe('https://packs.test/m/')
    expect(pack.manifest.id).toBe('mausritter')
    await expect(loadPackFromUrl('https://packs.test/nothing/', fetcher)).rejects.toThrow(/folder that holds pack.json/)
  })
})

describe('pack bundles', () => {
  it('loads a valid bundle and reports what is wrong with a broken one', async () => {
    const files = mausritterBundle()
    const pack = await loadPackFromBundle(parsePackBundle(JSON.stringify({ format: 'vttrpg-pack', files })))
    expect(pack.skills.length).toBeGreaterThan(0)
    expect(() => parsePackBundle('nope')).toThrow(/not JSON/)
    expect(() => parsePackBundle('{"format":"x"}')).toThrow(/Not a pack bundle/)
    expect(() => parsePackBundle('{"format":"vttrpg-pack","files":{}}')).toThrow(/pack.json/)
    const broken = { ...files, 'pack.json': { ...(files['pack.json'] as object), id: '' } }
    await expect(loadPackFromBundle({ files: broken })).rejects.toThrow(/not valid.*"id" required/)
    const missing = { ...files }
    delete missing['sheet.json']
    await expect(loadPackFromBundle({ files: missing })).rejects.toThrow(/sheet.json/)
  })

  it('reads the pack choice from game meta', () => {
    expect(packChoiceOf(undefined, 'mausritter')).toEqual({ id: 'mausritter', source: undefined, asset: undefined })
    expect(packChoiceOf({ pack: 'x' as never, packSource: 'https://p/' }, 'm')).toMatchObject({ id: 'x', source: 'https://p/' })
  })
})

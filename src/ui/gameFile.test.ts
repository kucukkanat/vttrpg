import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { AssetRef } from '@/core/assets'
import type { AssetHash, PlayerPubkey } from '@/core/ids'
import { GameFileError, buildGameFile, collectAssetRefs, decodeAssets, docToJson, gameFileName, parseGameFile, writeImportedDoc } from './gameFile'

async function hashOf(bytes: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('') as AssetHash
}
const ref = (sha256: AssetHash, name: string): AssetRef => ({ sha256, kind: 'image', mime: 'image/png', size: 3, name, sources: ['https://cdn.test/' + sha256] })

async function sampleDoc() {
  const map = new Uint8Array([1, 2, 3])
  const portrait = new Uint8Array([9, 9])
  const mapRef = ref(await hashOf(map), 'map.png')
  const portraitRef = ref(await hashOf(portrait), 'p.png')
  const doc = new Y.Doc()
  doc.transact(() => {
    const meta = doc.getMap('meta')
    meta.set('name', 'Cave run')
    meta.set('gm', 'old-gm')
    meta.set('pack', 'mausritter')
    meta.set('activeScene', 's1')
    doc.getMap('scenes').set('s1', { id: 's1', name: 'Cave', image: { asset: mapRef, widthCells: 10, heightCells: 10 } })
    doc.getMap('characters').set('c1', { id: 'c1', name: 'Pip', portrait: portraitRef, data: {} })
    doc.getArray('chat').push([{ id: 'm1', author: 'x', at: 1, kind: 'say', text: 'hi' }])
    doc.getArray('events').push([{ id: 'e1', at: 1, kind: 'audio', asset: { sha256: '0'.repeat(64), sources: ['builtin:drum'] } }])
  })
  return { doc, bytes: new Map([[mapRef.sha256, map], [portraitRef.sha256, portrait]]), mapRef, portraitRef }
}

describe('game file', () => {
  it('collects asset refs anywhere in the doc, skipping built-ins', async () => {
    const { doc, mapRef, portraitRef } = await sampleDoc()
    const json = docToJson(doc)
    expect(json).not.toHaveProperty('events')
    expect(collectAssetRefs(json).map((r) => r.sha256).sort()).toEqual([mapRef.sha256, portraitRef.sha256].sort())
    expect(collectAssetRefs(doc.getArray('events').toJSON())).toEqual([])
  })

  it('round-trips the document and the assets it could fetch; the rest are listed missing', async () => {
    const { doc, bytes, mapRef, portraitRef } = await sampleDoc()
    const file = await buildGameFile(doc, async (r) => {
      if (r.sha256 === portraitRef.sha256) throw new Error('offline')
      return bytes.get(r.sha256)!
    }, { now: 5 })
    expect(Object.keys(file.assets)).toEqual([mapRef.sha256])
    expect(file.missingAssets).toEqual([portraitRef.sha256])

    const parsed = parseGameFile(JSON.stringify(file))
    const { ok, bad } = await decodeAssets(parsed)
    expect(bad).toBe(0)
    expect([...ok[0].bytes]).toEqual([1, 2, 3])

    const target = new Y.Doc()
    target.getMap('meta').set('gm', 'new-gm')
    writeImportedDoc(target, parsed, 'new-gm' as PlayerPubkey, 99)
    const meta = target.getMap('meta').toJSON()
    expect(meta).toMatchObject({ name: 'Cave run', gm: 'new-gm', pack: 'mausritter', activeScene: 's1', createdAt: 99 })
    expect(target.getMap('scenes').get('s1')).toEqual(doc.getMap('scenes').get('s1'))
    expect(target.getArray('chat').toJSON()).toHaveLength(1)
  })

  it('refuses an asset whose bytes do not match its hash, on export and on import', async () => {
    const { doc, mapRef } = await sampleDoc()
    const file = await buildGameFile(doc, async () => new Uint8Array([7]))
    expect(file.missingAssets).toHaveLength(2)
    const forged = { ...file, assets: { [mapRef.sha256]: { mime: 'image/png', data: btoa('nope') } } }
    expect((await decodeAssets(parseGameFile(JSON.stringify(forged)))).bad).toBe(1)
  })

  it('explains what is wrong with a file that is not a game export', () => {
    const bad = (s: string) => () => parseGameFile(s)
    expect(bad('not json')).toThrow(GameFileError)
    expect(bad('{}')).toThrow(/not a game export/)
    expect(bad(JSON.stringify({ format: 'vttrpg-game', version: 99 }))).toThrow(/newer version/)
    expect(bad(JSON.stringify({ format: 'vttrpg-game', version: 1, doc: {} }))).toThrow(/no game/)
    expect(bad(JSON.stringify({ format: 'vttrpg-game', version: 1, doc: { meta: { name: 'x', pack: 'p' }, tokens: [] } }))).toThrow(/"tokens"/)
    expect(bad(JSON.stringify({ format: 'vttrpg-game', version: 1, doc: { meta: { name: 'x', pack: 'p' } }, assets: { zz: {} } }))).toThrow(/asset/)
  })

  it('names the file after the game and the date', () => {
    expect(gameFileName('The Cave: Part 2!', Date.UTC(2026, 10, 7))).toBe('the-cave-part-2-2026-11-07.vttgame.json')
    expect(gameFileName('  ', 0)).toBe('game-1970-01-01.vttgame.json')
  })
})

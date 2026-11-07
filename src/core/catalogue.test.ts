import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { GameDocShape } from './doc'
import type { AssetHash, PlayerPubkey } from './ids'
import { badCatalogueEntry, type CatalogueEntry } from './catalogue'
import { applyIntent } from '@/state/apply'
import { createRulesEngine } from '@/rules/engine'
import type { RulesEngine } from '@/rules/index'
import { loadMausritter } from '@/rules/test-helpers'

const model = { sha256: 'aa'.repeat(32) as AssetHash, kind: 'glb' as const, mime: 'model/gltf-binary', size: 1234, sources: ['https://blossom.example/bb'], enc: { sha256: 'bb'.repeat(32) as AssetHash, key: 'k' } }

const good: CatalogueEntry = {
  id: 'sketchfab:abc123', origin: 'sketchfab', title: 'Old lantern', category: 'light', tags: ['lantern', 'lamp'],
  model, size: [0.3, 0.6, 0.3], triangles: 4200,
  licence: { id: 'cc-by', author: 'Ann Maker', authorUrl: 'https://sketchfab.com/ann', source: 'Sketchfab', sourceUrl: 'https://sketchfab.com/3d-models/abc123' },
  thumbnail: { ...model, sha256: 'cc'.repeat(32) as AssetHash, kind: 'image', mime: 'image/webp' },
}

describe('badCatalogueEntry (catalogue.add)', () => {
  it('accepts an imported model with a shareable licence', () => {
    expect(badCatalogueEntry(good)).toBeNull()
    expect(badCatalogueEntry({ ...good, origin: 'upload', id: 'upload:x', licence: { id: 'own-work' }, thumbnail: undefined })).toBeNull()
    expect(badCatalogueEntry({ ...good, licence: { id: 'cc0' } })).toBeNull()
  })
  it('refuses a licence that cannot be shared with players', () => {
    expect(badCatalogueEntry({ ...good, licence: { id: 'cc-by-nc' } as never })).toMatch(/licence/)
    expect(badCatalogueEntry({ ...good, licence: { id: 'all-rights-reserved' } as never })).toMatch(/licence/)
    expect(badCatalogueEntry({ ...good, licence: undefined } as never)).toMatch(/licence/)
  })
  it('needs an author for CC BY and CC BY-SA', () => {
    expect(badCatalogueEntry({ ...good, licence: { id: 'cc-by-sa' } })).toMatch(/author/)
    expect(badCatalogueEntry({ ...good, licence: { id: 'cc-by', author: '  ' } })).toMatch(/author/)
  })
  it('refuses built-ins and broken shapes', () => {
    expect(badCatalogueEntry({ ...good, origin: 'builtin' })).toMatch(/imported/)
    expect(badCatalogueEntry(null)).toBeTruthy()
    expect(badCatalogueEntry({ ...good, id: '' })).toMatch(/entry/)
    expect(badCatalogueEntry({ ...good, title: ' ' })).toMatch(/entry/)
    expect(badCatalogueEntry({ ...good, model: { sha256: 1 } } as never)).toMatch(/model/)
    expect(badCatalogueEntry({ ...good, size: [1, 0, 1] })).toMatch(/size/)
    expect(badCatalogueEntry({ ...good, tags: ['ok', 3] } as never)).toMatch(/tags/)
    expect(badCatalogueEntry({ ...good, origin: 'pirate' } as never)).toMatch(/imported/)
  })
})

describe('catalogue.add / catalogue.remove', () => {
  let engine: RulesEngine
  beforeAll(async () => { engine = createRulesEngine(await loadMausritter()) })
  const gm = { isGm: true, pubkey: 'gm' }
  const player = { isGm: false, pubkey: 'p1' }
  const doc = { scenes: {}, props: {} } as unknown as GameDocShape

  it('is GM only, and validated for the GM too', () => {
    expect(engine.validate({ type: 'catalogue.add', entry: good }, gm, doc)).toBeNull()
    expect(engine.validate({ type: 'catalogue.add', entry: good }, player, doc)).toMatch(/GM/)
    expect(engine.validate({ type: 'catalogue.add', entry: { ...good, licence: { id: 'cc-by-nd' } as never } }, gm, doc)).toMatch(/licence/)
    expect(engine.validate({ type: 'catalogue.remove', id: good.id }, gm, doc)).toBeNull()
    expect(engine.validate({ type: 'catalogue.remove', id: good.id }, player, doc)).toMatch(/GM/)
  })
  it('stores the entry by id in the document and removes it', () => {
    const y = new Y.Doc()
    const env = (intent: Parameters<typeof applyIntent>[1]['intent']) => ({ id: 'i', from: 'gm' as PlayerPubkey, at: 1, intent })
    applyIntent(y, env({ type: 'catalogue.add', entry: good }))
    expect(y.getMap('catalogue').get(good.id)).toEqual(good)
    applyIntent(y, env({ type: 'catalogue.remove', id: good.id }))
    expect(y.getMap('catalogue').size).toBe(0)
  })
})

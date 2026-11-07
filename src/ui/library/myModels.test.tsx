import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AssetRef } from '@/core/assets'
import type { CatalogueEntry } from '@/core/catalogue'
import type { Prop } from '@/core/doc'
import type { PropId, SceneId } from '@/core/ids'
import { resetAssetStatus, setAssetStatus } from '@/assets/status'
import { nextUnshared, readUnshared, reshareCandidates, UNSHARED_KEY } from '@/assets/unshared'
import { MAX_TITLE, placedCopies, removalNote, renamedEntry } from './libraryLogic'
import { ManageCard } from './LibraryPanel'
import { docRefs, pendingReshares } from './reshare'

const ref = (sha: string, enc = true): AssetRef => ({
  sha256: sha as AssetRef['sha256'], kind: 'glb', mime: 'model/gltf-binary', size: 1, sources: [],
  ...(enc ? { enc: { sha256: `c-${sha}` as AssetRef['sha256'], key: 'k' } } : {}),
})
const entry = (id: string, sha: string, extra: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id, origin: 'upload', title: 'Old chest', category: 'container', tags: [], model: ref(sha), size: [1, 1, 1], triangles: 10, licence: { id: 'own-work' }, ...extra,
})
const prop = (id: string, sha: string, catalogue?: string): Prop => ({
  id: id as PropId, scene: 's' as SceneId, name: id, model: ref(sha), position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  ...(catalogue ? { catalogue } : {}),
})

afterEach(() => resetAssetStatus())

describe('My models: rename', () => {
  const chest = entry('upload:1', 'a')
  it('keeps the id and model, changes the title only', () => {
    expect(renamedEntry(chest, '  Iron   chest ')).toEqual({ ...chest, title: 'Iron chest' })
  })
  it('refuses a blank or unchanged name and caps a long one', () => {
    expect(renamedEntry(chest, '   ')).toBeNull()
    expect(renamedEntry(chest, 'Old chest')).toBeNull()
    expect(renamedEntry(chest, 'x'.repeat(200))?.title).toHaveLength(MAX_TITLE)
  })
})

describe('My models: remove', () => {
  it('says what happens to placed copies', () => {
    const props = { p1: prop('p1', 'a', 'upload:1'), p2: prop('p2', 'a', 'upload:1'), p3: prop('p3', 'b', 'other') }
    expect(placedCopies(props, 'upload:1')).toBe(2)
    expect(removalNote(0)).toMatch(/not placed/)
    expect(removalNote(1)).toMatch(/one placed copy stays/)
    expect(removalNote(2)).toBe('The 2 placed copies stay on the board.')
  })

  it('turns the card over for the menu, the rename field and an inline confirmation', () => {
    const e = entry('upload:1', 'a')
    const manage = { rename: () => {}, remove: () => {} }
    const render = (menu: 'open' | 'rename' | 'confirm') => renderToStaticMarkup(<ManageCard entry={e} style={{}} menu={menu} setMenu={() => {}} manage={manage} />)
    const menu = render('open')
    expect(menu).toContain('Rename')
    expect(menu).toContain('Remove from library')
    const rename = render('rename')
    expect(rename).toContain('value="Old chest"')
    // Save stays off until the name changes.
    expect(rename).toMatch(/<button type="submit"[^>]*disabled/)
    const confirm = render('confirm')
    expect(confirm).toContain('Remove from library?')
    expect(confirm).toContain('>Remove<')
    expect(confirm).toContain('>Keep<')
  })
})

describe('re-sharing at startup', () => {
  it('remembers unfinished uploads and forgets shared ones', () => {
    const next = nextUnshared(new Set(['old', 'done']), [['done', 'shared'], ['new', 'uploading'], ['bad', 'failed']])
    expect([...next].sort()).toEqual(['bad', 'new', 'old'])
    const store = new Map<string, string>()
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    store.set(UNSHARED_KEY, JSON.stringify(['a', 7, '', 'b']))
    expect([...readUnshared(s)]).toEqual(['a', 'b'])
    store.set(UNSHARED_KEY, '{not json')
    expect(readUnshared(s).size).toBe(0)
  })

  it('picks encrypted refs that are local, failed or remembered, once each', () => {
    const status: Record<string, 'local' | 'uploading' | 'shared' | 'failed'> = { l: 'local', f: 'failed', u: 'uploading', s: 'shared' }
    const refs = [ref('l'), ref('f'), ref('u'), ref('s'), ref('r'), ref('r'), ref('plain', false), ref('never'), null]
    const out = reshareCandidates(refs, new Set(['r', 's', 'plain']), (sha) => status[sha])
    expect(out.map((r) => r.sha256)).toEqual(['l', 'f', 'r'])
  })

  it('looks at My models (and their thumbnails) and every prop', () => {
    const doc = {
      catalogue: { 'upload:1': entry('upload:1', 'model-a', { thumbnail: ref('thumb-a') }) },
      props: { p1: prop('p1', 'model-b'), p2: prop('p2', 'model-a') },
    }
    expect(docRefs(doc).map((r) => r.sha256)).toEqual(['model-a', 'thumb-a', 'model-b', 'model-a'])
    setAssetStatus('model-b', { status: 'failed' })
    expect(pendingReshares(doc, new Set(['thumb-a'])).map((r) => r.sha256)).toEqual(['thumb-a', 'model-b'])
  })
})

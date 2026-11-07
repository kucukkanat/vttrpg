import { describe, expect, it } from 'vitest'
import type { AssetRef } from '@/core/assets'
import type { CatalogueEntry, Licence } from '@/core/catalogue'
import type { Prop } from '@/core/doc'
import type { PropId, SceneId } from '@/core/ids'
import {
  catalogueIndex, cleanIdList, libraryResults, licenceBadge, MAX_RECENT, pushRecent, sceneCatalogueIds, sceneCredits, shelfEntries,
  sizeBadge, toggleFavourite, wantsCredit, type LibrarySources,
} from './libraryLogic'

const ref = (name: string) => ({ sha256: name as AssetRef['sha256'], kind: 'glb' as const, mime: 'model/gltf-binary', size: 1, sources: [`${name}.glb`] })

function entry(id: string, title: string, extra: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    id, origin: 'builtin', title, category: 'container', tags: [], model: ref(id), size: [1, 1, 1], triangles: 100,
    licence: { id: 'cc0' }, ...extra,
  }
}

const barrel = entry('b:barrel', 'Barrel', { tags: ['cask'] })
const crate = entry('b:crate', 'Crate')
const chair = entry('b:chair', 'Chair', { category: 'furniture' })
const wall = entry('b:wall', 'Stone wall', { category: 'kit', kit: 'dungeon' })
const mine = entry('upload:abc', 'Château chest', { origin: 'upload', licence: { id: 'own-work' } })

const src = (over: Partial<LibrarySources> = {}): LibrarySources => ({
  builtin: [barrel, crate, chair, wall], mine: [mine], recent: [], favourites: [], scene: [], ...over,
})

describe('recent and favourites', () => {
  it('keeps the last 20 placed, newest first, without duplicates', () => {
    let list: string[] = []
    for (let i = 0; i < 25; i++) list = pushRecent(list, `m${i}`)
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0]).toBe('m24')
    expect(list).not.toContain('m4')
    list = pushRecent(list, 'm10')
    expect(list[0]).toBe('m10')
    expect(list.filter((x) => x === 'm10')).toHaveLength(1)
    expect(list).toHaveLength(MAX_RECENT)
  })
  it('stars and unstars', () => {
    expect(toggleFavourite([], 'a')).toEqual(['a'])
    expect(toggleFavourite(['a', 'b'], 'a')).toEqual(['b'])
  })
  it('reads stored lists defensively', () => {
    expect(cleanIdList(['a', 3, 'a', '', 'b'])).toEqual(['a', 'b'])
    expect(cleanIdList('nope')).toEqual([])
    expect(cleanIdList(['a', 'b', 'c'], 2)).toEqual(['a', 'b'])
  })
})

describe('shelves and search', () => {
  it('lists each shelf, the id shelves in their own order', () => {
    const s = src({ recent: ['b:crate', 'gone', 'b:barrel'], favourites: ['upload:abc'], scene: ['b:chair'] })
    expect(shelfEntries('recent', s).map((e) => e.id)).toEqual(['b:crate', 'b:barrel'])
    expect(shelfEntries('favourites', s)).toEqual([mine])
    expect(shelfEntries('scene', s)).toEqual([chair])
    expect(shelfEntries('mine', s)).toEqual([mine])
    expect(shelfEntries('builtin', s)).toHaveLength(4)
    expect(shelfEntries('all', s)).toHaveLength(5)
  })
  it('hides kit pieces unless the Kit pieces chip is on', () => {
    const all = libraryResults(src(), { shelf: 'all', query: '', category: null, kit: false })
    expect(all.map((e) => e.id)).not.toContain('b:wall')
    expect(libraryResults(src(), { shelf: 'all', query: '', category: null, kit: true })).toEqual([wall])
  })
  it('searches titles and tags, accent-insensitively, within a category', () => {
    expect(libraryResults(src(), { shelf: 'all', query: 'cask', category: null, kit: false })).toEqual([barrel])
    expect(libraryResults(src(), { shelf: 'all', query: 'chateau', category: null, kit: false })).toEqual([mine])
    expect(libraryResults(src(), { shelf: 'all', query: '', category: 'furniture', kit: false })).toEqual([chair])
  })
  it('keeps the recent order with no query', () => {
    const s = src({ recent: ['b:crate', 'b:barrel'] })
    expect(libraryResults(s, { shelf: 'recent', query: '', category: null, kit: false }).map((e) => e.title)).toEqual(['Crate', 'Barrel'])
  })
  it('indexes the game’s own models over a built-in with the same id', () => {
    const own = { ...barrel, title: 'My barrel' }
    expect(catalogueIndex([barrel], [own]).get('b:barrel')?.title).toBe('My barrel')
  })
})

describe('badges', () => {
  it('shows the footprint in cells and the height', () => {
    expect(sizeBadge([1.023, 1.35, 0.98])).toBe('1×1 cell · 1.4 m')
    expect(sizeBadge([1.2, 1.1, 2.9])).toBe('1×2 cells · 1.1 m')
    expect(sizeBadge([0.47, 0.35, 0.47])).toBe('1×1 cell · 0.35 m')
    expect(sizeBadge([4.4, 12.4, 3.1])).toBe('3×2 cells · 12 m')
    expect(sizeBadge([1.55, 2, 1.5])).toBe('1×1 cell · 2 m')
    expect(sizeBadge([2, 1, 2], 1)).toBe('2×2 cells · 1 m')
  })
  it('badges every licence but CC0', () => {
    const l = (id: Licence['id']) => licenceBadge({ licence: { id } })
    expect(l('cc0')).toBeNull()
    expect(l('cc-by')).toBe('CC BY')
    expect(l('cc-by-sa')).toBe('CC BY-SA')
    expect(l('own-work')).toBe('Own work')
  })
})

describe('scene credits', () => {
  const scene = 's1' as SceneId
  const prop = (id: string, catalogue: string | undefined, sc: SceneId = scene): Prop => ({
    id: id as PropId, scene: sc, name: id, model: ref(id), position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    ...(catalogue ? { catalogue } : {}),
  })
  const byBy = entry('sketchfab:1', 'Lantern', { origin: 'sketchfab', licence: { id: 'cc-by', author: 'Ann', sourceUrl: 'https://sketchfab.com/x' } })
  const sa = entry('upload:2', 'Altar', { origin: 'upload', licence: { id: 'cc-by-sa', author: 'Bo' } })
  const ph = entry('polyhaven:3', 'Bench', { origin: 'polyhaven', licence: { id: 'cc0', author: 'Poly Haven' } })
  const lookup = (id: string) => [barrel, crate, byBy, sa, ph].find((e) => e.id === id)

  it('lists CC BY, CC BY-SA, Poly Haven and Sketchfab models in the scene, once each, by title', () => {
    const props = Object.fromEntries([
      prop('p1', 'b:barrel'), prop('p2', 'sketchfab:1'), prop('p3', 'sketchfab:1'), prop('p4', 'upload:2'),
      prop('p5', 'polyhaven:3'), prop('p6', undefined), prop('p7', 'unknown'), prop('p8', 'upload:2', 's2' as SceneId),
    ].map((p) => [p.id, p]))
    const out = sceneCredits(props, scene, lookup)
    expect(out.credits.map((e) => e.title)).toEqual(['Altar', 'Bench', 'Lantern'])
    expect(out.models).toBe(4)
    expect(sceneCatalogueIds(props, scene)[0]).toBe('sketchfab:1')
  })
  it('is empty when everything is CC0 from the built-in library', () => {
    const props = Object.fromEntries([prop('p1', 'b:barrel'), prop('p2', 'b:crate')].map((p) => [p.id, p]))
    expect(sceneCredits(props, scene, lookup)).toEqual({ credits: [], models: 2 })
    expect(sceneCredits(props, null, lookup)).toEqual({ credits: [], models: 0 })
  })
  it('credits own work only when it comes from an outside source', () => {
    expect(wantsCredit(mine)).toBe(false)
    expect(wantsCredit(ph)).toBe(true)
  })
})

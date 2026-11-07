import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogueEntry } from '@/core/catalogue'
import type { AssetHash } from '@/core/ids'
import { catalogueCategories, catalogueThumbnailUrl, normalizeSearch, searchCatalogue } from './catalogue'

function entry(title: string, category: string, tags: string[] = [], extra: Partial<CatalogueEntry> = {}): CatalogueEntry {
  const slug = normalizeSearch(title).replace(/ /g, '-')
  return {
    id: `builtin:models/test/${slug}.glb`,
    origin: 'builtin',
    title,
    category,
    tags,
    model: { sha256: slug as AssetHash, kind: 'glb', mime: 'model/gltf-binary', size: 1, name: `${slug}.glb`, sources: [`models/test/${slug}.glb`] },
    size: [1, 1, 1],
    triangles: 100,
    licence: { id: 'cc0' },
    thumbnail: `models/test/${slug}.webp`,
    ...extra,
  }
}

const ENTRIES = [
  entry('Large barrel', 'container', ['barrel', 'cask', 'keg']),
  entry('Barrel with goods', 'container', ['barrel', 'cask']),
  entry('Keg on a stand', 'container', ['ale', 'beer', 'barrel', 'cask']),
  entry('Crate', 'container', ['box']),
  entry('Wooden chair', 'furniture', ['seat'], { theme: 'tavern' }),
  entry('Bar stool', 'furniture', ['seat'], { theme: 'tavern' }),
  entry('Jack-o’-lantern', 'light', ['pumpkin', 'carved']),
  entry('Café table', 'furniture', ['table']),
  entry('Stone wall', 'kit', ['wall'], { kit: 'kaykit-dungeon' }),
  entry('Plaster wall', 'kit', ['wall'], { kit: 'kenney-town' }),
  entry('Low stone wall', 'structure', ['boundary']),
]

const titles = (list: CatalogueEntry[]) => list.map((e) => e.title)

describe('normalizeSearch', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeSearch('  Café, CRÈME-brûlée! ')).toBe('cafe creme brulee')
    expect(normalizeSearch('Jack-o’-lantern')).toBe('jack o lantern')
  })
})

describe('searchCatalogue', () => {
  it('ranks a title match above a tag-only match', () => {
    const r = titles(searchCatalogue(ENTRIES, 'barrel'))
    expect(r.slice(0, 2).sort()).toEqual(['Barrel with goods', 'Large barrel'])
    expect(r[2]).toBe('Keg on a stand')
    expect(r).not.toContain('Crate')
  })

  it('finds synonyms carried in tags', () => {
    expect(titles(searchCatalogue(ENTRIES, 'cask'))).toEqual(expect.arrayContaining(['Large barrel', 'Barrel with goods', 'Keg on a stand']))
    expect(titles(searchCatalogue(ENTRIES, 'keg'))[0]).toBe('Keg on a stand')
  })

  it('matches prefixes and is case- and accent-insensitive', () => {
    expect(titles(searchCatalogue(ENTRIES, 'BARR'))).toContain('Large barrel')
    expect(titles(searchCatalogue(ENTRIES, 'cafe'))).toEqual(['Café table'])
    expect(titles(searchCatalogue(ENTRIES, 'Café'))).toEqual(['Café table'])
    expect(titles(searchCatalogue(ENTRIES, 'jack o lantern'))).toEqual(['Jack-o’-lantern'])
  })

  it('requires every query word to match', () => {
    expect(titles(searchCatalogue(ENTRIES, 'stone wall')).sort()).toEqual(['Low stone wall', 'Stone wall'])
    expect(searchCatalogue(ENTRIES, 'stone barrel')).toEqual([])
  })

  it('puts an exact title first', () => {
    expect(titles(searchCatalogue(ENTRIES, 'stone wall'))[0]).toBe('Stone wall')
  })

  it('searches the category', () => {
    expect(titles(searchCatalogue(ENTRIES, 'furniture')).sort()).toEqual(['Bar stool', 'Café table', 'Wooden chair'])
  })

  it('filters by category, theme and kit', () => {
    expect(titles(searchCatalogue(ENTRIES, '', { category: 'light' }))).toEqual(['Jack-o’-lantern'])
    expect(titles(searchCatalogue(ENTRIES, '', { category: ['light', 'structure'] })).sort()).toEqual(['Jack-o’-lantern', 'Low stone wall'])
    expect(titles(searchCatalogue(ENTRIES, 'seat', { theme: 'tavern' })).sort()).toEqual(['Bar stool', 'Wooden chair'])
    expect(titles(searchCatalogue(ENTRIES, 'wall', { kit: true })).sort()).toEqual(['Plaster wall', 'Stone wall'])
    expect(titles(searchCatalogue(ENTRIES, 'wall', { kit: false }))).toEqual(['Low stone wall'])
    expect(titles(searchCatalogue(ENTRIES, 'wall', { kit: 'kenney-town' }))).toEqual(['Plaster wall'])
  })

  it('returns everything by title for an empty query', () => {
    const r = searchCatalogue(ENTRIES, '   ')
    expect(r).toHaveLength(ENTRIES.length)
    expect(titles(r)).toEqual([...titles(r)].sort((a, b) => a.localeCompare(b)))
  })

  it('does not mutate its input', () => {
    const copy = [...ENTRIES]
    searchCatalogue(ENTRIES, 'barrel')
    expect(ENTRIES).toEqual(copy)
  })
})

describe('catalogueCategories', () => {
  it('counts shelves, most populated first', () => {
    expect(catalogueCategories(ENTRIES)[0]).toEqual({ category: 'container', count: 4 })
  })
})

describe('loadBuiltinCatalogue', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('resolves model sources and thumbnails against the library URL', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.test/vttrpg/' } })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [entry('Crate', 'container')] })))
    const { loadBuiltinCatalogue } = await import('./catalogue')
    const [e] = await loadBuiltinCatalogue()
    expect(e!.model.sources[0]).toMatch(/^https:\/\/example\.test\/.*library\/models\/test\/crate\.glb$/)
    expect(catalogueThumbnailUrl(e!)).toMatch(/^https:\/\/example\.test\/.*library\/models\/test\/crate\.webp$/)
  })

  it('gives an empty list when the file is missing', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.test/' } })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    const { loadBuiltinCatalogue } = await import('./catalogue')
    expect(await loadBuiltinCatalogue()).toEqual([])
  })
})

describe('shipped catalogue.json', () => {
  const shipped = JSON.parse(readFileSync(resolve(__dirname, '../../public/library/catalogue.json'), 'utf8')) as CatalogueEntry[]

  it('finds barrels first for "barrel"', () => {
    const r = searchCatalogue(shipped, 'barrel').slice(0, 5)
    expect(r.length).toBe(5)
    for (const e of r) expect(e.title.toLowerCase()).toContain('barrel')
  })

  it('finds kit walls and doors', () => {
    expect(searchCatalogue(shipped, 'wall', { kit: 'kaykit-dungeon' }).length).toBeGreaterThan(10)
    expect(searchCatalogue(shipped, 'door', { kit: true }).length).toBeGreaterThan(3)
  })
})

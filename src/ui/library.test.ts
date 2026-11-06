import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LibraryEntry } from '@/assets'
import { libraryCategory, libraryModels } from './library'

const index = JSON.parse(readFileSync(resolve(__dirname, '../../public/library/index.json'), 'utf8')) as (LibraryEntry & { category?: string })[]

const entry = (path: string, extra: Partial<LibraryEntry> & { category?: string } = {}): LibraryEntry & { category?: string } => ({
  sha256: path, path, kind: path.endsWith('.glb') ? 'glb' : 'json', mime: '', size: 1, name: path.split('/').pop()!, license: 'CC0-1.0', ...extra,
})

describe('libraryCategory', () => {
  it('reads the index field and falls back to the folder for older indexes', () => {
    expect(libraryCategory(entry('scenes/tavern.glb', { category: 'scene' }))).toBe('scene')
    expect(libraryCategory(entry('scenes/tavern.glb'))).toBe('scene')
    expect(libraryCategory(entry('props/crate.glb'))).toBe('prop')
    expect(libraryCategory(entry('minis/rat.glb', { category: 'mini' }))).toBe('mini')
    expect(libraryCategory(entry('placeholder.json'))).toBeUndefined()
    expect(libraryCategory(entry('audio/rain.ogg'))).toBeUndefined()
    expect(libraryCategory(entry('scenes/odd.glb', { category: 'nonsense' }))).toBe('scene')
  })
})

describe('libraryModels', () => {
  const entries = [
    entry('scenes/tavern.glb', { category: 'scene' }),
    entry('props/crate.glb', { category: 'prop' }),
    entry('props/notes.json', { category: 'prop' }),
    entry('minis/rat.glb', { category: 'mini' }),
    entry('placeholder.json'),
  ]

  it('never lists a scene in the prop or mini pickers', () => {
    expect(libraryModels(entries, 'prop').map((e) => e.path)).toEqual(['props/crate.glb'])
    expect(libraryModels(entries, 'mini').map((e) => e.path)).toEqual(['minis/rat.glb'])
    expect(libraryModels(entries, 'scene').map((e) => e.path)).toEqual(['scenes/tavern.glb'])
  })

  it('only returns GLBs', () => {
    expect(libraryModels(entries, 'prop').some((e) => e.kind !== 'glb')).toBe(false)
  })
})

describe('shipped index.json', () => {
  it('tags every model with the category of its folder', () => {
    const models = index.filter((e) => e.kind === 'glb')
    expect(models.length).toBeGreaterThanOrEqual(17)
    for (const e of models) {
      const folder = e.path.split('/')[0]
      const expected = folder === 'scenes' ? 'scene' : folder === 'props' ? 'prop' : folder === 'minis' ? 'mini' : undefined
      expect(e.category, e.path).toBe(expected)
    }
    expect(libraryModels(index, 'prop').length).toBeGreaterThanOrEqual(8)
    expect(libraryModels(index, 'mini').length).toBeGreaterThanOrEqual(3)
    expect(libraryModels(index, 'prop').concat(libraryModels(index, 'mini')).some((e) => e.path.startsWith('scenes/'))).toBe(false)
  })
})

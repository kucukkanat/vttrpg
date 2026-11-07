import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildGlossary, linkTerms } from '@/ui/tips/glossary'
import { guardChargen, guardGlossary, guardManifest, guardSheet, guardSkill, loadPack, resolvePackUrl } from './load'
import { fileFetch, loadMausritter } from './test-helpers'

describe('loadPack', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads the Mausritter pack from disk', async () => {
    const pack = await loadMausritter()
    expect(pack.manifest.id).toBe('mausritter')
    expect(pack.manifest.resolution).toEqual({ kind: 'roll-under', die: 'd20' })
    expect(pack.attributes.map((a) => a.id)).toEqual(['str', 'dex', 'wil'])
    expect(pack.resources.map((r) => r.id)).toEqual(['hp', 'pips'])
    expect(pack.conditions.map((c) => c.id)).toEqual(['exhausted', 'frightened', 'hungry', 'injured', 'drained'])
    expect(pack.skills.map((s) => s.id).sort()).toEqual(['attack', 'fireball', 'heal', 'magic-missile'])
    expect(pack.chargen?.steps.length).toBeGreaterThan(5)
    expect(Object.keys(pack.chargen!.tables.background.rows)).toHaveLength(36)
    expect(Object.keys(pack.chargen!.tables.detail.rows)).toHaveLength(36)
  })

  it('uses the global fetch by default', async () => {
    const spy = vi.fn(fileFetch)
    vi.stubGlobal('fetch', spy)
    const pack = await loadPack('packs/mausritter')
    expect(pack.skills).toHaveLength(4)
    expect(spy).toHaveBeenCalledWith('packs/mausritter/pack.json')
    expect(spy).toHaveBeenCalledWith('packs/mausritter/skills/fireball.json')
  })

  it('loads each built-in pack glossary, and every skill description links at least one term', async () => {
    for (const id of ['mausritter', 'dnd5e']) {
      const pack = await loadPack(`packs/${id}/`, fileFetch)
      expect(pack.glossary?.length).toBeGreaterThan(3)
      const g = buildGlossary(pack)
      for (const s of pack.skills) expect(linkTerms(s.description, g).some((p) => p.id), `${id}/${s.id}`).toBe(true)
    }
  })

  it('rejects a malformed glossary entry', () => {
    expect(() => guardGlossary([{ id: 'x', text: 'no term' }], 'glossary.json')).toThrow(/"term" required/)
    expect(() => guardGlossary([{ id: 'x', term: 'X', text: 't', aliases: 'nope' }], 'glossary.json')).toThrow(/aliases/)
    expect(guardGlossary([{ id: 'x', term: 'X', text: 't', aliases: ['ex'] }], 'glossary.json')).toHaveLength(1)
  })

  it('resolves file paths against the base url', () => {
    expect(resolvePackUrl('packs/mausritter/', 'sheet.json')).toBe('packs/mausritter/sheet.json')
    expect(resolvePackUrl('packs/mausritter', './skills/x.json')).toBe('packs/mausritter/skills/x.json')
    expect(resolvePackUrl('https://example.org/p/', 'a.json')).toBe('https://example.org/p/a.json')
    expect(resolvePackUrl('packs/x/', 'https://cdn.example.org/a.json')).toBe('https://cdn.example.org/a.json')
  })

  it('reports missing files and bad JSON with the file name', async () => {
    await expect(loadPack('packs/nope/', fileFetch)).rejects.toThrow(/pack\.json: HTTP 404/)
    const broken: typeof fileFetch = async (url) =>
      url.endsWith('sheet.json') ? { ok: true, status: 200, json: async () => { throw new SyntaxError('x') } } : fileFetch(url)
    await expect(loadPack('packs/mausritter/', broken)).rejects.toThrow(/sheet\.json: invalid JSON/)
  })

  it('rejects a skill whose expression does not parse', async () => {
    const bad: typeof fileFetch = async (url) =>
      url.endsWith('heal.json')
        ? { ok: true, status: 200, json: async () => ({ id: 'heal', name: 'Heal', description: '', target: { kind: 'self' }, effects: [{ kind: 'heal', formula: '2d6 +', resource: 'hp' }], vfx: [] }) }
        : fileFetch(url)
    await expect(loadPack('packs/mausritter/', bad)).rejects.toThrow(/heal\.json: effects\[0\]\.formula/)
  })
})

describe('guards', () => {
  const manifest = {
    id: 'x', name: 'X', version: '1', grid: { type: 'square', cellSize: 1 },
    files: { attributes: 'a', resources: 'r', conditions: 'c', sheet: 's' },
  }
  it('validate the manifest', () => {
    expect(guardManifest(manifest).id).toBe('x')
    expect(() => guardManifest({ ...manifest, grid: { type: 'octagon', cellSize: 1 } })).toThrow(/grid/)
    expect(() => guardManifest({ ...manifest, resolution: { kind: 'roll-under' } })).toThrow(/resolution/)
    expect(() => guardManifest({ ...manifest, files: { attributes: 'a' } })).toThrow(/files\.resources/)
    expect(() => guardManifest({ ...manifest, files: { ...manifest.files, skills: 'skills/a.json' } })).toThrow(/skills/)
  })
  it('validate sheets', () => {
    expect(() => guardSheet({ sections: [{ title: 'A', fields: [{ kind: 'dial', bind: 'x', label: 'x' }] }] }, 'sheet.json')).toThrow(/unknown field kind/)
    expect(() => guardSheet({ sections: [{ title: 'A', fields: [{ kind: 'roll', label: 'x', formula: 'd20 <' }] }] }, 'sheet.json')).toThrow(/formula/)
    expect(() => guardSheet({ sections: [{ title: 'A', fields: [{ kind: 'inventory-grid', bind: 'i', label: 'x', cols: 1, rows: 1, slotLabels: ['a', 'b'] }] }] }, 'sheet.json')).toThrow(/slotLabels/)
  })
  it('validate skills', () => {
    const skill = { id: 's', name: 'S', description: '', target: { kind: 'single', range: 1 }, effects: [], vfx: [] }
    expect(guardSkill(skill, 'f').id).toBe('s')
    expect(() => guardSkill({ ...skill, target: { kind: 'radius', range: 1 } }, 'f')).toThrow(/radius/)
    expect(() => guardSkill({ ...skill, effects: [{ kind: 'zap' }] }, 'f')).toThrow(/unknown effect kind/)
    expect(() => guardSkill({ ...skill, effects: [{ kind: 'message', text: 'hi {1 +}' }] }, 'f')).toThrow(/text/)
    expect(() => guardSkill({ ...skill, vfx: [{ at: 0, preset: 'confetti' }] }, 'f')).toThrow(/preset/)
    expect(() => guardSkill({ ...skill, cost: [{ resource: 'hp', amount: 1 }] }, 'f')).toThrow(/amount/)
  })
  it('validate chargen', () => {
    expect(() => guardChargen({ steps: [{ id: 'a', title: 'A', table: 'missing' }], tables: {} }, 'c')).toThrow(/unknown table/)
    expect(() => guardChargen({ steps: [], tables: { t: { die: 'd6', rows: { x: {} } } } }, 'c')).toThrow(/row key/)
    expect(() => guardChargen({ steps: [{ id: 'a', title: 'A', assign: { x: 'd6 +' } }], tables: {} }, 'c')).toThrow(/assign\.x/)
    expect(guardChargen({ steps: [{ id: 'a', title: 'A', choose: { bind: 'x', options: ['p'] } }], tables: { t: { die: 'd66', rows: { '11': {} } } } }, 'c').steps).toHaveLength(1)
  })
})

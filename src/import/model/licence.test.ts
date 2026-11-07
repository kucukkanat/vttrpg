import { describe, expect, it } from 'vitest'
import { attributionExtras, creditLine, mapSketchfabLicence, SKETCHFAB_LICENCE_SLUGS, sketchfabSlug, validateLicence } from './licence'
import { ModelImportError } from './types'

describe('Sketchfab licence mapping', () => {
  it('maps only cc0, by and by-sa to importable licences', () => {
    const allowed = Object.entries(SKETCHFAB_LICENCE_SLUGS).filter(([, v]) => v).map(([k]) => k)
    expect(allowed.sort()).toEqual(['by', 'by-sa', 'cc0'])
    expect(mapSketchfabLicence({ slug: 'by' })).toBe('cc-by')
    expect(mapSketchfabLicence({ slug: 'by-sa' })).toBe('cc-by-sa')
    expect(mapSketchfabLicence({ slug: 'cc0' })).toBe('cc0')
    for (const s of ['by-nd', 'by-nc', 'by-nc-sa', 'by-nc-nd', 'free-st', 'st', 'ed', 'unknown']) expect(mapSketchfabLicence({ slug: s })).toBeNull()
  })

  it('reads the slug from the uid or the label when search results omit it', () => {
    expect(sketchfabSlug({ uid: '7c23a1ba438d4306920229c12afcb5f9', label: 'CC0 Public Domain' })).toBe('cc0')
    expect(sketchfabSlug({ uri: 'https://api.sketchfab.com/v3/licenses/322a749bcfa841b29dff1e8a1bb74b0b' })).toBe('by')
    expect(sketchfabSlug({ label: 'CC Attribution-ShareAlike' })).toBe('by-sa')
    expect(mapSketchfabLicence({ label: 'CC Attribution-NonCommercial' })).toBeNull()
    expect(mapSketchfabLicence({ label: 'Free Standard' })).toBeNull()
    expect(mapSketchfabLicence(null)).toBeNull()
  })
})

describe('validateLicence', () => {
  it('accepts the shareable licences', () => {
    expect(validateLicence({ id: 'cc0' })).toEqual({ id: 'cc0' })
    expect(validateLicence({ id: 'own-work' })).toEqual({ id: 'own-work' })
    expect(validateLicence({ id: 'cc-by', author: '  Ann ', sourceUrl: 'https://example.com/m' })).toEqual({ id: 'cc-by', author: 'Ann', sourceUrl: 'https://example.com/m' })
  })

  it('rejects licences that forbid redistribution or derivatives', () => {
    for (const id of ['cc-by-nc', 'cc-by-nd', 'standard', 'editorial', '', 'CC0']) {
      expect(() => validateLicence({ id })).toThrow(ModelImportError)
    }
  })

  it('requires the author for cc-by and cc-by-sa', () => {
    expect(() => validateLicence({ id: 'cc-by' })).toThrow(/author/)
    expect(() => validateLicence({ id: 'cc-by-sa', author: '   ' })).toThrow(/author/)
    expect(() => validateLicence({ id: 'cc0' })).not.toThrow()
  })

  it('drops URLs that are not http(s)', () => {
    expect(validateLicence({ id: 'cc0', sourceUrl: 'javascript:alert(1)', authorUrl: 'not a url' })).toEqual({ id: 'cc0' })
  })
})

describe('attribution', () => {
  it('writes a TASL credit line and the GLB extras', () => {
    const l = { id: 'cc-by' as const, author: 'Ann', source: 'Sketchfab', sourceUrl: 'https://sketchfab.com/3d-models/x' }
    expect(creditLine('Chair', l)).toBe('"Chair" by Ann, CC BY 4.0, via Sketchfab, optimised and converted')
    const extras = attributionExtras('Chair', l, new Date('2026-11-07T10:00:00Z'))
    expect(extras.licence).toEqual(l)
    expect(extras.attribution).toMatchObject({ title: 'Chair', author: 'Ann', spdx: 'CC-BY-4.0', retrieved: '2026-11-07', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' })
  })
})

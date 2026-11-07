import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { assignOwnerShapes, OWNER_SHAPES, ownerShapeIn, shapePoints } from './ownerShape'
import { OwnerShapeGlyph } from './OwnerShapeGlyph'

const pk = (c: string) => c.repeat(64)

describe('assignOwnerShapes', () => {
  it('gives up to six players distinct shapes and leaves the GM out', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f'].map(pk)
    const m = assignOwnerShapes([...players, pk('g')], pk('g'))
    expect(m.size).toBe(6)
    expect(new Set(m.values()).size).toBe(6)
    expect(m.has(pk('g'))).toBe(false)
  })
  it('is the same whatever order the players come in', () => {
    const players = ['a', 'b', 'c'].map(pk)
    expect([...assignOwnerShapes(players)]).toEqual([...assignOwnerShapes([...players].reverse())].sort((x, y) => x[0].localeCompare(y[0])))
  })
  it('repeats shapes only past six players', () => {
    const m = assignOwnerShapes(['a', 'b', 'c', 'd', 'e', 'f', 'h'].map(pk))
    expect(m.size).toBe(7)
    expect(new Set(m.values()).size).toBe(6)
  })
})

describe('ownerShapeIn', () => {
  const gm = pk('g')
  const tokens = { t1: { owner: pk('a') }, t2: { owner: pk('b') }, t3: { owner: gm }, t4: {} }
  it('reads the shape from token owners in the document; the GM and unowned tokens get none', () => {
    const a = ownerShapeIn({ tokens, meta: { gm } }, pk('a'))
    const b = ownerShapeIn({ tokens, meta: { gm } }, pk('b'))
    expect(a && OWNER_SHAPES.includes(a)).toBe(true)
    expect(a).not.toBe(b)
    expect(ownerShapeIn({ tokens, meta: { gm } }, gm)).toBeNull()
    expect(ownerShapeIn({ tokens, meta: { gm } }, undefined)).toBeNull()
  })
})

describe('shape outlines', () => {
  it('draws every shape but the circle as a polygon, and the glyph as SVG', () => {
    expect(shapePoints('circle')).toBeNull()
    expect(shapePoints('triangle')).toHaveLength(3)
    expect(shapePoints('star')).toHaveLength(10)
    const svg = renderToStaticMarkup(createElement(OwnerShapeGlyph, { shape: 'diamond', color: '#7cc4ff', title: 'diamond' }))
    expect(svg).toContain('<polygon')
    expect(svg).toContain('aria-label="diamond"')
  })
})

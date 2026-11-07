import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { ConditionDef, GlossaryTerm, ResourceDef } from '@/core/pack'
import type { SkillId, TokenId } from '@/core/ids'
import { buildGlossary, linkTerms } from './glossary'
import { placeTip, stepTips, type Tip, type TipContent } from './tips'
import { previewCells, ShapePreview } from './ShapePreview'
import { mergeHandlers } from './useTipTrigger'
import { shapeLine } from './TipLayer'

const conditions = [
  { id: 'prone', name: 'Prone', description: 'Lying down. Attacks from nearby have Advantage.' },
] as ConditionDef[]
const resources = [{ id: 'hp', name: 'Hit points', max: '10', resetOn: 'longRest' }] as ResourceDef[]
const glossaryTerms: GlossaryTerm[] = [
  { id: 'adv', term: 'Advantage', aliases: ['advantaged'], text: 'Roll two d20 and keep the higher. Cancels with Disadvantage.' },
  { id: 'dis', term: 'Disadvantage', text: 'Roll two d20 and keep the lower.' },
  { id: 'prone-more', term: 'prone', text: 'Standing up costs half your speed.' },
]

describe('buildGlossary', () => {
  const g = buildGlossary({ glossary: glossaryTerms, conditions, resources })
  it('collects pack terms, conditions, resources and the table words', () => {
    expect(g.entries.get('term:adv')?.term).toBe('Advantage')
    expect(g.entries.get('resource:hp')?.text).toMatch(/long rest/)
    expect(g.entries.get('table:burst')).toBeDefined()
    expect(g.byName.get('advantaged')).toBe('term:adv')
  })
  it('folds a pack term that names a condition into the condition instead of a twin', () => {
    expect(g.entries.has('term:prone-more')).toBe(false)
    expect(g.entries.get('condition:prone')?.text).toMatch(/Lying down\. .*Standing up costs half your speed\./)
  })
  it('is empty-safe', () => {
    const empty = buildGlossary(null)
    expect(empty.entries.size).toBe(2) // the table words
    expect(linkTerms('', empty)).toEqual([])
  })
})

describe('linkTerms', () => {
  const g = buildGlossary({ glossary: glossaryTerms, conditions, resources })
  it('links the first mention of each term, whole words only, any case', () => {
    const parts = linkTerms('With advantage you roll twice; advantage again. Disadvantaged? No: disadvantage.', g)
    expect(parts.filter((p) => p.id).map((p) => [p.text, p.id])).toEqual([['advantage', 'term:adv'], ['disadvantage', 'term:dis']])
    expect(parts.map((p) => p.text).join('')).toBe('With advantage you roll twice; advantage again. Disadvantaged? No: disadvantage.')
  })
  it('prefers the longest spelling and never links an entry to itself', () => {
    expect(linkTerms('You are advantaged.', g).find((p) => p.id)?.text).toBe('advantaged')
    expect(linkTerms('Prone means Advantage.', g, 'condition:prone').filter((p) => p.id).map((p) => p.id)).toEqual(['term:adv'])
  })
})

describe('stepTips', () => {
  const skill: TipContent = { kind: 'skill', skill: 'fireball' as SkillId, token: 't' as TokenId }
  const cond: TipContent = { kind: 'condition', condition: 'prone' }
  const term: TipContent = { kind: 'term', id: 'term:adv' }
  const a = { x: 0, y: 0, w: 10, h: 10 }
  const tip = (content: TipContent) => ({ content, anchor: a })
  it('hover shows and unhover hides, unless something is pinned', () => {
    const shown = stepTips([], { type: 'hover', tip: tip(skill) })
    expect(shown).toEqual([{ content: skill, anchor: a, pinned: false }])
    expect(stepTips(shown, { type: 'unhover' })).toEqual([])
    const pinned = stepTips([], { type: 'pin', tip: tip(cond) })
    expect(stepTips(pinned, { type: 'hover', tip: tip(skill) })).toEqual(pinned)
    expect(stepTips(pinned, { type: 'unhover' })).toEqual(pinned)
  })
  it('a tap on a hover tip pins it; pinning the same thing again closes it', () => {
    const shown = stepTips([], { type: 'hover', tip: tip(cond) })
    expect(stepTips(shown, { type: 'pinTop' })[0]!.pinned).toBe(true)
    const pinned = stepTips(shown, { type: 'pin', tip: tip(cond) })
    expect(pinned[0]!.pinned).toBe(true)
    expect(stepTips(pinned, { type: 'pin', tip: tip(cond) })).toEqual([])
  })
  it('nests one level deep at most and closes from the top', () => {
    const base = stepTips([], { type: 'hover', tip: tip(skill) })
    const nested: Tip[] = stepTips(base, { type: 'nest', tip: tip(term) })
    expect(nested.map((t) => [t.content.kind, t.pinned])).toEqual([['skill', true], ['term', true]])
    const again = stepTips(nested, { type: 'nest', tip: tip({ kind: 'term', id: 'term:dis' }) })
    expect(again).toHaveLength(2)
    expect(again[1]!.content).toEqual({ kind: 'term', id: 'term:dis' })
    expect(stepTips(again, { type: 'closeTop' }).map((t) => t.content.kind)).toEqual(['skill'])
    expect(stepTips(again, { type: 'closeAll' })).toEqual([])
  })
})

describe('placeTip', () => {
  const vp = { w: 400, h: 800 }
  it('sits above the anchor, centred, when there is room', () => {
    expect(placeTip({ x: 150, y: 700, w: 100, h: 40 }, { w: 200, h: 120 }, vp)).toEqual({ left: 100, top: 700 - 8 - 120, above: true })
  })
  it('drops below near the top and stays inside the viewport sideways', () => {
    const p = placeTip({ x: 380, y: 20, w: 20, h: 20 }, { w: 200, h: 120 }, vp)
    expect(p.above).toBe(false)
    expect(p.top).toBe(48)
    expect(p.left).toBe(400 - 8 - 200)
  })
})

describe('shape previews', () => {
  it('cover the cells the table would: a burst around the aim, a cone and a line ahead of the caster', () => {
    const burst = previewCells({ kind: 'radius', radius: 1, range: 6 })
    expect(burst.length).toBeGreaterThanOrEqual(5)
    const cone = previewCells({ kind: 'cone', range: 3, angle: 90 })
    expect(cone.every((c) => c.r < 2)).toBe(true)
    const line = previewCells({ kind: 'line', range: 4, width: 1 })
    expect(line.map((c) => c.q)).toEqual(line.map(() => 0))
    expect(previewCells({ kind: 'single', range: 12 })).toHaveLength(1)
    expect(previewCells({ kind: 'self' })).toEqual([{ q: 0, r: 2 }])
  })
  it('render an SVG labelled with the real numbers', () => {
    const html = renderToStaticMarkup(createElement(ShapePreview, { shape: { kind: 'radius', radius: 2, range: 6 }, label: shapeLine({ kind: 'radius', radius: 2, range: 6 }) }))
    expect(html).toContain('role="img"')
    expect(html).toContain('2-cell burst · range 6')
    expect(html).toContain('shape-preview--radius')
  })
})

describe('mergeHandlers', () => {
  it('runs both handlers for a shared event and keeps the rest', () => {
    const calls: string[] = []
    const m = mergeHandlers({ onFocus: (_e: unknown) => calls.push('a'), onBlur: (_e: unknown) => calls.push('blur') }, { onFocus: (_e: unknown) => calls.push('b'), onKeyDown: (_e: unknown) => calls.push('key') })
    m.onFocus(null)
    m.onBlur(null)
    m.onKeyDown(null)
    expect(calls).toEqual(['a', 'b', 'blur', 'key'])
  })
})

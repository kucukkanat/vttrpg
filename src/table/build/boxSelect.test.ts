import { describe, expect, it } from 'vitest'
import type { PropId } from '@/core/ids'
import { boxCatches, boxHits, rectAround, rectFrom } from './boxSelect'

describe('box select', () => {
  const box = rectFrom({ x: 100, y: 100 }, { x: 0, y: 0 })
  it('normalises the corners', () => {
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
    expect(rectAround([])).toBeNull()
    expect(rectAround([{ x: 5, y: 9 }, { x: 1, y: 2 }])).toEqual({ minX: 1, minY: 2, maxX: 5, maxY: 9 })
  })
  it('catches props mostly inside or centred inside, not ones it only grazes', () => {
    expect(boxCatches(box, { minX: 10, minY: 10, maxX: 20, maxY: 20 })).toBe(true)
    expect(boxCatches(box, { minX: 90, minY: 10, maxX: 130, maxY: 20 })).toBe(false)
    expect(boxCatches(box, { minX: 80, minY: 10, maxX: 110, maxY: 20 })).toBe(true)
    expect(boxCatches(box, { minX: -500, minY: -500, maxX: 600, maxY: 600 })).toBe(true)
    expect(boxCatches(box, { minX: 200, minY: 200, maxX: 210, maxY: 210 })).toBe(false)
  })
  it('lists the hits in order', () => {
    const items = [
      { id: 'a' as PropId, rect: { minX: 10, minY: 10, maxX: 20, maxY: 20 } },
      { id: 'b' as PropId, rect: { minX: 200, minY: 10, maxX: 220, maxY: 20 } },
      { id: 'c' as PropId, rect: { minX: 50, minY: 50, maxX: 60, maxY: 60 } },
    ]
    expect(boxHits(box, items)).toEqual(['a', 'c'])
  })
})

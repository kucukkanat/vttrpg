import { describe, expect, it } from 'vitest'
import type { TokenId } from '@/core/ids'
import { groupMoveTargets, type DragGhost } from './tableState'

const a = 'a' as TokenId
const b = 'b' as TokenId
const c = 'c' as TokenId
const d = 'd' as TokenId
const at = (id: TokenId, x: number, z: number, scene = 's1') => ({ id, scene, position: { x, z } })
const tokens = { [a]: at(a, 1, 1), [b]: at(b, 3, 1), [c]: at(c, 1, 4), [d]: at(d, 0, 0, 's2') }
const drag = (to: { x: number; z: number }, from = { x: 1, z: 1 }): DragGhost => ({ token: a, x: to.x, z: to.z, from })

describe('groupMoveTargets', () => {
  it('moves every other selected token by the dragged token\'s delta', () => {
    expect(groupMoveTargets(drag({ x: 4, z: -1 }), tokens, [a, b, c])).toEqual([
      { token: b, x: 6, z: -1 },
      { token: c, x: 4, z: 2 },
    ])
  })
  it('leaves the dragged token out: it commits its own snapped ghost position', () => {
    expect(groupMoveTargets(drag({ x: 2, z: 1 }), tokens, [a, b]).map((m) => m.token)).toEqual([b])
  })
  it('is empty when the dragged token is not part of the selection', () => {
    expect(groupMoveTargets(drag({ x: 2, z: 1 }), tokens, [b, c])).toEqual([])
    expect(groupMoveTargets(drag({ x: 2, z: 1 }), tokens, [])).toEqual([])
  })
  it('skips tokens that are missing or in another scene', () => {
    expect(groupMoveTargets(drag({ x: 2, z: 1 }), tokens, [a, d, 'ghost' as TokenId, b])).toEqual([{ token: b, x: 4, z: 1 }])
  })
  it('uses the committed start position, not the current one, as the delta origin', () => {
    // Token a was committed at (0,0) when the drag began and is now dragged to (2,2): delta (2,2).
    expect(groupMoveTargets(drag({ x: 2, z: 2 }, { x: 0, z: 0 }), tokens, [a, b])).toEqual([{ token: b, x: 5, z: 3 }])
  })
  it('yields unchanged positions for a zero delta', () => {
    expect(groupMoveTargets(drag({ x: 1, z: 1 }), tokens, [a, b])).toEqual([{ token: b, x: 3, z: 1 }])
  })
})

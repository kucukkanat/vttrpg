import { describe, expect, it } from 'vitest'
import type { GridSpec } from '@/core/geometry'
import type { TokenId } from '@/core/ids'
import { draftAt, isTouchTap, moveIntents, stepMoveTap } from './twoTapMove'

// Square cells of 1, centred on whole coordinates.
const grid: GridSpec = { type: 'square', cellSize: 1, origin: { x: 0, y: 0, z: 0 } }
const A = 'a' as TokenId
const B = 'b' as TokenId
const C = 'c' as TokenId
const at = (x: number, z: number) => ({ x, y: 0, z })

describe('stepMoveTap', () => {
  const from = { x: 0, z: 0 }
  it('previews on the first tap, commits on a second tap on the same cell', () => {
    const first = stepMoveTap(null, draftAt(grid, A, from, 3.2, 1.7))
    expect(first.kind).toBe('preview')
    if (first.kind !== 'preview') return
    expect(first.draft).toMatchObject({ token: A, x: 3, z: 2, from, cell: '3,2' })
    // A second tap anywhere inside the same cell commits the previewed spot.
    expect(stepMoveTap(first.draft, draftAt(grid, A, from, 2.8, 2.3))).toEqual({ kind: 'commit', draft: first.draft })
  })
  it('moves the preview when the second tap lands elsewhere', () => {
    const d = draftAt(grid, A, from, 3.2, 1.7)
    const r = stepMoveTap(d, draftAt(grid, A, from, 5.2, 1.7))
    expect(r.kind).toBe('preview')
    if (r.kind === 'preview') expect(r.draft.x).toBe(5)
  })
  it("cancels on a tap on the token's own cell, and never commits a draft for another token", () => {
    expect(stepMoveTap(draftAt(grid, A, from, 3, 1), draftAt(grid, A, from, 0.2, -0.3))).toEqual({ kind: 'cancel' })
    const d = draftAt(grid, A, from, 3.2, 1.7)
    expect(stepMoveTap(d, draftAt(grid, B, from, 3.2, 1.7)).kind).toBe('preview')
  })
})

describe('isTouchTap', () => {
  it('takes fingers and pens, never the mouse; falls back to the coarse-pointer query', () => {
    expect(isTouchTap({ pointerType: 'touch' }, false)).toBe(true)
    expect(isTouchTap({ pointerType: 'pen' }, false)).toBe(true)
    expect(isTouchTap({ pointerType: 'mouse' }, true)).toBe(false)
    expect(isTouchTap({}, true)).toBe(true)
    expect(isTouchTap({}, false)).toBe(false)
  })
})

describe('moveIntents', () => {
  const tok = (id: TokenId, x: number, z: number, scene = 's') => ({ id, scene, position: { x, z } })
  const tokens = { [A]: tok(A, 0, 0), [B]: tok(B, 1, 0), [C]: tok(C, 2, 0) }
  const draft = draftAt(grid, A, { x: 0, z: 0 }, 2.1, 3.1)
  it('moves the leader, and the rest of the selection by the same delta', () => {
    expect(moveIntents(draft, tokens, [A, B], () => true, grid, 0)).toEqual([
      { type: 'token.move', token: A, position: at(2, 3) },
      { type: 'token.move', token: B, position: at(3, 3) },
    ])
  })
  it('skips tokens the viewer may not move and a move that goes nowhere', () => {
    expect(moveIntents(draft, tokens, [A, B, C], (id) => id !== B, grid, 0).map((i) => i.type === 'token.move' && i.token)).toEqual([A, C])
    expect(moveIntents(draft, tokens, [A], (id) => id !== A, grid, 0)).toEqual([])
    expect(moveIntents(draftAt(grid, A, { x: 0, z: 0 }, 0.3, -0.2), tokens, [A], () => true, grid, 0)).toEqual([])
  })
})

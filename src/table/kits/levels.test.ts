import { describe, expect, it } from 'vitest'
import { pieceIndex } from './manifests'
import { effectiveCut, heightVisible, levelCellKey, levelView, onStair, standAt, tileVisible, tokenDrawY, tokenLevel } from './levels'
import { sceneOccupancy } from './occupancy'
import { planArea, planFloorRect } from './paint'
import { applyPlan, emptyTiles, KAYKIT, lookupFor } from './testKits'

const grid = { cellSize: 1.5 }

describe('cutaway', () => {
  it('follows a hand-set level, else the selected token, else the build level, else shows all', () => {
    expect(effectiveCut(2, 0, 1)).toBe(2)
    expect(effectiveCut(null, 1, 3)).toBe(1)
    expect(effectiveCut(null, null, 3)).toBe(3)
    expect(effectiveCut(null, null, null)).toBe(Infinity)
  })
  it('hides tiles above the cut level, and props and tokens that start above it', () => {
    expect(tileVisible(1, 1)).toBe(true)
    expect(tileVisible(2, 1)).toBe(false)
    expect(heightVisible(5.9, 1, 0, grid)).toBe(true)
    expect(heightVisible(6, 1, 0, grid)).toBe(false)
    expect(heightVisible(100, Infinity, 0, grid)).toBe(true)
    expect(heightVisible(0, 0, 0, grid)).toBe(true)
    expect(heightVisible(3.12, 0, 0, grid)).toBe(false)
  })
})

describe('levels of tokens and fog keys', () => {
  it('keeps level 0 keys as they were and adds the level above it', () => {
    expect(levelCellKey('3,4', 0)).toBe('3,4')
    expect(levelCellKey('3,4', 2)).toBe('3,4,2')
    const set = new Set(['1,1', '2,2,1'])
    expect(levelView(set, 0).has('1,1')).toBe(true)
    expect(levelView(set, 1).has('2,2')).toBe(true)
    expect(levelView(set, 1).has('1,1')).toBe(false)
  })
  it('reads a token level from its height; old tokens at any floor height are on level 0', () => {
    expect(tokenLevel(undefined, 0, grid)).toBe(0)
    expect(tokenLevel(0, 0.4, grid)).toBe(0)
    expect(tokenLevel(3.12, 0, grid)).toBe(1)
    expect(tokenDrawY(0, 0.4, grid)).toBe(0.4)
    expect(tokenDrawY(3.12, 0, grid)).toBe(3.12)
    expect(onStair(1.5, 0, grid)).toBe(true)
    expect(onStair(3.12, 0, grid)).toBe(false)
  })
})

describe('standing on kit floors', () => {
  const stairs = KAYKIT.pieces[pieceIndex(KAYKIT, 'stairs')]!
  const floor = KAYKIT.pieces[pieceIndex(KAYKIT, 'floor-tile-large')]!
  // An upper floor over cells 0..5 × 0..3 with stairs at (4, 1) climbing north.
  let t = emptyTiles()
  t = applyPlan(t, planFloorRect(sceneOccupancy(t, lookupFor(t)), 1, KAYKIT, floor, { x0: 0, z0: 0, x1: 5, z1: 3 }, 0))
  t = applyPlan(t, planArea(sceneOccupancy(t, lookupFor(t)), 0, KAYKIT, stairs, { x: 4, z: 1 }, 0))
  const occ = sceneOccupancy(t, lookupFor(t))

  it('cuts a stairwell and patches the big tiles around it with small ones', () => {
    expect(occ.cell(1, 4, 1, 'f')).toBeUndefined()
    expect(occ.cell(1, 5, 2, 'f')).toBeUndefined()
    expect(occ.cell(1, 4, 0, 'f')?.piece.id).toBe('floor-tile-small')
    expect(occ.cell(1, 0, 0, 'f')?.piece.id).toBe('floor-tile-large')
  })
  it('stays on its level, falls off where there is no floor, and climbs only by the stairs', () => {
    const ground = { level: 0, stair: false, x: 0, z: 2 }
    expect(standAt(occ, ground, { x: 1, z: 2 }, 0, 0, grid)).toEqual({ level: 0, y: 0, stair: false })
    const onStairs = standAt(occ, ground, { x: 4, z: 2 }, 0, 0, grid)
    expect(onStairs).toEqual({ level: 0, y: 1.5, stair: true })
    // Off the top end (north) onto the upper floor; off the bottom back to the ground.
    expect(standAt(occ, { level: 0, stair: true, x: 4, z: 1 }, { x: 4, z: 0 }, 0, 0, grid)).toMatchObject({ level: 1, stair: false })
    expect(standAt(occ, { level: 0, stair: true, x: 4, z: 2 }, { x: 4, z: 3 }, 0, 0, grid)).toMatchObject({ level: 0 })
    const up = { level: 1, stair: false, x: 1, z: 1 }
    expect(standAt(occ, up, { x: 2, z: 2 }, 1, 0, grid)).toMatchObject({ level: 1 })
    expect(standAt(occ, up, { x: 9, z: 9 }, 1, 0, grid)).toEqual({ level: 0, y: 0, stair: false })
    // The GM's cutaway at 1 drops a ground token onto the upper floor under it.
    expect(standAt(occ, ground, { x: 1, z: 1 }, 1, 0, grid)).toMatchObject({ level: 1 })
  })
})

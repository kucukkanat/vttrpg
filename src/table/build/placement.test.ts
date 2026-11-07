import { describe, expect, it } from 'vitest'
import type { AssetRef } from '@/core/assets'
import type { PropId, SceneId } from '@/core/ids'
import {
  DEFAULT_SCATTER_RANGE, MAX_SCATTER_RANGE, pickSurface, placedProp, placedProps, rollScatter, sceneSurfaceLabel, seededRandom, snapPlacement, turnHeld,
  TURN_STEP, TURN_STEP_BIG, wrapAngle, yawDegrees, type HeldModel,
} from './placement'

const grid = { type: 'square' as const, cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }
const deg = (r: number) => Math.round((r * 180) / Math.PI)

describe('snapPlacement', () => {
  it('snaps to half a cell from the grid origin', () => {
    expect(snapPlacement({ x: 0.4, z: 1.0 }, grid, 0.5)).toEqual({ x: 0.75, z: 0.75 })
    expect(snapPlacement({ x: -0.3, z: 2.0 }, grid, 0.5)).toEqual({ x: 0, z: 2.25 })
  })
  it('follows an offset origin', () => {
    const g = { ...grid, origin: { x: 0.25, y: 0, z: -0.5 } }
    expect(snapPlacement({ x: 1.1, z: 0.1 }, g, 1)).toEqual({ x: 1.75, z: -0.5 })
  })
  it('is free with Alt, a step of 0, or a grid of type none', () => {
    expect(snapPlacement({ x: 0.4, z: 1.0 }, grid, 0.5, true)).toEqual({ x: 0.4, z: 1.0 })
    expect(snapPlacement({ x: 0.4, z: 1.0 }, grid, 0)).toEqual({ x: 0.4, z: 1.0 })
    expect(snapPlacement({ x: 0.4, z: 1.0 }, { ...grid, type: 'none' }, 0.5)).toEqual({ x: 0.4, z: 1.0 })
  })
})

describe('pickSurface', () => {
  it('rests on the nearest upward-facing hit, naming the prop', () => {
    const s = pickSurface([
      { distance: 9, y: 0.4, normalY: 1, propId: 'p2', label: 'Rug' },
      { distance: 5, y: 0.8, normalY: 0.99, propId: 'p1', label: 'Table' },
    ], 0)
    expect(s).toEqual({ y: 0.8, on: 'Table', propId: 'p1' })
  })
  it('skips the sides of things and falls through to what is behind', () => {
    const s = pickSurface([
      { distance: 4, y: 0.5, normalY: 0, propId: 'p1', label: 'Table' },
      { distance: 6, y: 0.9, normalY: 1, propId: 'p3', label: 'Crate' },
    ], 0)
    expect(s.on).toBe('Crate')
    expect(s.y).toBe(0.9)
  })
  it('is the floor when nothing is hit, or only things below the floor', () => {
    expect(pickSurface([], 0.2)).toEqual({ y: 0.2, on: 'floor' })
    expect(pickSurface([{ distance: 3, y: -1, normalY: 1, propId: 'p', label: 'Cellar' }], 0)).toEqual({ y: 0, on: 'floor' })
  })
})

describe('turnHeld', () => {
  it('turns 15° per step and 90° with Shift, wrapping round', () => {
    expect(deg(turnHeld(0, 1))).toBe(15)
    expect(deg(turnHeld(0, -1))).toBe(345)
    expect(deg(turnHeld(0, 1, true))).toBe(90)
    expect(deg(turnHeld(TURN_STEP_BIG * 3, 1, true))).toBe(0)
    let yaw = 0
    for (let i = 0; i < 24; i++) yaw = turnHeld(yaw, 1)
    expect(yaw).toBeCloseTo(0)
  })
  it('lands an odd angle on the step grid first', () => {
    expect(turnHeld(TURN_STEP * 0.4, 1)).toBeCloseTo(TURN_STEP)
    expect(turnHeld(TURN_STEP * 0.4, -1)).toBeCloseTo(0)
    expect(deg(turnHeld((100 * Math.PI) / 180, 1, true))).toBe(180)
  })
  it('reads as whole degrees for the hint', () => {
    expect(yawDegrees(wrapAngle(-TURN_STEP))).toBe(345)
    expect(yawDegrees(Math.PI * 2)).toBe(0)
  })
})

describe('rollScatter', () => {
  it('rolls any yaw and a scale within the range, repeatably with a seed', () => {
    const a = seededRandom(42), b = seededRandom(42)
    for (let i = 0; i < 200; i++) {
      const r = rollScatter(a)
      expect(r).toEqual(rollScatter(b))
      expect(r.yaw).toBeGreaterThanOrEqual(0)
      expect(r.yaw).toBeLessThan(Math.PI * 2)
      expect(r.scale).toBeGreaterThanOrEqual(1 - DEFAULT_SCATTER_RANGE)
      expect(r.scale).toBeLessThanOrEqual(1 + DEFAULT_SCATTER_RANGE)
    }
  })
  it('honours a custom range and clamps silly ones', () => {
    const rnd = seededRandom(7)
    const scales = Array.from({ length: 300 }, () => rollScatter(rnd, 0.3).scale)
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.7)
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.3)
    // Spread over the range, not stuck at one end.
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.4)
    expect(rollScatter(seededRandom(1), 0).scale).toBe(1)
    const wide = Array.from({ length: 100 }, () => rollScatter(rnd, 5).scale)
    expect(Math.min(...wide)).toBeGreaterThanOrEqual(1 - MAX_SCATTER_RANGE)
  })
})

describe('placedProp', () => {
  const model = { sha256: 'abc' as AssetRef['sha256'], kind: 'glb', mime: 'model/gltf-binary', size: 10, sources: ['x.glb'] } satisfies AssetRef
  const held: HeldModel = { catalogue: 'builtin:barrel', title: 'Barrel', model, scale: { x: 1, y: 1, z: 1 } }
  it('is the catalogue model at real size, turned, named and attributed', () => {
    const p = placedProp({ id: 'p1' as PropId, scene: 's1' as SceneId, held, at: { x: 1, y: 0.8, z: 2 }, yaw: TURN_STEP_BIG, createdBy: 'gm' as never })
    expect(p).toEqual({
      id: 'p1', scene: 's1', name: 'Barrel', model, catalogue: 'builtin:barrel', createdBy: 'gm',
      position: { x: 1, y: 0.8, z: 2 }, rotation: { x: 0, y: TURN_STEP_BIG, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    })
  })
  it('applies the scatter roll on top of an eyedropped tilt and scale', () => {
    const tilted: HeldModel = { title: 'Old crate', model, tilt: { x: 0.1, z: -0.2 }, scale: { x: 2, y: 1, z: 2 } }
    const p = placedProp({ id: 'p2' as PropId, scene: 's1' as SceneId, held: tilted, at: { x: 0, y: 0, z: 0 }, yaw: Math.PI * 1.5, scatter: { yaw: Math.PI, scale: 1.1 } })
    expect(p.rotation.x).toBe(0.1)
    expect(p.rotation.z).toBe(-0.2)
    expect(p.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(p.scale).toEqual({ x: 2.2, y: 1.1, z: 2.2 })
    expect(p.catalogue).toBeUndefined()
    expect(p.createdBy).toBeUndefined()
  })
})

describe('sceneSurfaceLabel', () => {
  it('reads a scene node name, skipping generic ones', () => {
    expect(sceneSurfaceLabel(['Cube.012', 'table_long.003'])).toBe('Table long')
    expect(sceneSurfaceLabel(['BarCounter'])).toBe('Bar counter')
    expect(sceneSurfaceLabel(['Table_model'])).toBe('Table')
    expect(sceneSurfaceLabel(['Mesh_0', 'Object_7', ''])).toBeUndefined()
  })
})

describe('placedProps (a held group, e.g. a paste)', () => {
  const model = { sha256: 'abc' as AssetRef['sha256'], kind: 'glb' as const, mime: 'model/gltf-binary', size: 10, sources: ['x.glb'] } satisfies AssetRef
  const part = (x: number, y: number) => ({ title: 'Chair', model, catalogue: 'builtin:chair', offset: { x, y: 0, z: 0 }, rotation: { x: 0, y, z: 0 }, scale: { x: 1, y: 1, z: 1 } })
  const held: HeldModel = { title: '2 pasted props', model, scale: { x: 1, y: 1, z: 1 }, parts: [part(-1, 0), part(1, Math.PI / 2)] }
  let n = 0
  const makeId = () => `p${++n}` as PropId
  it('stamps every piece around the centre, turned with the group, in one batch', () => {
    const out = placedProps({ makeId, scene: 's1' as SceneId, held, at: { x: 5, y: 0.8, z: 5 }, yaw: Math.PI / 2, scatter: { yaw: 1, scale: 2 } })
    expect(out).toHaveLength(2)
    expect(out[0]!.position.x).toBeCloseTo(5)
    expect(out[0]!.position.z).toBeCloseTo(6)
    expect(out[1]!.position.z).toBeCloseTo(4)
    expect(out[0]!.position.y).toBeCloseTo(0.8)
    expect(out[1]!.rotation.y).toBeCloseTo(Math.PI)
    expect(out[0]!.scale).toEqual({ x: 1, y: 1, z: 1 })
    expect(out.every((p) => p.catalogue === 'builtin:chair')).toBe(true)
  })
  it('is one prop for a single model', () => {
    const one = placedProps({ makeId, scene: 's1' as SceneId, held: { title: 'Barrel', model, scale: { x: 1, y: 1, z: 1 } }, at: { x: 0, y: 0, z: 0 }, yaw: 0 })
    expect(one).toHaveLength(1)
  })
})

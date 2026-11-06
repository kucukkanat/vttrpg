import { describe, expect, it } from 'vitest'
import { Box3, BoxGeometry, Group, Mesh, Object3D } from 'three'
import type { GridSpec } from '@/core/geometry'
import {
  applyNodeTransform, degToRad, displayDeg, effectiveNodeTransform, footprintOfObject, footprintWalls, isIdentityTransform, mergeOverride,
  nearestNamedNode, normalizeDeg, radToDeg, readBase, resetOverride, roundTo, snapAngle, snapScale, snapTranslation,
  transformWalls,
} from './editing'
import { hasLineOfSight } from './walls'

const grid: GridSpec = { type: 'square', cellSize: 1.5, origin: { x: 0.75, y: 0, z: 0.75 } }

describe('angles', () => {
  it('converts degrees and radians both ways', () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180)
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2)
    expect(radToDeg(degToRad(37.5))).toBeCloseTo(37.5)
  })
  it('normalises degrees into (-180, 180]', () => {
    expect(normalizeDeg(190)).toBe(-170)
    expect(normalizeDeg(-190)).toBe(170)
    expect(normalizeDeg(360)).toBe(0)
    expect(normalizeDeg(180)).toBe(180)
    expect(normalizeDeg(-180)).toBe(180)
    expect(Object.is(normalizeDeg(-360), -0)).toBe(false)
  })
  it('shows tidy degrees', () => {
    expect(displayDeg(Math.PI / 2)).toBe(90)
    expect(displayDeg(-0.0000001)).toBe(0)
    expect(displayDeg(degToRad(200))).toBe(-160)
  })
  it('snaps rotation to 15 degrees', () => {
    expect(radToDeg(snapAngle(degToRad(22)))).toBeCloseTo(15)
    expect(radToDeg(snapAngle(degToRad(23)))).toBeCloseTo(30)
    expect(snapAngle(degToRad(-7))).toBe(0)
    expect(radToDeg(snapAngle(degToRad(100), 90))).toBeCloseTo(90)
  })
})

describe('snapping', () => {
  it('rounds to steps without float noise', () => {
    expect(roundTo(1.2000000000000002, 0.05)).toBe(1.2)
    expect(roundTo(-0.001, 0.05)).toBe(0)
    expect(roundTo(7, 0)).toBe(7)
  })
  it('snaps scale to 0.05 within limits', () => {
    expect(snapScale(1.23)).toBe(1.25)
    expect(snapScale(0.001)).toBe(0.05)
    expect(snapScale(999)).toBe(50)
  })
  it('snaps floor translation to half cells from the grid origin and height to 0.1', () => {
    const p = snapTranslation({ x: 1.2, y: 0.34, z: -0.1 }, grid)
    // half cell = 0.75; x: 1.2 - 0.75 = 0.45 -> 0.75 -> 1.5; z: -0.85 -> -0.75 -> 0
    expect(p.x).toBeCloseTo(1.5)
    expect(p.z).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(0.3)
  })
  it('keeps the grid origin itself fixed', () => {
    const p = snapTranslation({ x: 0.8, y: 0, z: 0.7 }, grid)
    expect(p).toEqual({ x: 0.75, y: 0, z: 0.75 })
  })
})

describe('overrides', () => {
  it('merges patches into a node override', () => {
    const o1 = mergeOverride(undefined, 'pillar', { scale: 2 })
    expect(o1).toEqual({ pillar: { scale: 2 } })
    const o2 = mergeOverride(o1, 'pillar', { position: { x: 1, y: 0, z: 2 } })
    expect(o2).toEqual({ pillar: { scale: 2, position: { x: 1, y: 0, z: 2 } } })
    // does not mutate the input
    expect(o1).toEqual({ pillar: { scale: 2 } })
  })
  it('drops keys set to undefined and removes empty overrides', () => {
    const o = mergeOverride({ pillar: { scale: 2, hidden: true }, floor: { hidden: true } }, 'pillar', { scale: undefined })
    expect(o).toEqual({ pillar: { hidden: true }, floor: { hidden: true } })
    expect(mergeOverride(o, 'pillar', { hidden: undefined })).toEqual({ floor: { hidden: true } })
  })
  it('resets a node to its base by removing the entry', () => {
    const o = resetOverride({ pillar: { scale: 2 }, floor: { hidden: true } }, 'pillar')
    expect(o).toEqual({ floor: { hidden: true } })
    expect(resetOverride(undefined, 'x')).toEqual({})
  })
  it('computes the effective transform from base and override', () => {
    const base = { position: { x: 1, y: 0, z: 1 }, rotation: { x: 0, y: 0.5, z: 0 }, scale: { x: 1, y: 2, z: 1 }, visible: true }
    expect(effectiveNodeTransform(base, undefined)).toEqual({ position: { x: 1, y: 0, z: 1 }, rotationY: 0.5, scale: 1, hidden: false })
    expect(effectiveNodeTransform(base, { scale: 3, hidden: true })).toEqual({ position: { x: 1, y: 0, z: 1 }, rotationY: 0.5, scale: 3, hidden: true })
  })
  it('applies and restores a node transform around its authored base', () => {
    const o = new Object3D()
    o.position.set(1, 0, 1)
    o.rotation.y = 0.5
    o.scale.set(1, 2, 1)
    const base = readBase(o)
    applyNodeTransform(o, base, { position: { x: 4, y: 0, z: 4 }, rotationY: Math.PI / 2, scale: 2, hidden: true })
    expect(o.position.toArray()).toEqual([4, 0, 4])
    expect(o.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(o.scale.toArray()).toEqual([2, 4, 2])
    expect(o.visible).toBe(false)
    // reset = the effective transform of an absent override
    applyNodeTransform(o, base, effectiveNodeTransform(base, undefined))
    expect(o.position.toArray()).toEqual([1, 0, 1])
    expect(o.rotation.y).toBeCloseTo(0.5)
    expect(o.scale.toArray()).toEqual([1, 2, 1])
    expect(o.visible).toBe(true)
  })
  it('reads the base transform of an object', () => {
    const o = new Object3D()
    o.position.set(1, 2, 3)
    o.rotation.y = 0.4
    o.scale.setScalar(2)
    const b = readBase(o)
    expect(b.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(b.rotation.y).toBeCloseTo(0.4)
    expect(b.scale).toEqual({ x: 2, y: 2, z: 2 })
  })
})

describe('scene transform', () => {
  it('detects identity', () => {
    expect(isIdentityTransform(undefined)).toBe(true)
    expect(isIdentityTransform({ scale: 1, rotationY: 0, offset: { x: 0, y: 0, z: 0 } })).toBe(true)
    expect(isIdentityTransform({ scale: 2, rotationY: 0, offset: { x: 0, y: 0, z: 0 } })).toBe(false)
  })
  it('transforms wall segments by scale, rotation and offset', () => {
    const walls = [{ a: { x: 0, z: 0 }, b: { x: 1, z: 0 } }]
    const out = transformWalls(walls, { scale: 2, rotationY: Math.PI / 2, offset: { x: 5, y: 0, z: 5 } })
    expect(out[0]!.a.x).toBeCloseTo(5)
    expect(out[0]!.a.z).toBeCloseTo(5)
    // +X rotated by +90° around Y points to -Z, scaled by 2
    expect(out[0]!.b.x).toBeCloseTo(5)
    expect(out[0]!.b.z).toBeCloseTo(3)
  })
})

describe('prop footprints', () => {
  it('turns a world box into four wall segments that block sight', () => {
    const segs = footprintWalls({ min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 1, z: 1 } })
    expect(segs).toHaveLength(4)
    const lengths = segs.map((s) => Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z)).sort((a, b) => a - b)
    expect(lengths.map((v) => +v.toFixed(3))).toEqual([1, 1, 2, 2])
    expect(hasLineOfSight({ x: 1, z: -1 }, { x: 1, z: 2 }, segs)).toBe(false)
    expect(hasLineOfSight({ x: 3, z: -1 }, { x: 3, z: 2 }, segs)).toBe(true)
  })
  it('gives no segments for an empty or flat box', () => {
    expect(footprintWalls({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 1, z: 1 } })).toEqual([])
    expect(footprintWalls({ min: { x: 1, y: 0, z: 1 }, max: { x: 0, y: 1, z: 0 } })).toEqual([])
  })
  it('uses the world bounds of a transformed object', () => {
    const g = new Group()
    const m = new Mesh(new BoxGeometry(1, 1, 1))
    g.add(m)
    g.position.set(10, 0, 0)
    g.scale.setScalar(2)
    const segs = footprintOfObject(g, new Box3())
    expect(segs).toHaveLength(4)
    const xs = segs.flatMap((s) => [s.a.x, s.b.x])
    expect(Math.min(...xs)).toBeCloseTo(9)
    expect(Math.max(...xs)).toBeCloseTo(11)
    expect(footprintOfObject(new Group())).toEqual([])
  })
})

describe('node picking', () => {
  const root = new Group()
  const walls = new Group(); walls.name = 'walls'
  const north = new Mesh(); north.name = 'WALL_north'
  const col = new Mesh(); col.name = 'COL_pillar'
  const pillar = new Group(); pillar.name = 'pillar'
  const p0 = new Mesh(); p0.name = 'pillar_0'
  const p1 = new Mesh(); p1.name = 'pillar_1'
  const anon = new Mesh()
  const light = new Group(); light.name = 'LIGHT_torch'
  const bulb = new Object3D(); bulb.name = 'LIGHT_torch_light'
  walls.add(north); pillar.add(p0, p1); light.add(bulb); root.add(walls, col, pillar, anon, light)

  it('selects the mesh itself when it is named', () => {
    expect(nearestNamedNode(north, root)?.name).toBe('WALL_north')
  })
  it('collapses multi-primitive children onto their group', () => {
    expect(nearestNamedNode(p1, root)?.name).toBe('pillar')
  })
  it('skips helper nodes and unnamed hits', () => {
    expect(nearestNamedNode(col, root)).toBeNull()
    expect(nearestNamedNode(anon, root)).toBeNull()
    expect(nearestNamedNode(bulb, root)).toBeNull()
    expect(nearestNamedNode(root, root)).toBeNull()
  })
  it('walks up to a named ancestor for unnamed children', () => {
    const child = new Mesh()
    pillar.add(child)
    expect(nearestNamedNode(child, root)?.name).toBe('pillar')
    pillar.remove(child)
  })
})

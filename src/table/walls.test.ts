import { describe, expect, it } from 'vitest'
import { BoxGeometry, Matrix4, PlaneGeometry, Vector3, Euler, Quaternion } from 'three'
import { castRay, extractWallSegments, hasLineOfSight, mergeSegments, segmentsIntersect, type WallSegment } from './walls'

const len = (s: WallSegment) => Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z)
const sortedLengths = (segs: WallSegment[]) => segs.map(len).sort((a, b) => a - b)

describe('extractWallSegments', () => {
  it('turns a wall box into its four outline segments', () => {
    const geo = new BoxGeometry(4, 3, 0.2)
    const segs = extractWallSegments(geo)
    expect(segs).toHaveLength(4)
    expect(sortedLengths(segs).map((v) => +v.toFixed(3))).toEqual([0.2, 0.2, 4, 4])
  })
  it('ignores floors', () => {
    const floor = new PlaneGeometry(10, 10)
    const m = new Matrix4().makeRotationX(-Math.PI / 2)
    expect(extractWallSegments(floor, m)).toHaveLength(0)
    const slab = new BoxGeometry(10, 0.1, 10)
    // a slab still has thin vertical sides: four segments of 10 m
    expect(sortedLengths(extractWallSegments(slab)).map((v) => +v.toFixed(3))).toEqual([10, 10, 10, 10])
  })
  it('applies the world matrix', () => {
    const geo = new BoxGeometry(4, 3, 0.2)
    const m = new Matrix4().compose(new Vector3(10, 0, 5), new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)), new Vector3(1, 1, 1))
    const segs = extractWallSegments(geo, m)
    expect(segs).toHaveLength(4)
    const long = segs.filter((s) => len(s) > 3)
    expect(long).toHaveLength(2)
    // rotated 90° around Y: the long edges now run along Z through x ≈ 10
    for (const s of long) {
      expect(Math.abs(s.a.x - s.b.x)).toBeLessThan(1e-6)
      expect(Math.abs(s.a.x - 10)).toBeLessThan(0.11)
      expect(Math.min(s.a.z, s.b.z)).toBeCloseTo(3)
      expect(Math.max(s.a.z, s.b.z)).toBeCloseTo(7)
    }
  })
  it('treats shallow faces as floor and steep faces as wall', () => {
    const geo = new PlaneGeometry(2, 2)
    const shallow = new Matrix4().makeRotationX(-Math.PI / 2 + 0.3) // ~17° from horizontal
    expect(extractWallSegments(geo, shallow)).toHaveLength(0)
    const steep = new Matrix4().makeRotationX(0.3) // ~17° from vertical: a thin sliver, still a wall
    const segs = extractWallSegments(geo, steep)
    expect(segs.length).toBeGreaterThan(0)
    for (const s of segs) for (const p of [s.a, s.b]) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.abs(p.z)).toBeLessThanOrEqual(Math.sin(0.3) + 1e-9)
    }
  })
})

describe('mergeSegments', () => {
  it('unions collinear overlapping and touching segments', () => {
    const merged = mergeSegments([
      { a: { x: 0, z: 0 }, b: { x: 1, z: 0 } },
      { a: { x: 1, z: 0 }, b: { x: 2, z: 0 } },
      { a: { x: 1.5, z: 0 }, b: { x: 3, z: 0 } },
      { a: { x: 5, z: 0 }, b: { x: 4, z: 0 } }, // reversed, separate
    ])
    expect(merged).toHaveLength(2)
    expect(sortedLengths(merged).map((v) => +v.toFixed(6))).toEqual([1, 3])
  })
  it('keeps parallel segments on different lines apart', () => {
    const merged = mergeSegments([
      { a: { x: 0, z: 0 }, b: { x: 2, z: 0 } },
      { a: { x: 0, z: 0.2 }, b: { x: 2, z: 0.2 } },
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('line of sight', () => {
  const wall: WallSegment = { a: { x: 0, z: -2 }, b: { x: 0, z: 2 } }
  it('detects segment intersections', () => {
    expect(segmentsIntersect({ x: -1, z: 0 }, { x: 1, z: 0 }, wall.a, wall.b)).toBe(true)
    expect(segmentsIntersect({ x: -1, z: 3 }, { x: 1, z: 3 }, wall.a, wall.b)).toBe(false)
    expect(segmentsIntersect({ x: -1, z: 0 }, { x: -0.5, z: 0 }, wall.a, wall.b)).toBe(false)
    // collinear overlap
    expect(segmentsIntersect({ x: 0, z: 0 }, { x: 0, z: 5 }, wall.a, wall.b)).toBe(true)
    expect(segmentsIntersect({ x: 0, z: 3 }, { x: 0, z: 5 }, wall.a, wall.b)).toBe(false)
  })
  it('blocks sight across a wall and not around it', () => {
    expect(hasLineOfSight({ x: -1, z: 0 }, { x: 1, z: 0 }, [wall])).toBe(false)
    expect(hasLineOfSight({ x: -1, z: 0 }, { x: -1, z: 5 }, [wall])).toBe(true)
    expect(hasLineOfSight({ x: -1, z: 3 }, { x: 1, z: 3 }, [wall])).toBe(true)
  })
  it('reports the fraction of the ray that is clear', () => {
    expect(castRay({ x: -1, z: 0 }, { x: 3, z: 0 }, [wall])).toBeCloseTo(0.25)
    expect(castRay({ x: -1, z: 5 }, { x: 3, z: 5 }, [wall])).toBe(1)
  })
})

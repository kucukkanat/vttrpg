import { describe, expect, it } from 'vitest'
import type { Prop, Wall } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { PropId, SceneId, WallId } from '@/core/ids'
import { Euler, Quaternion, Vector3 } from 'three'
import { capturePrefab, prefabSummary, quarter, snapRectToCells, stampCorner, stampPrefab, stampSize, turnRotation } from './prefab'

const grid: GridSpec = { type: 'square', cellSize: 1, origin: { x: 0, y: 0, z: 0 } }
const s1 = 's1' as SceneId
const prop = (id: string, x: number, z: number, y = 0): Prop => ({
  id: id as PropId, scene: s1, name: id, model: { sha256: 'x', sources: ['x'] } as unknown as Prop['model'],
  position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 }, scale: 1,
})
const wall = (id: string, a: [number, number], b: [number, number], door?: Wall['door']): Wall => ({
  id: id as WallId, scene: s1, a: { x: a[0], z: a[1] }, b: { x: b[0], z: b[1] }, ...(door ? { door } : {}),
})

describe('prefabs', () => {
  it('grows a dragged rectangle outwards to whole cells', () => {
    // Cells are centred on integers, so corners sit on .5.
    expect(snapRectToCells({ x: 0.1, z: 0.2 }, { x: 1.2, z: -0.1 }, grid)).toEqual({ minX: -0.5, minZ: -0.5, maxX: 1.5, maxZ: 0.5 })
    // A tap captures the cell under it.
    expect(snapRectToCells({ x: 2, z: 2 }, { x: 2, z: 2 }, grid)).toEqual({ minX: 1.5, minZ: 1.5, maxX: 2.5, maxZ: 2.5 })
  })
  it('captures props and walls inside the rectangle relative to its corner', () => {
    const rect = { minX: -0.5, minZ: -0.5, maxX: 1.5, maxZ: 0.5 }
    const p = capturePrefab({
      name: 'Hut', rect, cellSize: 1, floorY: 0.2, now: 5,
      props: [prop('in', 1, 0, 0.7), prop('out', 4, 4)],
      walls: [wall('in', [-0.5, -0.5], [1.5, -0.5]), wall('door', [-0.5, 0.5], [0.5, 0.5], { open: true, locked: true }), wall('half', [0, 0], [3, 0])],
    })
    expect(p.size).toEqual({ x: 2, z: 1 })
    expect(p.props).toHaveLength(1)
    expect(p.props[0]).toMatchObject({ name: 'in', position: { x: 1.5, y: 0.5, z: 0.5 } })
    expect(p.props[0]).not.toHaveProperty('id')
    expect(p.walls).toEqual([
      { a: { x: 0, z: 0 }, b: { x: 2, z: 0 } },
      // Doors come back closed and unlocked.
      { a: { x: 0, z: 1 }, b: { x: 1, z: 1 }, door: { open: false } },
    ])
    expect(p.createdAt).toBe(5)
    expect(prefabSummary(p)).toBe('1 prop · 2 walls · 2 × 1 cells')
  })
  it('stamps with the footprint corner on a cell corner, turned in quarter turns', () => {
    const prefab = capturePrefab({
      name: 'L', rect: { minX: -0.5, minZ: -0.5, maxX: 1.5, maxZ: 0.5 }, cellSize: 1,
      props: [prop('crate', 1, 0)], walls: [wall('w', [-0.5, -0.5], [1.5, -0.5])],
    })
    expect(stampSize(prefab, 1, 1)).toEqual({ x: 1, z: 2 })
    expect(quarter(-1)).toBe(3)
    const corner = stampCorner({ x: 5.2, z: 5.1 }, stampSize(prefab, 0, 1), grid)
    expect(corner).toEqual({ x: 4.5, z: 4.5 })
    const flat = stampPrefab(prefab, { scene: 's2' as SceneId, corner, turns: 0, cellSize: 1, floorY: 0 })
    expect(flat.props[0]).toMatchObject({ scene: 's2', position: { x: 6, y: 0, z: 5 } })
    expect(flat.walls[0]).toMatchObject({ scene: 's2', a: { x: 4.5, z: 4.5 }, b: { x: 6.5, z: 4.5 }, source: 'prefab' })
    expect(flat.props[0]!.id).not.toBe(stampPrefab(prefab, { scene: s1, corner, turns: 0, cellSize: 1, floorY: 0 }).props[0]!.id)
    // A quarter turn: the 2 x 1 footprint becomes 1 x 2, the wall along x runs along z, the prop turns with it.
    const turned = stampPrefab(prefab, { scene: s1, corner: { x: 0, z: 0 }, turns: 1, cellSize: 1, floorY: 0 })
    expect(turned.walls[0]).toMatchObject({ a: { x: 0, z: 2 }, b: { x: 0, z: 0 } })
    expect(turned.props[0]!.position).toMatchObject({ x: 0.5, z: 0.5 })
    expect(turned.props[0]!.rotation.y).toBeCloseTo(Math.PI / 2)
  })
  it('scales a prefab stamped onto a grid of another cell size', () => {
    const prefab = capturePrefab({ name: 'P', rect: { minX: 0, minZ: 0, maxX: 2, maxZ: 2 }, cellSize: 1, props: [prop('a', 1, 1)], walls: [] })
    const out = stampPrefab(prefab, { scene: s1, corner: { x: 0, z: 0 }, turns: 0, cellSize: 1.5, floorY: 1 })
    expect(out.props[0]).toMatchObject({ position: { x: 1.5, y: 1, z: 1.5 }, scale: 1.5 })
    expect(stampSize(prefab, 0, 1.5)).toEqual({ x: 3, z: 3 })
  })
  it('scales per-axis props per axis, drops authorship and turns tilted props as a whole', () => {
    const tilted: Prop = {
      ...prop('a', 1, 1), scale: { x: 1, y: 2, z: 0.5 }, rotation: { x: Math.PI / 2, y: 0, z: 0 },
      createdBy: 'aa' as Prop['createdBy'], editedBy: 'bb' as Prop['editedBy'],
    }
    const prefab = capturePrefab({ name: 'P', rect: { minX: 0, minZ: 0, maxX: 2, maxZ: 2 }, cellSize: 1, props: [tilted], walls: [] })
    expect(prefab.props[0]).not.toHaveProperty('createdBy')
    expect(prefab.props[0]).not.toHaveProperty('editedBy')
    const out = stampPrefab(prefab, { scene: s1, corner: { x: 0, z: 0 }, turns: 1, cellSize: 2, floorY: 0 })
    expect(out.props[0]!.scale).toEqual({ x: 2, y: 4, z: 1 })
    // The stamped orientation equals a world quarter turn applied after the original rotation.
    const r = out.props[0]!.rotation
    const got = new Quaternion().setFromEuler(new Euler(r.x, r.y, r.z, 'XYZ'))
    const want = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2).multiply(new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0, 'XYZ')))
    expect(Math.abs(got.dot(want))).toBeCloseTo(1, 6)
    expect(turnRotation({ x: 0, y: 0.5, z: 0 }, Math.PI / 2)).toEqual({ x: 0, y: Number((0.5 + Math.PI / 2).toFixed(6)), z: 0 })
  })
})

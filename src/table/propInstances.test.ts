import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { Prop } from '@/core/doc'
import type { AssetHash, PropId, SceneId } from '@/core/ids'
import {
  capacityFor, groupProps, hullBox, idsKey, InstanceSlots, propMatrix, sameItems, standaloneIds, xzHull,
} from './propInstances'

const S = 's1' as SceneId
function prop(id: string, sha = 'a', extra: Partial<Prop> = {}): Prop {
  return {
    id: id as PropId, scene: S, name: id,
    model: { sha256: sha as AssetHash, kind: 'glb', mime: 'model/gltf-binary', size: 1, sources: [] },
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    ...extra,
  }
}
const ids = (xs: readonly string[]) => new Set(xs as PropId[])

describe('standaloneIds', () => {
  it('takes the single prop selection when there is no multi-selection', () => {
    expect([...standaloneIds({ selection: { kind: 'prop', id: 'p1' } })]).toEqual(['p1'])
    expect([...standaloneIds({ selection: { kind: 'token', id: 't1' } })]).toEqual([])
    expect([...standaloneIds({ selection: null })]).toEqual([])
  })
  it('adds the multi-selection and the prop under an edit preview', () => {
    const s = standaloneIds({ selection: { kind: 'prop', id: 'p1' }, propSelection: ['p2', 'p3'] as PropId[], previewId: 'p4' as PropId })
    expect([...s].sort()).toEqual(['p1', 'p2', 'p3', 'p4'])
  })
  it('gives a stable key whatever the order', () => {
    expect(idsKey(ids(['b', 'a']))).toBe(idsKey(ids(['a', 'b'])))
  })
})

describe('groupProps', () => {
  it('groups by model hash in input order and keeps standalone and legacy props apart', () => {
    const list = [prop('p1', 'a'), prop('p2', 'b'), prop('p3', 'a'), prop('p4', 'a'), prop('p5', 'b', { scale: 0.5 })]
    const { singles, groups } = groupProps(list, ids(['p4']))
    expect(singles.map((p) => p.id)).toEqual(['p4', 'p5'])
    expect(groups.map((g) => [g.key, g.props.map((p) => p.id)])).toEqual([['a', ['p1', 'p3']], ['b', ['p2']]])
  })
  it('draws everything standalone when instancing is off', () => {
    const { singles, groups } = groupProps([prop('p1'), prop('p2')], ids([]), false)
    expect(singles).toHaveLength(2)
    expect(groups).toEqual([])
  })
})

describe('InstanceSlots', () => {
  it('marks new props dirty and maps instance ids back to prop ids', () => {
    const slots = new InstanceSlots<Prop>()
    const a = prop('a'), b = prop('b'), c = prop('c')
    expect(slots.sync([a, b, c])).toEqual({ dirty: [0, 1, 2], removed: [] })
    expect(slots.count).toBe(3)
    expect([0, 1, 2].map((i) => slots.idAt(i))).toEqual(['a', 'b', 'c'])
    expect(slots.idAt(3)).toBeUndefined()
    expect(slots.idAt(undefined)).toBeUndefined()
    expect(slots.idAt(-1)).toBeUndefined()
  })

  it('rewrites nothing when every prop kept its identity', () => {
    const slots = new InstanceSlots<Prop>()
    const list = [prop('a'), prop('b')]
    slots.sync(list)
    expect(slots.sync([...list])).toEqual({ dirty: [], removed: [] })
  })

  it('rewrites only the slot of a changed prop', () => {
    const slots = new InstanceSlots<Prop>()
    const a = prop('a'), b = prop('b'), c = prop('c')
    slots.sync([a, b, c])
    const b2 = { ...b, position: { x: 3, y: 0, z: 0 } }
    expect(slots.sync([a, b2, c]).dirty).toEqual([1])
    expect(slots.itemAt(1)).toBe(b2)
  })

  it('fills a removed slot with the last prop and keeps the mapping right', () => {
    const slots = new InstanceSlots<Prop>()
    const a = prop('a'), b = prop('b'), c = prop('c'), d = prop('d')
    slots.sync([a, b, c, d])
    const r = slots.sync([a, c, d])
    expect(r.removed).toEqual(['b'])
    expect(r.dirty).toEqual([1])
    expect(slots.count).toBe(3)
    expect([0, 1, 2].map((i) => slots.idAt(i))).toEqual(['a', 'd', 'c'])
    expect(slots.slotOf('d')).toBe(1)
    expect(slots.slotOf('b')).toBeUndefined()
  })

  it('handles removing the tail, adding and changing at once', () => {
    const slots = new InstanceSlots<Prop>()
    const a = prop('a'), b = prop('b'), c = prop('c')
    slots.sync([a, b, c])
    const a2 = { ...a }
    const e = prop('e')
    const r = slots.sync([a2, b, e])
    expect(r.removed).toEqual(['c'])
    expect(r.dirty).toEqual([0, 2])
    expect([0, 1, 2].map((i) => slots.idAt(i))).toEqual(['a', 'b', 'e'])
    expect(slots.all()).toEqual([0, 1, 2])
  })

  it('empties cleanly', () => {
    const slots = new InstanceSlots<Prop>()
    slots.sync([prop('a'), prop('b')])
    expect(slots.sync([])).toEqual({ dirty: [], removed: ['b', 'a'] })
    expect(slots.count).toBe(0)
  })
})

describe('helpers', () => {
  it('sameItems compares by reference and order', () => {
    const a = prop('a'), b = prop('b')
    expect(sameItems([a, b], [a, b])).toBe(true)
    expect(sameItems([a, b], [b, a])).toBe(false)
    expect(sameItems([a], [{ ...a }])).toBe(false)
  })

  it('capacity grows in powers of two from 16', () => {
    expect([0, 16, 17, 1000, 2000].map(capacityFor)).toEqual([16, 16, 32, 1024, 2048])
  })

  it('composes the prop matrix from position, XYZ Euler and per-axis scale', () => {
    const p = prop('a', 'a', { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0.1, y: 0.7, z: -0.2 }, scale: { x: 2, y: 1, z: 0.5 } })
    const expected = new Matrix4().compose(new Vector3(1, 2, 3), new Quaternion().setFromEuler(new Euler(0.1, 0.7, -0.2)), new Vector3(2, 1, 0.5))
    expect(propMatrix(p).elements.map((v) => +v.toFixed(9))).toEqual(expected.elements.map((v) => +v.toFixed(9)))
  })

  it('xzHull drops interior points', () => {
    const hull = xzHull([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }, { x: 0.5, z: 0.5 }, { x: 0.2, z: 0.8 }])
    expect(hull).toHaveLength(4)
    expect(hull).not.toContainEqual({ x: 0.5, z: 0.5 })
  })

  it('hullBox gives the exact world footprint of a turned prop', () => {
    const h = { hull: xzHull([{ x: -1, z: -0.5 }, { x: 1, z: -0.5 }, { x: 1, z: 0.5 }, { x: -1, z: 0.5 }]), minY: 0, maxY: 2 }
    const p = prop('a', 'a', { position: { x: 10, y: 0, z: 0 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } })
    const box = hullBox(h, propMatrix(p))!
    expect(box.min.x).toBeCloseTo(9.5)
    expect(box.max.x).toBeCloseTo(10.5)
    expect(box.min.z).toBeCloseTo(-1)
    expect(box.max.z).toBeCloseTo(1)
    expect(box.max.y).toBeCloseTo(2)
  })
})

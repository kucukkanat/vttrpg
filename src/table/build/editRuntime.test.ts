import { afterEach, describe, expect, it } from 'vitest'
import { Box3, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three'
import type { Prop } from '@/core/doc'
import type { AssetHash, PropId, SceneId } from '@/core/ids'
import { instanceBounds, InstanceSlots, partsBounds, propMatrix } from '../propInstances'
import { propBatches, propBounds, propHits, propIdOfHit, propObjects, propUnderRay, registerPropBatch, registerPropObject } from './editRuntime'

function prop(id: string, x: number, z: number, extra: Partial<Prop> = {}): Prop {
  return {
    id: id as PropId, scene: 's' as SceneId, name: id,
    model: { sha256: 'a' as AssetHash, kind: 'glb', mime: 'model/gltf-binary', size: 1, sources: [] },
    position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    ...extra,
  }
}

/** A batch like PropBatch builds: one InstancedMesh of a 1 x 2 x 1 box resting on the floor. */
function batch(props: Prop[]) {
  const geometry = new BoxGeometry(1, 2, 1)
  const part = { geometry, matrix: new Matrix4().makeTranslation(0, 1, 0) }
  const local = partsBounds([part])
  const slots = new InstanceSlots<Prop>()
  slots.sync(props)
  const mesh = new InstancedMesh(geometry, new MeshBasicMaterial(), 8)
  mesh.count = slots.count
  const m = new Matrix4()
  for (let i = 0; i < slots.count; i++) mesh.setMatrixAt(i, m.multiplyMatrices(propMatrix(slots.itemAt(i)!), part.matrix))
  const group = new Group()
  group.userData = { propSlots: slots }
  group.add(mesh)
  group.updateMatrixWorld(true)
  const off = registerPropBatch({
    object: group,
    has: (id) => slots.slotOf(id) !== undefined,
    boundsOf: (id, out) => { const s = slots.slotOf(id); return s === undefined ? null : instanceBounds(local, slots.itemAt(s)!, out) },
  })
  return { group, off, local }
}

afterEach(() => { propBatches.clear(); propObjects.clear() })

describe('instance bounds', () => {
  it('boxes the parts in model space', () => {
    const b = partsBounds([{ geometry: new BoxGeometry(1, 2, 1), matrix: new Matrix4().makeTranslation(0, 1, 0) }])
    expect(b.min.toArray()).toEqual([-0.5, 0, -0.5])
    expect(b.max.toArray()).toEqual([0.5, 2, 0.5])
  })

  it('moves, turns and scales with the prop', () => {
    const local = new Box3(new Vector3(-0.5, 0, -1), new Vector3(0.5, 2, 1))
    const b = instanceBounds(local, prop('p', 3, 4, { rotation: { x: 0, y: Math.PI / 2, z: 0 }, scale: { x: 2, y: 1, z: 1 } }))
    // Scaled to 2 x 2 x 2, then turned a quarter: the footprint stays 2 by 2 around (3, 4).
    expect(b.min.x).toBeCloseTo(2); expect(b.max.x).toBeCloseTo(4)
    expect(b.min.z).toBeCloseTo(3); expect(b.max.z).toBeCloseTo(5)
    expect(b.max.y).toBeCloseTo(2)
  })
})

describe('instanced props in the registry', () => {
  it('answers the world bounds of an instance', () => {
    batch([prop('a', 0, 0), prop('b', 5, 0)])
    const b = propBounds('b' as PropId)!
    expect(b.min.x).toBeCloseTo(4.5); expect(b.max.x).toBeCloseTo(5.5); expect(b.max.y).toBeCloseTo(2)
    expect(propBounds('nope' as PropId)).toBeNull()
  })

  it('maps a ray hit back to the instanced prop', () => {
    batch([prop('a', 0, 0), prop('b', 5, 0)])
    const down = new Ray(new Vector3(5, 10, 0), new Vector3(0, -1, 0))
    const hits = propHits(down)
    expect(hits[0]?.id).toBe('b')
    expect(hits[0]!.hit.point.y).toBeCloseTo(2)
    expect(propUnderRay(new Ray(new Vector3(2.5, 10, 0), new Vector3(0, -1, 0)))).toBeUndefined()
  })

  it('skips props it is told to and prefers the nearest', () => {
    batch([prop('low', 0, 0)])
    const top = new Mesh(new BoxGeometry(1, 1, 1))
    const g = new Group()
    g.userData = { propId: 'top' }
    g.position.set(0, 3, 0)
    g.add(top)
    g.updateMatrixWorld(true)
    registerPropObject('top' as PropId, g)
    const down = new Ray(new Vector3(0, 10, 0), new Vector3(0, -1, 0))
    expect(propUnderRay(down)).toBe('top')
    expect(propUnderRay(down, new Set(['top' as PropId]))).toBe('low')
  })

  it('reads the prop id off standalone groups and batch slots', () => {
    const slots = new InstanceSlots<Prop>()
    slots.sync([prop('x', 0, 0), prop('y', 1, 0)])
    const g = new Group(); g.userData = { propSlots: slots }
    const m = new Mesh(); g.add(m)
    expect(propIdOfHit({ object: m, instanceId: 1 })).toBe('y')
    expect(propIdOfHit({ object: m, instanceId: 9 })).toBeUndefined()
    const s = new Group(); s.userData = { propId: 'z' }
    const inner = new Mesh(); s.add(inner)
    expect(propIdOfHit({ object: inner, instanceId: undefined })).toBe('z')
  })

  it('forgets a batch when it unmounts', () => {
    const { off } = batch([prop('a', 0, 0)])
    off()
    expect(propBounds('a' as PropId)).toBeNull()
  })
})

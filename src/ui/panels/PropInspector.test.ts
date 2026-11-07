import { describe, expect, it } from 'vitest'
import type { Prop } from '@/core/doc'
import type { PropId, SceneId } from '@/core/ids'
import { inspectorUpdates } from './PropInspector'

const prop = (id: string, over: Partial<Prop> = {}): Prop => ({
  id: id as PropId, scene: 's' as SceneId, name: id, model: {} as Prop['model'],
  position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, ...over,
})

describe('inspector updates', () => {
  const a = prop('a', { position: { x: 1, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 } })
  const b = prop('b', { position: { x: 3, y: 1, z: 0 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } })
  it('moves every prop by the primary difference', () => {
    const u = inspectorUpdates([a, b], b, 'position', 'x', 5)
    expect(u.map((x) => x.patch.position!.x)).toEqual([3, 5])
  })
  it('turns every prop by the same degrees', () => {
    const u = inspectorUpdates([a, b], b, 'rotation', 'y', 180)
    expect(u[0]!.patch.rotation!.y).toBeCloseTo(Math.PI / 2)
    expect(Math.abs(u[1]!.patch.rotation!.y)).toBeCloseTo(Math.PI)
  })
  it('scales every prop by the primary factor on that axis', () => {
    const u = inspectorUpdates([a, b], a, 'scale', 'y', 3)
    expect(u.map((x) => x.patch.scale!.y)).toEqual([3, 1.5])
    expect(inspectorUpdates([a], a, 'scale', 'y', 0)).toEqual([])
    expect(inspectorUpdates([a], a, 'position', 'x', 1)).toEqual([])
  })
})

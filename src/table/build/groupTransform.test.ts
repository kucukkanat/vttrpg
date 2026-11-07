import { describe, expect, it } from 'vitest'
import type { PropId } from '@/core/ids'
import { applyGroupOp, applyOp, poseOf, selectionCentre, snapFactor, snappedYawDelta, updatesFrom, type Poses, type PropPose } from './groupTransform'

const pose = (x: number, z: number, yaw = 0, y = 0): PropPose => ({ position: { x, y, z }, rotation: { x: 0, y: yaw, z: 0 }, scale: { x: 1, y: 1, z: 1 } })
const id = (s: string) => s as PropId
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe('selection centre', () => {
  it('is the middle of the positions on the floor, at the lowest height', () => {
    expect(selectionCentre([pose(0, 0, 0, 1), pose(4, 2, 0, 0.5), pose(2, -2, 0, 3)])).toEqual({ x: 2, y: 0.5, z: 0 })
    expect(selectionCentre([])).toEqual({ x: 0, y: 0, z: 0 })
  })
})

describe('group transforms about the centre', () => {
  const poses: Poses = { [id('a')]: pose(1, 0), [id('b')]: pose(-1, 0), [id('c')]: pose(0, 2, Math.PI / 4) }
  const centre = selectionCentre(Object.values(poses))

  it('moves every prop by the same delta', () => {
    const out = applyGroupOp(poses, { kind: 'move', delta: { x: 1.5, y: 0.2, z: -3 } })
    expect(out[id('a')]!.position).toEqual({ x: 2.5, y: 0.2, z: -3 })
    expect(out[id('c')]!.position).toEqual({ x: 1.5, y: 0.2, z: -1 })
    expect(out[id('c')]!.rotation).toEqual(poses[id('c')]!.rotation)
  })
  it('turns 90° around Y: positions orbit the centre and every prop turns too', () => {
    expect(centre).toEqual({ x: 0, y: 0, z: 1 })
    const out = applyGroupOp(poses, { kind: 'rotate', axis: { x: 0, y: 1, z: 0 }, angle: Math.PI / 2, centre })
    // (1, 0) is (1, -1) from the centre; +90° about Y takes (dx, dz) to (dz, -dx).
    close(out[id('a')]!.position.x, -1); close(out[id('a')]!.position.z, 0)
    close(out[id('b')]!.position.x, -1); close(out[id('b')]!.position.z, 2)
    close(out[id('a')]!.rotation.y, Math.PI / 2)
    close(out[id('c')]!.rotation.y, Math.PI / 4 + Math.PI / 2)
  })
  it('turns thirty chairs as one and back again', () => {
    const many: Poses = {}
    for (let i = 0; i < 30; i++) many[id(`p${i}`)] = pose(i % 6, Math.floor(i / 6), (i * Math.PI) / 12)
    const c = selectionCentre(Object.values(many))
    const there = applyGroupOp(many, { kind: 'rotate', axis: { x: 0, y: 1, z: 0 }, angle: Math.PI / 2, centre: c })
    const back = applyGroupOp(there, { kind: 'rotate', axis: { x: 0, y: 1, z: 0 }, angle: -Math.PI / 2, centre: c })
    for (const k of Object.keys(many) as PropId[]) {
      close(back[k]!.position.x, many[k]!.position.x)
      close(back[k]!.position.z, many[k]!.position.z)
      close(Math.cos(back[k]!.rotation.y), Math.cos(many[k]!.rotation.y))
      close(Math.sin(back[k]!.rotation.y), Math.sin(many[k]!.rotation.y))
      // Turning about Y never invents a tilt.
      close(there[k]!.rotation.x, 0)
      close(there[k]!.rotation.z, 0)
    }
    expect(updatesFrom(many, there)).toHaveLength(30)
  })
  it('tilts around X about the centre', () => {
    const p = applyOp(pose(0, 0, 0, 1), { kind: 'rotate', axis: { x: 1, y: 0, z: 0 }, angle: Math.PI / 2, centre: { x: 0, y: 0, z: 0 } })
    close(p.position.y, 0); close(p.position.z, 1)
    close(p.rotation.x, Math.PI / 2)
  })
  it('scales uniformly: offsets from the centre and sizes grow together', () => {
    const out = applyGroupOp(poses, { kind: 'scale', factor: 2, centre })
    expect(out[id('a')]!.position).toEqual({ x: 2, y: 0, z: -1 })
    expect(out[id('a')]!.scale).toEqual({ x: 2, y: 2, z: 2 })
  })
  it('scales along an axis: a turned prop stretches along its own matching axis', () => {
    // Turned 90° about Y, the prop's local X lies along world Z.
    const turned = pose(0, 2, Math.PI / 2)
    const p = applyOp(turned, { kind: 'scale-axis', axis: 'z', factor: 3, centre: { x: 0, y: 0, z: 0 } })
    expect(p.scale).toEqual({ x: 3, y: 1, z: 1 })
    close(p.position.z, 6)
    close(p.position.x, 0)
  })
  it('keeps scales inside what the validator accepts', () => {
    const p = applyOp(pose(0, 0), { kind: 'scale', factor: 1e9, centre: { x: 0, y: 0, z: 0 } })
    expect(p.scale.x).toBe(1e4)
  })
})

describe('commit helpers', () => {
  it('updates carry only changed fields of changed props', () => {
    const before: Poses = { [id('a')]: pose(0, 0), [id('b')]: pose(1, 1) }
    const after: Poses = { [id('a')]: { ...pose(0, 0), position: { x: 2, y: 0, z: 0 } }, [id('b')]: pose(1, 1) }
    expect(updatesFrom(before, after)).toEqual([{ id: 'a', patch: { position: { x: 2, y: 0, z: 0 } } }])
  })
  it('yaw snapping lands the primary on a step; factors snap to 0.05', () => {
    const step = Math.PI / 12
    close(0.1 + snappedYawDelta(0.1, 0.3, step), 2 * step)
    close(snappedYawDelta(0, 1.6, Math.PI / 2), Math.PI / 2)
    expect(snappedYawDelta(0.1, 0.3, 0)).toBe(0.3)
    close(snapFactor(1.234, 0.05), 1.25)
    expect(snapFactor(0.001, 0.05)).toBe(0.05)
  })
  it('reads a legacy number scale with its fit', () => {
    expect(poseOf({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 2 }, 0.5).scale).toEqual({ x: 1, y: 1, z: 1 })
  })
})

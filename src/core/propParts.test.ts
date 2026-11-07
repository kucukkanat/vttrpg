import { describe, expect, it } from 'vitest'
import type { GameDocShape, Prop, Scene } from './doc'
import type { PropId, SceneId } from './ids'
import type { Intent } from './intents'
import { patchToward, samePropState, validatePropsIntent } from './props'
import {
  badLight, centredBounds, doorRefusal, hasModel, isDoorProp, moveSegments, NO_MODEL, propSegment, propSegmentsByLevel, sightSegments, stretchBetween,
} from './propParts'

const scene = 's1' as SceneId
const model = { sha256: 'ab'.repeat(32), kind: 'glb', mime: 'model/gltf-binary', size: 1, sources: [] } as unknown as Prop['model']
const prop = (id: string, over: Partial<Prop> = {}): Prop => ({
  id: id as PropId, scene, name: id, model, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, ...over,
})
const doc = (props: Prop[] = [prop('a')]): Pick<GameDocShape, 'props' | 'scenes'> => ({
  scenes: { [scene]: { id: scene } as Scene },
  props: Object.fromEntries(props.map((p) => [p.id, p])) as Record<PropId, Prop>,
})
const v = (intent: Intent, d = doc()) => validatePropsIntent(intent, d)
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 9)

describe('prop parts: validation', () => {
  it('accepts lights, walls and doors on new props, and invisible props that are something', () => {
    expect(v({ type: 'props.place', props: [prop('l', { light: { color: '#ffb35c', radius: 6, intensity: 1.2, flicker: true, kind: 'spot', angle: 0.5 } })] })).toBeNull()
    expect(v({ type: 'props.place', props: [prop('w', { model: NO_MODEL, wall: { length: 3, blocks: 'both' } })] })).toBeNull()
    expect(v({ type: 'props.place', props: [prop('d', { model: NO_MODEL, door: { open: false, locked: true, width: 1.5 } })] })).toBeNull()
    // A visible wall model without a length takes it from its bounds.
    expect(v({ type: 'props.place', props: [prop('vw', { wall: { blocks: 'sight' } })] })).toBeNull()
  })

  it('refuses malformed parts and invisible props with nothing to be', () => {
    const place = (over: Partial<Prop>) => v({ type: 'props.place', props: [prop('x', over)] })
    expect(place({ light: { color: 'orange', radius: 6 } })).toMatch(/colour/)
    expect(place({ light: { color: '#ffffff', radius: 0 } })).toMatch(/reach/)
    expect(place({ light: { color: '#ffffff', radius: 6, intensity: 9 } })).toMatch(/intensity/)
    expect(place({ light: { color: '#ffffff', radius: 6, kind: 'area' as never } })).toMatch(/kind/)
    expect(place({ light: { color: '#ffffff', radius: 6, angle: 2 } })).toMatch(/angle/)
    expect(place({ wall: { length: 3, blocks: 'all' as never } })).toMatch(/blocks/)
    expect(place({ wall: { length: -1, blocks: 'both' } })).toMatch(/length/)
    expect(place({ wall: { length: 1, blocks: 'both', extra: 1 } as never })).toMatch(/cannot have/)
    expect(place({ door: { open: 'yes' as never } })).toMatch(/open/)
    expect(place({ door: { open: false, width: Number.NaN } })).toMatch(/width/)
    expect(place({ model: NO_MODEL })).toMatch(/without a model/)
    expect(badLight({ color: '#ffffff', radius: 6 })).toBeNull()
  })

  it('patches parts through props.update, null takes one off, but an invisible prop keeps one', () => {
    const d = doc([prop('a'), prop('w', { model: NO_MODEL, wall: { length: 3, blocks: 'both' } })])
    const up = (id: string, patch: unknown) => v({ type: 'props.update', updates: [{ id: id as PropId, patch: patch as never }] }, d)
    expect(up('a', { light: { color: '#ffffff', radius: 4 } })).toBeNull()
    expect(up('a', { light: null, door: { open: true, width: 1 } })).toBeNull()
    expect(up('a', { wall: { blocks: 'nope' } })).toMatch(/blocks/)
    expect(up('w', { wall: { length: 5, blocks: 'move' } })).toBeNull()
    expect(up('w', { wall: null })).toMatch(/without a model/)
    expect(up('w', { wall: null, light: { color: '#ffffff', radius: 2 } })).toBeNull()
  })

  it('undo diffs carry parts but never swing a door', () => {
    const before = prop('d', { door: { open: false, width: 1 } })
    const after = { ...before, door: { open: false, locked: true, width: 1 }, light: { color: '#ffffff', radius: 3 } }
    expect(patchToward(after, before)).toEqual({ door: { open: false, width: 1 }, light: null })
    // A player opened it since: undoing the lock keeps it open.
    const opened = { ...after, door: { ...after.door, open: true } }
    expect(patchToward(opened, before)).toEqual({ door: { open: true, width: 1 }, light: null })
    // And an opened door still counts as the state this user left.
    expect(samePropState(opened, after)).toBe(true)
  })

  it('validates prop.door and props.convert', () => {
    const d = doc([prop('a'), prop('d', { model: NO_MODEL, door: { open: false, width: 1 } })])
    expect(v({ type: 'prop.door', prop: 'd' as PropId, open: true }, d)).toBeNull()
    expect(v({ type: 'prop.door', prop: 'a' as PropId, open: true }, d)).toMatch(/not a door/)
    expect(v({ type: 'props.convert', scene, props: [prop('n', { model: NO_MODEL, wall: { length: 1, blocks: 'both' } })], walls: [], lights: [] }, d)).toBeNull()
    expect(v({ type: 'props.convert', scene, props: [prop('n')], walls: [], lights: [] }, d)).toMatch(/wall, a door or a light/)
  })
})

describe('prop parts: doors', () => {
  const door = prop('d', { door: { open: false, width: 1 } })
  const locked = prop('l', { door: { open: false, locked: true, width: 1 } })
  it('lets the GM work any door and players unlocked doors where the scene allows it', () => {
    expect(doorRefusal(locked, { playersOpenDoors: false }, { isGm: true })).toBeNull()
    expect(doorRefusal(door, { playersOpenDoors: true }, { isGm: false })).toBeNull()
    expect(doorRefusal(door, { playersOpenDoors: false }, { isGm: false })).toMatch(/GM/)
    expect(doorRefusal(locked, { playersOpenDoors: true }, { isGm: false })).toMatch(/locked/)
    expect(doorRefusal(prop('p'), { playersOpenDoors: true }, { isGm: true })).toMatch(/not a door/)
    expect(isDoorProp(door)).toBe(true)
    expect(isDoorProp(prop('p'))).toBe(false)
    expect(hasModel(prop('p', { model: NO_MODEL, door: { open: false } }))).toBe(false)
  })
})

describe('prop parts: segments', () => {
  it('runs an explicit length along local X, turned and stretched with the prop', () => {
    const s = propSegment(prop('w', { position: { x: 2, y: 0, z: 1 }, rotation: { x: 0, y: Math.PI / 2, z: 0 }, wall: { length: 4, blocks: 'both' } }), undefined, 1)!
    // Turned 90° about +Y, local +X points to world -Z.
    close(s.a.x, 2); close(s.a.z, 3); close(s.b.x, 2); close(s.b.z, -1)
    const scaled = propSegment(prop('w', { scale: { x: 2, y: 1, z: 1 }, wall: { length: 1, blocks: 'both' } }), undefined, 1)!
    close(scaled.a.x, -1); close(scaled.b.x, 1)
  })

  it('takes the longer side of a model\'s bounds through their centre when the length is absent', () => {
    // A wall model drawn along Z, off-centre on X (kenney town walls stand on the cell edge).
    const s = propSegment(prop('w', { wall: { blocks: 'both' } }), { min: { x: 1.2, z: -1.5 }, max: { x: 1.5, z: 1.5 } }, 1)!
    close(s.a.x, 1.35); close(s.a.z, -1.5); close(s.b.x, 1.35); close(s.b.z, 1.5)
    const c = propSegment(prop('w', { door: { open: false } }), centredBounds([3, 3, 0.75]), 1)!
    close(c.a.x, -1.5); close(c.b.x, 1.5); close(c.a.z, 0)
    // Nothing known: one cell along X.
    const f = propSegment(prop('w', { wall: { blocks: 'both' } }), undefined, 1.5)!
    close(f.a.x, -0.75); close(f.b.x, 0.75)
    expect(propSegment(prop('p'), undefined, 1)).toBeNull()
  })

  it('sorts segments by level and by what they block; open doors drop out', () => {
    const cell = 1.5
    const props = [
      prop('w0', { model: NO_MODEL, wall: { length: 3, blocks: 'both' } }),
      prop('m0', { model: NO_MODEL, wall: { length: 3, blocks: 'move' } }),
      prop('s0', { model: NO_MODEL, wall: { length: 3, blocks: 'sight' } }),
      prop('d0', { model: NO_MODEL, door: { open: false, width: 1 } }),
      prop('o0', { model: NO_MODEL, door: { open: true, width: 1 } }),
      // Two storeys up (a level is two cells high).
      prop('w1', { model: NO_MODEL, position: { x: 0, y: 2 * cell, z: 0 }, wall: { length: 3, blocks: 'both' } }),
      prop('elsewhere', { scene: 's2' as SceneId, model: NO_MODEL, wall: { length: 3, blocks: 'both' } }),
      prop('plain'),
    ]
    const by = propSegmentsByLevel(props, scene, { floorY: 0, cellSize: cell })
    expect([...by.keys()].sort()).toEqual([0, 1])
    const l0 = by.get(0)!
    expect(l0.sight).toHaveLength(2) // the wall and the closed door
    expect(l0.move).toHaveLength(1)
    expect(l0.sightOnly).toHaveLength(1)
    expect(sightSegments(l0)).toHaveLength(3)
    expect(moveSegments(l0)).toHaveLength(3)
    expect(by.get(1)!.sight).toHaveLength(1)
  })
})

describe('invisible wall placement maths', () => {
  it('centres the prop between the clicks, turned along them, as long as they are apart', () => {
    const a = { x: 1, z: 1 }, b = { x: 4, z: 5 }
    const st = stretchBetween(a, b)
    close(st.length, 5)
    close(st.position.x, 2.5); close(st.position.z, 3)
    const seg = propSegment(prop('w', { position: { x: st.position.x, y: 0, z: st.position.z }, rotation: { x: 0, y: st.yaw, z: 0 }, wall: { length: st.length, blocks: 'both' } }), undefined, 1)!
    close(seg.a.x, a.x); close(seg.a.z, a.z); close(seg.b.x, b.x); close(seg.b.z, b.z)
    expect(stretchBetween(a, a).length).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import type { GameDocShape, Prop, Scene } from './doc'
import type { PlayerPubkey, PropId, SceneId, WallId } from './ids'
import type { Intent } from './intents'
import {
  isLegacyScale, MAX_PROPS_PER_INTENT, migratedScale, patchToward, propScale, samePropState, uniformScale, validatePropsIntent,
} from './props'

const scene = 's1' as SceneId
const model = { sha256: 'ab'.repeat(32), kind: 'model', mime: 'model/gltf-binary', size: 1, sources: [] } as unknown as Prop['model']
const prop = (id: string, over: Partial<Prop> = {}): Prop => ({
  id: id as PropId, scene, name: id, model, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, ...over,
})
const doc = (props: Prop[] = [prop('a')]): Pick<GameDocShape, 'props' | 'scenes'> => ({
  scenes: { [scene]: { id: scene } as Scene },
  props: Object.fromEntries(props.map((p) => [p.id, p])) as Record<PropId, Prop>,
})
const v = (intent: Intent, d = doc()) => validatePropsIntent(intent, d)

describe('validatePropsIntent', () => {
  it('accepts well-formed batches', () => {
    expect(v({ type: 'props.place', props: [prop('b'), prop('c', { tags: ['tree'], catalogue: 'builtin:props/tree.glb' })] })).toBeNull()
    expect(v({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { position: { x: 1, y: 0, z: 2 }, scale: { x: 2, y: 1, z: 1 }, locked: true } }] })).toBeNull()
    expect(v({ type: 'props.remove', ids: ['a' as PropId] })).toBeNull()
    expect(v({ type: 'props.migrate', items: [{ id: 'a' as PropId, fit: 0.25 }] })).toBeNull()
  })

  it('refuses non-finite numbers, bad scales and unknown fields', () => {
    const up = (patch: unknown) => v({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: patch as never }] })
    expect(up({ position: { x: Number.NaN, y: 0, z: 0 } })).toMatch(/finite/)
    expect(up({ rotation: { x: 0, y: Infinity, z: 0 } })).toMatch(/finite/)
    expect(up({ scale: { x: 0, y: 1, z: 1 } })).toMatch(/range/)
    expect(up({ scale: { x: 1e6, y: 1, z: 1 } })).toMatch(/range/)
    expect(up({ scale: 2 })).toMatch(/three/) // batch updates are always per-axis
    expect(up({ model })).toMatch(/cannot change model/)
    expect(up({ solid: 'yes' })).toMatch(/solid/)
    expect(up({ position: { x: 1e9, y: 0, z: 0 } })).toMatch(/far/)
    expect(v({ type: 'props.place', props: [prop('b', { scale: { x: -1, y: 1, z: 1 } })] })).toMatch(/range/)
    expect(v({ type: 'props.place', props: [prop('b', { tags: [3 as unknown as string] })] })).toMatch(/tags/)
  })

  it('checks references: the prop exists and its scene does, new ids are new and unique', () => {
    expect(v({ type: 'props.update', updates: [{ id: 'zz' as PropId, patch: {} }] })).toMatch(/unknown prop/)
    expect(v({ type: 'props.remove', ids: ['a' as PropId, 'zz' as PropId] })).toMatch(/unknown prop/)
    expect(v({ type: 'props.remove', ids: ['a' as PropId] }, doc([prop('a', { scene: 'gone' as SceneId })]))).toMatch(/not in a scene/)
    expect(v({ type: 'props.place', props: [prop('a')] })).toMatch(/already exists/)
    expect(v({ type: 'props.place', props: [prop('b'), prop('b')] })).toMatch(/twice/)
    expect(v({ type: 'props.remove', ids: ['a' as PropId, 'a' as PropId] })).toMatch(/twice/)
    expect(v({ type: 'props.place', props: [prop('b', { scene: 'nope' as SceneId })] })).toMatch(/scene/)
    expect(v({ type: 'props.place', props: [prop('b')], walls: [{ id: 'w' as WallId, scene: 'nope' as SceneId, a: { x: 0, z: 0 }, b: { x: 1, z: 0 } }] })).toMatch(/wall/)
  })

  it('refuses empty and oversized batches', () => {
    expect(v({ type: 'props.place', props: [] })).toMatch(/nothing/)
    expect(v({ type: 'props.remove', ids: [] })).toMatch(/nothing/)
    const many = Array.from({ length: MAX_PROPS_PER_INTENT + 1 }, (_, i) => prop(`n${i}`))
    expect(v({ type: 'props.place', props: many })).toMatch(/too many/)
  })

  it('lets a version 1 number scale be placed again (undo of a removal) but not patched in', () => {
    expect(v({ type: 'props.place', props: [prop('b', { scale: 1.5 })] })).toBeNull()
    expect(v({ type: 'prop.update', prop: 'a' as PropId, patch: { scale: 2 } })).toBeNull() // older clients
    expect(v({ type: 'prop.add', prop: prop('a') })).toMatch(/already exists/)
    expect(v({ type: 'prop.remove', prop: 'zz' as PropId })).toMatch(/unknown/)
  })

  it('ignores other intents', () => {
    expect(v({ type: 'chat.say', text: 'hi' })).toBeNull()
  })
})

describe('scale migration', () => {
  it('reads a version 1 number as the number times the fit it was drawn with', () => {
    const old = prop('a', { scale: 2 })
    expect(isLegacyScale(old.scale)).toBe(true)
    expect(propScale(old, 0.25)).toEqual({ x: 0.5, y: 0.5, z: 0.5 })
    expect(propScale(old)).toEqual({ x: 2, y: 2, z: 2 }) // fit unknown yet
    expect(propScale(prop('b', { scale: { x: 1, y: 2, z: 3 } }), 0.25)).toEqual({ x: 1, y: 2, z: 3 })
    expect(migratedScale(3, 0.5)).toEqual({ x: 1.5, y: 1.5, z: 1.5 })
    expect(uniformScale({ x: 1, y: 4, z: 2 })).toBe(4)
  })
})

describe('samePropState and patchToward', () => {
  const me = 'aa'.repeat(32) as PlayerPubkey
  const other = 'bb'.repeat(32) as PlayerPubkey

  it('matches the same content and author, absent and absent', () => {
    expect(samePropState(prop('a', { editedBy: me }), prop('a', { editedBy: me }))).toBe(true)
    expect(samePropState(null, undefined)).toBe(true)
    expect(samePropState(prop('a'), null)).toBe(false)
    expect(samePropState(prop('a', { editedBy: me }), prop('a', { editedBy: other }))).toBe(false)
    expect(samePropState(prop('a', { editedBy: me }), prop('a', { editedBy: me, position: { x: 1, y: 0, z: 0 } }))).toBe(false)
  })

  it('treats the one-off migration as no change', () => {
    const before = prop('a', { scale: 2, editedBy: me })
    const migrated = { ...before, scale: migratedScale(2, 0.25), legacyFit: 0.25 }
    expect(samePropState(migrated, before)).toBe(true)
  })

  it('patches only the fields that differ, flags written as false', () => {
    const cur = prop('a', { position: { x: 1, y: 0, z: 0 }, locked: true, name: 'A' })
    const want = prop('a', { name: 'A' })
    expect(patchToward(cur, want)).toEqual({ position: { x: 0, y: 0, z: 0 }, locked: false })
    expect(patchToward(want, want)).toBeNull()
    // A version 1 target is written per-axis with the recorded fit.
    const migrated = prop('a', { scale: { x: 3, y: 3, z: 3 }, legacyFit: 0.5 })
    expect(patchToward(migrated, prop('a', { scale: 2 }))).toEqual({ scale: { x: 1, y: 1, z: 1 } })
  })
})

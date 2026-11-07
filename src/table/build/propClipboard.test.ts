import { describe, expect, it } from 'vitest'
import type { Prop } from '@/core/doc'
import type { PlayerPubkey, PropId, SceneId } from '@/core/ids'
import { validatePropsIntent } from '@/core/props'
import { CLIPBOARD_PREFIX, clipFromProps, decodeClip, duplicateOffset, duplicateProps, encodeClip, propsFromClip } from './propClipboard'

const scene = 's1' as SceneId
const model = { sha256: 'ab'.repeat(32), kind: 'model', mime: 'model/gltf-binary', size: 10, name: 'Chäir', sources: ['https://x/y.glb'] } as unknown as Prop['model']
const prop = (id: string, over: Partial<Prop> = {}): Prop => ({
  id: id as PropId, scene, name: id, model, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, ...over,
})
let n = 0
const ids = () => `new${++n}` as PropId

describe('prop clipboard codec', () => {
  const chairs = [
    prop('a', { position: { x: 2, y: 0, z: 2 }, rotation: { x: 0, y: 1.2, z: 0 }, catalogue: 'kenney/chair', tags: ['seat'], createdBy: 'aa' as PlayerPubkey }),
    prop('b', { position: { x: 4, y: 1, z: 2 }, scale: { x: 2, y: 1, z: 1 }, solid: true, name: 'Table ✦' }),
  ]

  it('stores positions relative to the group centre, keeping catalogue ids and asset refs', () => {
    const clip = clipFromProps(chairs, 1.5)
    expect(clip.cell).toBe(1.5)
    expect(clip.items[0]!.position).toEqual({ x: -1, y: 0, z: 0 })
    expect(clip.items[1]!.position).toEqual({ x: 1, y: 1, z: 0 })
    expect(clip.items[0]!.catalogue).toBe('kenney/chair')
    expect(clip.items[0]!.model).toEqual(model)
    expect(clip.items[0]).not.toHaveProperty('createdBy')
  })
  it('round-trips through the vttprops: text', () => {
    const clip = clipFromProps(chairs, 1.5)
    const text = encodeClip(clip)
    expect(text.startsWith(CLIPBOARD_PREFIX)).toBe(true)
    expect(text.slice(CLIPBOARD_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeClip(text)).toEqual(clip)
  })
  it('copies a legacy number scale as its vector', () => {
    const clip = clipFromProps([prop('c', { scale: 2 })], undefined, () => 0.25)
    expect(clip.items[0]!.scale).toEqual({ x: 0.5, y: 0.5, z: 0.5 })
  })
  it('refuses other text and broken payloads', () => {
    expect(decodeClip('hello')).toBeNull()
    expect(decodeClip(`${CLIPBOARD_PREFIX}!!!`)).toBeNull()
    expect(decodeClip(`${CLIPBOARD_PREFIX}${btoa('{"v":1,"items":[]}')}`)).toBeNull()
    expect(decodeClip(`${CLIPBOARD_PREFIX}${btoa('{"v":2,"items":[{}]}')}`)).toBeNull()
    const bad = encodeClip({ v: 1, items: [{ ...clipFromProps(chairs).items[0]!, scale: { x: 0, y: 1, z: 1 } }] })
    expect(decodeClip(bad)).toBeNull()
  })
  it('pastes with the centre at the given point, as props the validator accepts', () => {
    const clip = decodeClip(encodeClip(clipFromProps(chairs)))!
    const placed = propsFromClip(clip, scene, { x: 10, y: 0, z: -5 }, ids)
    expect(placed.map((p) => p.position)).toEqual([{ x: 9, y: 0, z: -5 }, { x: 11, y: 1, z: -5 }])
    expect(new Set(placed.map((p) => p.id)).size).toBe(2)
    expect(placed[1]!.solid).toBe(true)
    const doc = { props: {}, scenes: { [scene]: { id: scene } } } as never
    expect(validatePropsIntent({ type: 'props.place', props: placed }, doc)).toBeNull()
  })
})

describe('duplicate', () => {
  it('offsets copies by one cell along x with fresh ids and no authorship', () => {
    const src = [prop('a', { position: { x: 1, y: 0, z: 1 }, editedBy: 'bb' as PlayerPubkey, legacyFit: 0.5 }), prop('b', { position: { x: 2, y: 0.5, z: 3 } })]
    const copies = duplicateProps(src, duplicateOffset(1.5), () => 1, ids)
    expect(copies.map((c) => c.position)).toEqual([{ x: 2.5, y: 0, z: 1 }, { x: 3.5, y: 0.5, z: 3 }])
    expect(copies.every((c) => !src.some((s) => s.id === c.id))).toBe(true)
    expect(copies[0]).not.toHaveProperty('editedBy')
    expect(copies[0]).not.toHaveProperty('legacyFit')
    expect(copies[0]!.model).toEqual(model)
  })
})

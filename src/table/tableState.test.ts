import { beforeEach, describe, expect, it } from 'vitest'
import type { SceneId } from '@/core/ids'
import { clearSceneTransition, sceneTransitionEvent, setPreviewScene, setSceneError, stepSceneTransition, useTableUi, type SceneTransition } from './tableState'

const a = 'a' as SceneId
const b = 'b' as SceneId

describe('setSceneError', () => {
  beforeEach(() => useTableUi.getState().set({ sceneErrors: {} }))

  it('records one error per scene and clears it again', () => {
    setSceneError(a, 'The model file could not be found.')
    setSceneError(b, 'The file is not a GLB this app can read.')
    expect(useTableUi.getState().sceneErrors).toEqual({ a: 'The model file could not be found.', b: 'The file is not a GLB this app can read.' })
    setSceneError(a, null)
    expect(useTableUi.getState().sceneErrors).toEqual({ b: 'The file is not a GLB this app can read.' })
  })
  it('does not touch the store when nothing changes', () => {
    setSceneError(a, 'x')
    const before = useTableUi.getState().sceneErrors
    setSceneError(a, 'x')
    setSceneError(b, null)
    expect(useTableUi.getState().sceneErrors).toBe(before)
  })
})

describe('stepSceneTransition', () => {
  const change = (to: SceneId, name = to.toUpperCase()) => ({ type: 'change', to, name }) as const

  it('walks out → swap → in → done for a scene switch', () => {
    const out = stepSceneTransition(null, change(b))
    expect(out).toEqual({ to: b, name: 'B', phase: 'out' })
    const swap = stepSceneTransition(out, { type: 'covered' })
    expect(swap).toEqual({ to: b, name: 'B', phase: 'swap' })
    const fadeIn = stepSceneTransition(swap, { type: 'loaded', scene: b })
    expect(fadeIn).toEqual({ to: b, name: 'B', phase: 'in' })
    expect(stepSceneTransition(fadeIn, { type: 'revealed' })).toBeNull()
  })
  it('ignores events that do not fit the phase and keeps the same object', () => {
    expect(stepSceneTransition(null, { type: 'covered' })).toBeNull()
    expect(stepSceneTransition(null, { type: 'loaded', scene: a })).toBeNull()
    expect(stepSceneTransition(null, { type: 'revealed' })).toBeNull()
    const out = stepSceneTransition(null, change(b))!
    expect(stepSceneTransition(out, { type: 'loaded', scene: b })).toBe(out)
    expect(stepSceneTransition(out, { type: 'revealed' })).toBe(out)
    const swap = stepSceneTransition(out, { type: 'covered' })!
    expect(stepSceneTransition(swap, { type: 'covered' })).toBe(swap)
    // A load report for the scene that is being left does not end the black.
    expect(stepSceneTransition(swap, { type: 'loaded', scene: a })).toBe(swap)
  })
  it('retargets a running fade without restarting it', () => {
    const out = stepSceneTransition(null, change(b))!
    expect(stepSceneTransition(out, change(a))).toEqual({ to: a, name: 'A', phase: 'out' })
    const swap = stepSceneTransition(out, { type: 'covered' })!
    expect(stepSceneTransition(swap, change(a))).toEqual({ to: a, name: 'A', phase: 'swap' })
    // The same target again changes nothing.
    expect(stepSceneTransition(swap, change(b))).toBe(swap)
  })
  it('fades out again when the scene changes while fading in', () => {
    const fadeIn: SceneTransition = { to: b, name: 'B', phase: 'in' }
    expect(stepSceneTransition(fadeIn, change(a))).toEqual({ to: a, name: 'A', phase: 'out' })
  })
  it('picks up a renamed scene mid-fade', () => {
    const out = stepSceneTransition(null, change(b))!
    expect(stepSceneTransition(out, change(b, 'Forest clearing'))).toEqual({ to: b, name: 'Forest clearing', phase: 'out' })
  })
})

describe('sceneTransitionEvent / clearSceneTransition', () => {
  beforeEach(() => useTableUi.setState({ transition: null }))

  it('moves the store through the phases and only writes on a change', () => {
    sceneTransitionEvent({ type: 'change', to: b, name: 'B' })
    expect(useTableUi.getState().transition).toEqual({ to: b, name: 'B', phase: 'out' })
    const before = useTableUi.getState().transition
    sceneTransitionEvent({ type: 'revealed' })
    expect(useTableUi.getState().transition).toBe(before)
    sceneTransitionEvent({ type: 'covered' })
    sceneTransitionEvent({ type: 'loaded', scene: b })
    expect(useTableUi.getState().transition?.phase).toBe('in')
    clearSceneTransition()
    expect(useTableUi.getState().transition).toBeNull()
  })
})

describe('setPreviewScene', () => {
  beforeEach(() => useTableUi.setState({ previewScene: null }))

  it('sets and clears the GM preview', () => {
    setPreviewScene(a)
    expect(useTableUi.getState().previewScene).toBe(a)
    setPreviewScene(null)
    expect(useTableUi.getState().previewScene).toBeNull()
  })
})

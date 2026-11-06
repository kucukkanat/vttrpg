import { beforeEach, describe, expect, it } from 'vitest'
import type { SceneId } from '@/core/ids'
import { setSceneError, useTableUi } from './tableState'

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

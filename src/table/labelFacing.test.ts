import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import { angleDelta, labelYaw } from './labelFacing'

/** Text-up of the label in world space: local +Y of a plane laid flat, then turned by `yaw` (and its parent's). */
function textUp(yaw: number, parentYaw = 0): Vector3 {
  return new Vector3(0, 1, 0).applyEuler(new Euler(-Math.PI / 2, 0, 0)).applyEuler(new Euler(0, yaw + parentYaw, 0))
}

describe('labelYaw', () => {
  it.each([
    ['camera south of the token', 0, -1],
    ['camera west', 1, 0],
    ['camera north-east', -Math.SQRT1_2, Math.SQRT1_2],
  ])('points the text up along the screen up (%s)', (_label, ux, uz) => {
    const yaw = labelYaw(ux, uz)!
    const up = textUp(yaw)
    expect(up.x).toBeCloseTo(ux)
    expect(up.z).toBeCloseTo(uz)
  })

  it('cancels the parent yaw so a turned token still reads upright', () => {
    const parent = 1.2
    const yaw = labelYaw(0.6, -0.8, parent)!
    const up = textUp(yaw, parent)
    expect(up.x).toBeCloseTo(0.6)
    expect(up.z).toBeCloseTo(-0.8)
  })

  it('returns null when the camera looks level', () => {
    expect(labelYaw(0, 0)).toBeNull()
  })
})

describe('angleDelta', () => {
  it('wraps to the short way round', () => {
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(0.2)
    expect(angleDelta(-3, 3)).toBeCloseTo(2 * Math.PI - 6)
    expect(angleDelta(1, 1)).toBe(0)
  })
})

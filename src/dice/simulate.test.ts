import { beforeAll, describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { dieDef, toPhysicalDice, upReading } from './geometry'
import { rapierReady, samplePose, seededRandom, simulateRollSync, type ThrowParams } from './simulate'

const tray = { width: 8, depth: 5 }
const dieSize = 0.5

function params(seed: string, dice: { sides: number; value: number }[]): ThrowParams {
  return { seed, dice: toPhysicalDice(dice), dieSize, tray }
}

describe('seededRandom', () => {
  it('is deterministic and uniform-ish', () => {
    const a = seededRandom('x'), b = seededRandom('x'), c = seededRandom('y')
    const as = Array.from({ length: 5 }, a), bs = Array.from({ length: 5 }, b), cs = Array.from({ length: 5 }, c)
    expect(as).toEqual(bs)
    expect(as).not.toEqual(cs)
    for (const v of as) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
})

describe('simulateRoll', () => {
  beforeAll(async () => { await rapierReady() }, 30_000)

  it('every die ends up showing its committed value and rests inside the tray', () => {
    const seeds = ['roll-1', 'roll-2', 'roll-3', 'roll-4', 'roll-5', 'roll-6']
    const all = [4, 6, 8, 10, 12, 20, 100]
    for (const seed of seeds) {
      const dice = all.map((sides, i) => ({ sides, value: ((i * 7 + seed.length * 3) % sides) + 1 }))
      const rec = simulateRollSync(params(seed, dice))
      expect(rec.steps).toBeGreaterThan(30)
      expect(rec.duration).toBeLessThan(12)
      const pos = new Vector3(), rot = new Quaternion()
      for (const track of rec.tracks) {
        samplePose(rec, track, rec.duration, pos, rot)
        const def = dieDef(track.die.type)
        expect(def.readings[upReading(def, rot)].value).toBe(track.die.value)
        expect(Math.abs(pos.x)).toBeLessThan(tray.width / 2)
        expect(Math.abs(pos.z)).toBeLessThan(tray.depth / 2)
        expect(pos.y).toBeGreaterThan(0)
        expect(pos.y).toBeLessThan(dieSize * 4)
      }
    }
  }, 60_000)

  it('is deterministic for the same seed and differs for another', () => {
    const dice = [{ sides: 6, value: 3 }, { sides: 20, value: 17 }]
    const a = simulateRollSync(params('same', dice))
    const b = simulateRollSync(params('same', dice))
    const c = simulateRollSync(params('other', dice))
    expect(a.steps).toBe(b.steps)
    a.tracks.forEach((t, i) => {
      expect(Array.from(t.positions)).toEqual(Array.from(b.tracks[i].positions))
      expect(Array.from(t.rotations)).toEqual(Array.from(b.tracks[i].rotations))
    })
    expect(Array.from(a.tracks[0].positions)).not.toEqual(Array.from(c.tracks[0].positions))
  }, 60_000)

  it('records impacts with the floor', () => {
    const rec = simulateRollSync(params('impacts', [{ sides: 6, value: 1 }, { sides: 6, value: 6 }]))
    expect(rec.impacts.length).toBeGreaterThan(0)
    for (const i of rec.impacts) {
      expect(i.strength).toBeGreaterThan(0); expect(i.strength).toBeLessThanOrEqual(1)
      expect(i.step).toBeLessThan(rec.steps)
    }
  }, 60_000)

  it('handles an empty roll', () => {
    const rec = simulateRollSync(params('empty', []))
    expect(rec.tracks).toEqual([])
    expect(rec.duration).toBeGreaterThanOrEqual(0)
  })
})

import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  DIE_TYPES,
  buildDieGeometry,
  dieDef,
  faceLabel,
  isSymmetry,
  readingForValue,
  symmetryRotation,
  toPhysicalDice,
  upReading,
} from './geometry'

const SIDES = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 10 }

function randomQuaternion(seed: number): Quaternion {
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const u1 = rnd(), u2 = rnd(), u3 = rnd()
  return new Quaternion(
    Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
    Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
    Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
    Math.sqrt(u1) * Math.cos(2 * Math.PI * u3),
  )
}

describe.each(DIE_TYPES)('%s', (type) => {
  const def = dieDef(type)
  const sides = SIDES[type]

  it('has the right number of faces and readings', () => {
    expect(def.faces).toHaveLength(sides)
    expect(def.readings).toHaveLength(sides)
  })

  it('every value has exactly one reading and readings are distinct unit normals', () => {
    for (let v = 1; v <= sides; v++) expect(def.readings.filter((r) => r.value === v)).toHaveLength(1)
    for (const r of def.readings) {
      expect(r.normal.length()).toBeCloseTo(1, 5)
      expect(def.readings.filter((o) => o.normal.distanceTo(r.normal) < 1e-3)).toHaveLength(1)
    }
  })

  it('opposite faces sum to sides+1 (not for the vertex-read d4)', () => {
    if (def.vertexReadings) return
    for (const r of def.readings) {
      const opp = def.readings.find((o) => o.normal.dot(r.normal) < -0.999)
      expect(opp).toBeDefined()
      expect(opp!.value + r.value).toBe(sides + 1)
    }
  })

  it('faces are planar, convex, counter-clockwise and outward', () => {
    for (const f of def.faces) {
      for (const i of f.vertices) expect(Math.abs(def.vertices[i].clone().sub(f.center).dot(f.normal))).toBeLessThan(1e-4)
      expect(f.normal.dot(f.center)).toBeGreaterThan(0)
      const n = f.vertices.length
      for (let k = 0; k < n; k++) {
        const a = def.vertices[f.vertices[k]], b = def.vertices[f.vertices[(k + 1) % n]], c = def.vertices[f.vertices[(k + 2) % n]]
        const turn = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(b)).dot(f.normal)
        expect(turn).toBeGreaterThan(0)
      }
      expect(f.up.dot(f.normal)).toBeCloseTo(0, 5)
      expect(f.right.dot(f.normal)).toBeCloseTo(0, 5)
      expect(f.right.dot(f.up)).toBeCloseTo(0, 5)
    }
  })

  it('identity reading when a face is set upright', () => {
    for (const [i, r] of def.readings.entries()) {
      const q = new Quaternion().setFromUnitVectors(r.normal, new Vector3(0, 1, 0))
      expect(upReading(def, q)).toBe(i)
    }
  })

  it('symmetry rotation from A to B maps A onto B and preserves the shape', () => {
    for (let a = 0; a < sides; a++) {
      for (let b = 0; b < sides; b++) {
        const q = symmetryRotation(def, a, b)
        const moved = def.readings[a].normal.clone().applyQuaternion(q)
        expect(moved.distanceTo(def.readings[b].normal)).toBeLessThan(1e-4)
        expect(isSymmetry(def, q)).toBe(true)
      }
    }
  })

  it('a thrown die can be made to show any value by a symmetry offset', () => {
    for (let s = 1; s <= 12; s++) {
      const body = randomQuaternion(s * 7919 + sides)
      const up = upReading(def, body)
      for (let value = 1; value <= sides; value++) {
        const offset = symmetryRotation(def, readingForValue(def, value), up)
        const visual = body.clone().multiply(offset)
        expect(def.readings[upReading(def, visual)].value).toBe(value)
      }
    }
  })

  it('builds a geometry with one UV tile per face', () => {
    const geo = buildDieGeometry(def)
    const tris = def.faces.reduce((n, f) => n + f.vertices.length - 2, 0)
    expect(geo.getAttribute('position').count).toBe(tris * 3)
    const uv = geo.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0); expect(uv.getX(i)).toBeLessThanOrEqual(1)
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0); expect(uv.getY(i)).toBeLessThanOrEqual(1)
    }
  })
})

describe('labels and percentile dice', () => {
  it('prints d10 ten as 0 and the tens die as 00..90', () => {
    expect(faceLabel('d10', 10)).toBe('0')
    expect(faceLabel('d10', 7)).toBe('7')
    expect(faceLabel('d100', 10)).toBe('00')
    expect(faceLabel('d100', 3)).toBe('30')
    expect(faceLabel('d20', 20)).toBe('20')
  })
  it('splits a d100 into tens and units dice that read back to the value', () => {
    for (let v = 1; v <= 100; v++) {
      const [tens, units] = toPhysicalDice([{ sides: 100, value: v }])
      expect(tens.type).toBe('d100'); expect(units.type).toBe('d10')
      const shown = Number(faceLabel('d100', tens.value)) + Number(faceLabel('d10', units.value))
      expect(shown === 0 ? 100 : shown).toBe(v)
    }
  })
  it('drops unsupported dice and keeps source indices', () => {
    expect(toPhysicalDice([{ sides: 3, value: 2 }, { sides: 6, value: 4 }])).toEqual([{ type: 'd6', value: 4, source: 1 }])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import type { PropId } from '@/core/ids'
import { migratedScale, propScale } from '@/core/props'
import { fitObjectToCell, fitScale, horizontalExtent, legacyPropFit, PROP_FIT, TOKEN_FIT } from './fitScale'
import { queuePropMigration, takePropMigrations } from './propMigration'

const CELL = 1.5

function boxMesh(name: string, w: number, h: number, d: number): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial())
  m.name = name
  return m
}

describe('fitScale', () => {
  it('scales a token model to exactly one cell in both directions', () => {
    expect(fitScale(12, CELL, TOKEN_FIT)).toBeCloseTo(CELL / 12)
    expect(fitScale(0.3, CELL, TOKEN_FIT)).toBeCloseTo(5)
    expect(fitScale(CELL, CELL, TOKEN_FIT)).toBe(1)
  })

  it('leaves a prop alone inside the allowed range and corrects it outside', () => {
    expect(fitScale(0.9, CELL, PROP_FIT)).toBe(1) // a crate: authored size stays
    expect(fitScale(CELL, CELL, PROP_FIT)).toBe(1)
    expect(fitScale(12, CELL, PROP_FIT)).toBeCloseTo(CELL / 12) // a whole tavern shrinks to a cell
    expect(fitScale(0.01, CELL, PROP_FIT)).toBeCloseTo(15) // centimetre model grows to a tenth of a cell
  })

  it('returns 1 for unusable input', () => {
    expect(fitScale(0, CELL, TOKEN_FIT)).toBe(1)
    expect(fitScale(Number.NaN, CELL, TOKEN_FIT)).toBe(1)
    expect(fitScale(2, 0, TOKEN_FIT)).toBe(1)
  })
})

describe('horizontalExtent', () => {
  it('takes the larger of width and depth, including child transforms', () => {
    const g = new Group()
    const a = boxMesh('a', 1, 3, 0.5)
    a.position.x = 2
    const b = boxMesh('b', 1, 1, 1)
    b.position.z = -1
    b.scale.set(1, 1, 2)
    g.add(a, b)
    // x spans [-0.5, 2.5] = 3; z spans [-2, 0.25] = 2.25
    expect(horizontalExtent(g)).toBeCloseTo(3)
  })

  it('ignores the root scale, collider helpers and hidden meshes', () => {
    const g = new Group()
    g.scale.setScalar(10)
    g.add(boxMesh('body', 1, 1, 1))
    g.add(boxMesh('COL_floor', 40, 0.1, 40))
    g.add(boxMesh('FOG_hall', 20, 0.1, 20))
    const hidden = boxMesh('secret', 30, 1, 30)
    hidden.visible = false
    g.add(hidden)
    expect(horizontalExtent(g)).toBeCloseTo(1)
    expect(fitObjectToCell(g, CELL, TOKEN_FIT)).toBeCloseTo(1.5)
  })

  it('is 0 for an object with no visible meshes', () => {
    expect(horizontalExtent(new Group())).toBe(0)
    expect(fitObjectToCell(new Group(), CELL, TOKEN_FIT)).toBe(1)
  })
})

describe('version 1 prop migration', () => {
  /** World width of `model` drawn the old way: fitted to PROP_FIT, then the prop's number scale. */
  const oldWidth = (model: Group, n: number) => horizontalExtent(model) * fitObjectToCell(model, CELL, PROP_FIT) * n

  it('keeps the exact on-screen size of old props, large, small and in range', () => {
    for (const [w, n] of [[12, 1], [12, 2.5], [0.9, 1.3], [0.01, 0.5]] as const) {
      const model = new Group()
      model.add(boxMesh('body', w, 1, w / 2))
      const fit = legacyPropFit(model, CELL)
      const migrated = propScale({ scale: n }, fit)
      expect(migrated).toEqual(migratedScale(n, fit))
      // Real-size rendering times the migrated scale gives the old width on every axis.
      expect(horizontalExtent(model) * migrated.x).toBeCloseTo(oldWidth(model, n), 9)
      expect(migrated.y).toBe(migrated.x)
      expect(migrated.z).toBe(migrated.x)
    }
  })

  it('leaves new props at their real size', () => {
    const model = new Group()
    model.add(boxMesh('wagon', 4, 2, 2))
    expect(propScale({ scale: { x: 1, y: 1, z: 1 } }, legacyPropFit(model, CELL))).toEqual({ x: 1, y: 1, z: 1 })
  })
})

describe('migration queue', () => {
  it('sends one props.migrate for every legacy prop that loaded within the window', () => {
    vi.useFakeTimers()
    try {
      const sent: unknown[] = []
      queuePropMigration('a' as PropId, 0.5, (i) => sent.push(i))
      queuePropMigration('b' as PropId, 0.25, (i) => sent.push(i))
      queuePropMigration('a' as PropId, 0.5, (i) => sent.push(i))
      queuePropMigration('c' as PropId, Number.NaN, (i) => sent.push(i))
      expect(sent).toHaveLength(0)
      vi.advanceTimersByTime(1000)
      expect(sent).toEqual([{ type: 'props.migrate', items: [{ id: 'a', fit: 0.5 }, { id: 'b', fit: 0.25 }] }])
      expect(takePropMigrations()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

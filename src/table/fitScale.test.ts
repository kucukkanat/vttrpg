import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { fitObjectToCell, fitScale, horizontalExtent, PROP_FIT, TOKEN_FIT } from './fitScale'

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

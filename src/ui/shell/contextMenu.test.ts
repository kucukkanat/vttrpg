import { describe, expect, it } from 'vitest'
import type { SkillDef } from '@/core/pack'
import type { SkillId } from '@/core/ids'
import { firstAttackSkill, menuKeyTarget, placeMenu, RADIAL_ITEM, RADIAL_RADIUS, radialLayout } from './ContextMenu'

const skill = (id: string, target: SkillDef['target'], effects: SkillDef['effects']): SkillDef =>
  ({ id: id as SkillId, name: id, description: '', target, effects, vfx: [] })
const heal = skill('heal', { kind: 'self' }, [{ kind: 'heal', formula: '1d4', resource: 'hp' }])
const taunt = skill('taunt', { kind: 'single', range: 3 }, [{ kind: 'message', text: 'hey' }])
const bite = skill('bite', { kind: 'single', range: 1 }, [{ kind: 'roll', formula: 'd20' }, { kind: 'damage', formula: '1d6', resource: 'hp' }])
const fireball = skill('fireball', { kind: 'radius', radius: 2, range: 6 }, [{ kind: 'damage', formula: '3d6', resource: 'hp' }])

describe('firstAttackSkill', () => {
  it('prefers the first aimed skill that deals damage', () => {
    expect(firstAttackSkill([heal, taunt, bite, fireball])?.id).toBe('bite')
  })
  it('falls back to the first aimed skill when none deals damage', () => {
    expect(firstAttackSkill([heal, taunt])?.id).toBe('taunt')
  })
  it('never picks a self skill', () => {
    expect(firstAttackSkill([heal])).toBeUndefined()
    expect(firstAttackSkill([])).toBeUndefined()
  })
})

describe('placeMenu', () => {
  const pad = { left: 8, top: 8, right: 20, bottom: 30 }
  const box = { w: 200, h: 300, width: 800, height: 600, pad }
  it('sits at the pointer when it fits', () => {
    expect(placeMenu({ x: 100, y: 120, ...box })).toEqual({ left: 100, top: 120 })
  })
  it('is pushed back inside the padded area near the right and bottom edges', () => {
    expect(placeMenu({ x: 700, y: 500, ...box })).toEqual({ left: 800 - 20 - 200, top: 600 - 30 - 300 })
  })
  it('never starts inside the left and top padding', () => {
    expect(placeMenu({ x: -5, y: 2, ...box })).toEqual({ left: 8, top: 8 })
  })
  it('pins to the top-left padding when the menu is larger than the container', () => {
    expect(placeMenu({ x: 50, y: 50, ...box, width: 150, height: 200 })).toEqual({ left: 8, top: 8 })
  })
})

describe('radialLayout', () => {
  const pad = { left: 8, top: 8, right: 8, bottom: 8 }
  const reach = RADIAL_RADIUS + RADIAL_ITEM / 2
  it('rings the press point clockwise from the top', () => {
    const r = radialLayout(4, { x: 200, y: 300, width: 400, height: 800, pad })
    expect([r.cx, r.cy]).toEqual([200, 300])
    expect(r.items).toEqual([{ x: 0, y: -RADIAL_RADIUS }, { x: RADIAL_RADIUS, y: 0 }, { x: 0, y: RADIAL_RADIUS }, { x: -RADIAL_RADIUS, y: 0 }])
  })
  it('pulls the centre in so every button stays inside the padded container', () => {
    const r = radialLayout(6, { x: 10, y: 790, width: 400, height: 800, pad })
    expect(r.cx).toBe(8 + reach)
    expect(r.cy).toBe(800 - 8 - reach)
  })
  it('centres the ring when the container is smaller than it', () => {
    const r = radialLayout(6, { x: 10, y: 10, width: 200, height: 150, pad })
    expect([r.cx, r.cy]).toEqual([100, 75])
  })
})

describe('menuKeyTarget', () => {
  it('steps with the arrows, wrapping, and jumps with Home / End', () => {
    expect(menuKeyTarget('ArrowDown', 0, 3)).toBe(1)
    expect(menuKeyTarget('ArrowRight', 2, 3)).toBe(0)
    expect(menuKeyTarget('ArrowUp', 0, 3)).toBe(2)
    expect(menuKeyTarget('ArrowLeft', 1, 3)).toBe(0)
    expect(menuKeyTarget('Home', 2, 3)).toBe(0)
    expect(menuKeyTarget('End', 0, 3)).toBe(2)
  })
  it('starts from the first item when nothing inside is focused, and ignores other keys', () => {
    expect(menuKeyTarget('ArrowDown', -1, 3)).toBe(0)
    expect(menuKeyTarget('Enter', 0, 3)).toBeNull()
    expect(menuKeyTarget('ArrowDown', 0, 0)).toBeNull()
  })
})

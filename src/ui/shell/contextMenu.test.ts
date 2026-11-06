import { describe, expect, it } from 'vitest'
import type { SkillDef } from '@/core/pack'
import type { SkillId } from '@/core/ids'
import { firstAttackSkill, placeMenu } from './ContextMenu'

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

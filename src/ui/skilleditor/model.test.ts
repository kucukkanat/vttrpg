import { beforeAll, describe, expect, it } from 'vitest'
import type { SkillDef } from '@/core/pack'
import type { LoadedPack } from '@/rules'
import { loadMausritter } from '@/rules/test-helpers'
import {
  duplicateForm,
  emptyEffect,
  emptyForm,
  emptyVfx,
  formFromSkill,
  skillFromForm,
  skillFromJson,
  skillToJson,
  slugify,
  uniqueSlug,
  validateForm,
} from './model'

let pack: LoadedPack
beforeAll(async () => {
  pack = await loadMausritter()
})

describe('slugs', () => {
  it('turns names into ids', () => {
    expect(slugify('Fireball')).toBe('fireball')
    expect(slugify("Hazel's  Fire Ball!")).toBe('hazels-fire-ball')
    expect(slugify('  Éclair de Feu  ')).toBe('eclair-de-feu')
    expect(slugify('Magic Missile (copy)')).toBe('magic-missile-copy')
    expect(slugify('***')).toBe('')
  })
  it('avoids taken ids with a counter', () => {
    expect(uniqueSlug('fireball', [])).toBe('fireball')
    expect(uniqueSlug('fireball', ['fireball'])).toBe('fireball-2')
    expect(uniqueSlug('fireball', ['fireball', 'fireball-2'])).toBe('fireball-3')
    expect(uniqueSlug('', ['skill'])).toBe('skill-2')
  })
})

describe('form <-> SkillDef', () => {
  it('round-trips every pack skill', () => {
    for (const skill of pack.skills) {
      const form = formFromSkill(skill)
      expect(skillFromForm(form)).toEqual(skill)
      const v = validateForm(form, pack)
      expect(v.errors).toEqual({})
      expect(v.general).toEqual([])
      expect(v.skill).toEqual(skill)
    }
  })

  it('round-trips a skill using every effect kind, target shape and optional field', () => {
    const skill: SkillDef = {
      id: 'kitchen-sink' as SkillDef['id'],
      name: 'Kitchen Sink',
      description: 'Everything at once.',
      icon: '🧪',
      cost: [{ resource: 'wil', amount: '1' }, { resource: 'pips.current', amount: 'max(1, level)' }],
      target: { kind: 'cone', range: 4, angle: 90 },
      effects: [
        { kind: 'roll', formula: 'd20', vs: 'target.dex', label: 'DEX save' },
        { kind: 'roll', formula: '2d6' },
        { kind: 'damage', formula: 'save.success ? 0 : last.total', resource: 'hp' },
        { kind: 'heal', formula: '1', resource: 'wil' },
        { kind: 'condition', add: ['frightened'], remove: ['hungry'] },
        { kind: 'condition', remove: ['injured'] },
        { kind: 'move', cells: -2 },
        { kind: 'message', text: '{source.name} did it.' },
      ],
      vfx: [
        { at: 0, preset: 'projectile', from: 'source', to: 'point', color: '#ff7a1a', duration: 400 },
        { at: 400, preset: 'shake', duration: 300 },
        { at: 500, preset: 'sound', asset: 'thunder' },
      ],
    }
    const form = formFromSkill(skill)
    expect(skillFromForm(form)).toEqual(skill)
    const v = validateForm(form, pack)
    expect(v.errors).toEqual({})
    expect(v.skill).toEqual(skill)
    for (const kind of ['self', 'single', 'radius', 'line'] as const) {
      const t = { ...form, target: { ...form.target, kind } }
      const out = validateForm(t, pack)
      expect(out.errors).toEqual({})
      expect(out.skill?.target.kind).toBe(kind)
    }
    expect(skillFromJson(skillToJson(skill))).toEqual({ skill })
  })

  it('duplicates a pack skill with a fresh id and a (copy) name', () => {
    const fireball = pack.skills.find((s) => s.id === 'fireball')!
    const form = duplicateForm(fireball, ['fireball', 'fireball-copy'])
    expect(form.id).toBe('fireball-copy-2')
    expect(form.name).toBe('Fireball (copy)')
    expect(form.idFollowsName).toBe(true)
    const saved = validateForm(form, pack).skill!
    expect(saved).toEqual({ ...fireball, id: 'fireball-copy-2', name: 'Fireball (copy)' })
  })

  it('drops empty optionals so the JSON stays clean', () => {
    const form = emptyForm()
    form.id = 'bare'
    form.name = 'Bare'
    form.description = 'x'
    form.effects = []
    form.vfx = [emptyVfx('hit')]
    form.vfx[0].from = ''
    const skill = validateForm(form, pack).skill!
    expect(skill).toEqual({ id: 'bare', name: 'Bare', description: 'x', target: { kind: 'single', range: 1 }, effects: [], vfx: [{ at: 0, preset: 'hit' }] })
    expect('cost' in skill).toBe(false)
    expect('icon' in skill).toBe(false)
  })
})

describe('validation', () => {
  const base = () => {
    const form = emptyForm()
    form.id = 'ok'
    form.name = 'Ok'
    form.description = 'fine'
    return form
  }

  it('reports missing identity fields', () => {
    const v = validateForm(emptyForm(), pack)
    expect(v.errors.id).toBe('required')
    expect(v.errors.name).toBe('required')
    expect(v.errors.description).toBe('required')
    expect(v.skill).toBeNull()
  })

  it('rejects ids that are not slugs', () => {
    const form = base()
    form.id = 'Fire Ball'
    expect(validateForm(form, pack).errors.id).toMatch(/lowercase/)
  })

  it('surfaces expression syntax errors per field', () => {
    const form = base()
    form.cost = [{ resource: 'wil', amount: '1 +' }]
    form.effects = [
      { kind: 'roll', formula: 'd20 )', vs: 'target.dex', label: 'save' },
      { kind: 'damage', formula: '', resource: '' },
      { kind: 'message', text: 'Hits for {2d6 +} points' },
      { kind: 'message', text: 'unbalanced {source.name' },
      { kind: 'move', cells: '1.5' },
    ]
    const v = validateForm(form, pack)
    expect(v.errors['cost.0.amount']).toBeTruthy()
    expect(v.errors['effects.0.formula']).toBeTruthy()
    expect(v.errors['effects.0.vs']).toBeUndefined()
    expect(v.errors['effects.1.formula']).toBe('required')
    expect(v.errors['effects.1.resource']).toBe('pick a resource')
    expect(v.errors['effects.2.text']).toMatch(/\{2d6 \+\}/)
    expect(v.errors['effects.3.text']).toMatch(/unbalanced/)
    expect(v.errors['effects.4.cells']).toMatch(/whole number/)
    expect(v.skill).toBeNull()
  })

  it('checks target numbers, conditions and vfx cues', () => {
    const form = base()
    form.target = { kind: 'radius', range: '', radius: 'abc', angle: '60', width: '1' }
    form.effects = [{ kind: 'condition', add: [], remove: [] }, { kind: 'condition', add: ['petrified'], remove: [] }]
    form.vfx = [{ ...emptyVfx('ring'), at: '-5', color: 'red', duration: 'x' }, { ...emptyVfx('sound'), asset: '' }]
    const v = validateForm(form, pack)
    expect(v.errors['target.range']).toBe('required')
    expect(v.errors['target.radius']).toBe('must be a number')
    expect(v.errors['effects.0.add']).toMatch(/at least one/)
    expect(v.errors['effects.1.add']).toMatch(/unknown condition: petrified/)
    expect(v.errors['vfx.0.at']).toMatch(/at least 0/)
    expect(v.errors['vfx.0.color']).toMatch(/hex/)
    expect(v.errors['vfx.0.duration']).toBe('must be a number')
    expect(v.errors['vfx.1.asset']).toMatch(/asset/)
  })

  it('accepts a freshly added effect of every kind', () => {
    const form = base()
    form.effects = (['roll', 'damage', 'heal', 'move', 'message'] as const).map((k) => emptyEffect(k))
    const v = validateForm(form, pack)
    expect(v.errors).toEqual({})
    expect(v.skill?.effects).toHaveLength(5)
  })

  it('rejects bad JSON with a readable message', () => {
    expect(skillFromJson('{')).toMatchObject({ error: expect.stringMatching(/invalid JSON/) })
    expect(skillFromJson('{"id":"x"}')).toMatchObject({ error: expect.stringMatching(/name/) })
    expect(skillFromJson(JSON.stringify({ id: 'x', name: 'X', description: 'd', target: { kind: 'self' }, effects: [{ kind: 'explode' }], vfx: [] }))).toMatchObject({ error: expect.stringMatching(/unknown effect kind/) })
  })
})

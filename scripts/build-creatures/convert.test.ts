/** The Open5e to pack conversion behind `npm run creatures` (scripts/build-creatures). */
import { describe, expect, it } from 'vitest'
import { cleanText, creatureData, damageTypeList, diceOnly, parseAction, parseDamage, pbForCr } from './convert.mjs'

describe('Open5e creature conversion', () => {
  it('proficiency bonus follows challenge rating', () => {
    expect([0, 0.25, 4, 5, 9, 17, 30].map(pbForCr)).toEqual([2, 2, 2, 3, 4, 6, 9])
  })

  it('reads damage with riders, skipping conditional ones', () => {
    expect(parseDamage('Hit: 5 (1d6 + 2) slashing damage.')).toEqual({ damage: '1d6+2', type: 'slashing', types: ['slashing'] })
    // One type per damage row: the main one; the rider's type is kept in `types`.
    expect(parseDamage('13 (1d10 + 8) Slashing damage plus 5 (2d4) Fire damage.')).toEqual({ damage: '1d10+8+2d4', type: 'slashing', types: ['slashing', 'fire'] })
    expect(parseDamage('5 (1d6 + 2) Slashing damage, plus 2 (1d4) Slashing damage if the attack roll had Advantage.')).toMatchObject({ damage: '1d6+2', type: 'slashing' })
    expect(parseDamage('Hit: 1 piercing damage.')).toMatchObject({ damage: '1', type: 'piercing' })
    expect(diceOnly('1d10+8+2d4')).toBe('1d10+2d4')
  })

  it('parses SRD 5.1 and SRD 5.2 attack lines', () => {
    expect(parseAction({ name: 'Shortbow', action_type: 'ACTION', desc: 'Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.' }))
      .toMatchObject({ kind: 'ranged', bonus: 4, cells: 16, damage: '1d6+2', dice: '1d6', damage_type: 'piercing' })
    expect(parseAction({ name: 'Tentacle', action_type: 'ACTION', desc: 'Melee Attack Roll: +9, reach 15 ft. 12 (2d6 + 5) Bludgeoning damage.' }))
      .toMatchObject({ kind: 'melee', bonus: 9, cells: 3, damage: '2d6+5' })
    expect(parseAction({ name: 'Multiattack', action_type: 'ACTION', desc: 'The goblin makes two attacks.' })).toMatchObject({ kind: 'other' })
  })

  it('parses saves with areas, half damage and save-only effects', () => {
    expect(parseAction({ name: 'Fire Breath', action_type: 'ACTION', desc: 'Dexterity Saving Throw: DC 21, each creature in a 60-foot Cone. Failure: 59 (17d6) Fire damage. Success: Half damage.' }))
      .toMatchObject({ kind: 'save', ability: 'dex', dc: 21, shape: 'cone', cells: 12, damage: '17d6', half: 1 })
    expect(parseAction({ name: 'Breath', action_type: 'ACTION', desc: 'The dragon exhales acid in a 30-foot line that is 5 feet wide. Each creature in that line must make a DC 11 Dexterity saving throw, taking 22 (5d8) acid damage on a failed save, or half as much damage on a successful one.' }))
      .toMatchObject({ kind: 'save', ability: 'dex', dc: 11, shape: 'line', cells: 6, half: 1 })
    expect(parseAction({ name: 'Gaze', action_type: 'REACTION', desc: 'Wisdom Saving Throw: DC 15, one creature within 30 feet. Failure: The target has the Frightened condition.' }))
      .toMatchObject({ kind: 'save-only', type: 'reaction', ability: 'wis', shape: 'single', cells: 6 })
  })

  it('turns resistance and immunity text into damage type ids, leaving out qualified physical damage', () => {
    expect(damageTypeList('necrotic, poison')).toEqual(['necrotic', 'poison'])
    expect(damageTypeList('cold; bludgeoning, piercing, and slashing from nonmagical attacks')).toEqual(['cold'])
    expect(damageTypeList("bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered")).toEqual([])
    expect(damageTypeList('Bludgeoning, Fire')).toEqual(['bludgeoning', 'fire'])
    expect(damageTypeList('')).toEqual([])
  })

  it('strips markup left over from cross-references', () => {
    expect(cleanText('_Trigger:_ hit. in a 20-foot-radius Sphere [Area of Effect]|XPHB|Sphere, has Cover|XPHB|Total Cover, a Short Rest|XPHB|Short or Long Rest.'))
      .toBe('Trigger: hit. in a 20-foot-radius Sphere, has Total Cover, a Short or Long Rest.')
  })

  it('turns listed saves and skills into exact proficiency multiples', () => {
    const d = creatureData({
      challenge_rating: 10, armor_class: 17, hit_points: 150, hit_dice: '20d10 + 40', experience_points: 5900, initiative_bonus: 7,
      ability_scores: { strength: 21, dexterity: 9, constitution: 15, intelligence: 18, wisdom: 15, charisma: 18 },
      saving_throws: { dexterity: 3, constitution: 6 }, skill_bonuses: { history: 12, perception: 10 },
      speed: { walk: 10 }, speed_all: { walk: 10, swim: 40 }, passive_perception: 20, darkvision_range: 120, actions: [], traits: [],
    })
    expect(d).toMatchObject({ prof_bonus: 4, armor_base: 17, armor_dex_cap: 0, hp: { current: 150, max: 150 }, hp_dice: '20d10+40', initiative_bonus: 8, xp: 5900, cr_text: '10' })
    expect(d.save_prof).toEqual({ str: 0, dex: 1, con: 1, int: 0, wis: 0, cha: 0 })
    expect(d.prof.history).toBe(2)
    expect(d.speed_text).toBe('10 ft., swim 40 ft.')
    expect(d.senses).toBe('darkvision 120 ft., passive Perception 20')
  })
})

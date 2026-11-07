import { beforeAll, describe, expect, it } from 'vitest'
import type { Character, ChatMessage, Token } from '@/core/doc'
import type { CharacterId, PlayerPubkey, SceneId, SkillId, TokenId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { createRulesEngine, loadPack, type RulesEngine } from '@/rules'
import { fileFetch } from '@/rules/test-helpers'
import { concentrationContext, damageContext, skillExtras, type DocView } from './combat'
import { canSeeRoll, hiddenRollText, useRollMode, withRollMode, type RollModeState } from './rollMode'

let rules: RulesEngine
beforeAll(async () => {
  rules = createRulesEngine(await loadPack('packs/dnd5e/', fileFetch))
})

const me = 'bb'.repeat(32) as PlayerPubkey
const gm = 'aa'.repeat(32) as PlayerPubkey
const tok = (id: string, extra: Partial<Token> = {}): Token => ({
  id: id as TokenId, scene: 's' as SceneId, name: id, color: '#fff', position: { x: 0, y: 0, z: 0 },
  rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [], ...extra,
})
const sheet = (id: string, data: Record<string, unknown> = {}): Character => ({
  id: id as CharacterId, name: id,
  data: { con: 10, dex: 10, level: 1, armor_base: 10, armor_dex_cap: 10, shield: 0, ac_bonus: 0, save_prof: { con: 0 }, hp: { current: 20, max: 20 }, temp_hp: 0, resistances: [], vulnerabilities: [], immunities: [], conditions: [], ...data },
})

function state(over: Partial<RollModeState> = {}): RollModeState {
  const s: RollModeState = { advantage: null, visibility: 'public', setAdvantage: (a) => { s.advantage = a }, setVisibility: (v) => { s.visibility = v }, ...over }
  return s
}

describe('withRollMode', () => {
  it('stamps advantage on the next d20 roll and spends it', () => {
    const s = state({ advantage: 'advantage' })
    const damage = withRollMode({ type: 'roll', formula: '2d6', seed: 'x' }, rules, s)
    expect(damage).toEqual({ type: 'roll', formula: '2d6', seed: 'x' })
    expect(s.advantage).toBe('advantage')
    expect(withRollMode({ type: 'roll', formula: 'd20 + 3', seed: 'x' }, rules, s)).toMatchObject({ advantage: 'advantage' })
    expect(s.advantage).toBeNull()
  })
  it('applies to skills with an attack roll but not to save-only skills', () => {
    const attack = withRollMode({ type: 'skill.use', skill: 'attack-melee' as SkillId, source: 'a' as TokenId, targets: [], seed: 'x' }, rules, state({ advantage: 'disadvantage' }))
    expect(attack).toMatchObject({ advantage: 'disadvantage' })
    const save = withRollMode({ type: 'skill.use', skill: 'sacred-flame' as SkillId, source: 'a' as TokenId, targets: [], seed: 'x' }, rules, state({ advantage: 'advantage' }))
    expect(save).not.toHaveProperty('advantage')
  })
  it('keeps visibility until changed; explicit fields win; other intents pass through', () => {
    const s = state({ visibility: 'gm' })
    expect(withRollMode({ type: 'roll', formula: 'd6', seed: 'x' }, rules, s)).toMatchObject({ visibility: 'gm' })
    expect(withRollMode({ type: 'roll', formula: 'd6', seed: 'x', visibility: 'public' }, rules, s)).toMatchObject({ visibility: 'public' })
    const say: Intent = { type: 'chat.say', text: 'hi' }
    expect(withRollMode(say, rules, s)).toBe(say)
    expect(useRollMode.getState().visibility).toBe('public')
  })
})

describe('canSeeRoll', () => {
  const m = (visibility: ChatMessage['visibility'], author: string) => ({ visibility, author: author as PlayerPubkey, text: 'Stealth' })
  it('shows public rolls to all, GM rolls to roller and GM, blind rolls to the GM only', () => {
    expect(canSeeRoll(m(undefined, me), 'cc', gm)).toBe(true)
    expect(canSeeRoll(m('gm', me), me, gm)).toBe(true)
    expect(canSeeRoll(m('gm', me), 'cc', gm)).toBe(false)
    expect(canSeeRoll(m('gm', me), gm, gm)).toBe(true)
    expect(canSeeRoll(m('blind', me), me, gm)).toBe(false)
    expect(canSeeRoll(m('blind', me), gm, gm)).toBe(true)
    expect(hiddenRollText(m('blind', me), me)).toMatch(/^Stealth: rolled blind/)
    expect(hiddenRollText(m('gm', me), 'cc')).toBe('rolled for the GM')
  })
})

describe('damageContext', () => {
  const doc = (chat: ChatMessage[], tokens: Token[], characters: Character[]): DocView => ({
    chat, tokens: Object.fromEntries(tokens.map((t) => [t.id, t])), characters: Object.fromEntries(characters.map((c) => [c.id, c])),
  })
  const roll: ChatMessage = { id: 'm1', author: gm, at: 1, kind: 'roll', text: 'Fireball', roll: { formula: '8d6', seed: 'x', dice: [], total: 28 } }

  it('creates the card from a roll with the chosen type and applies resistance', () => {
    const v = doc([roll], [tok('g', { character: 'cg' as CharacterId })], [sheet('cg', { resistances: ['fire'], temp_hp: 4 })])
    const r = damageContext(rules, v, { type: 'damage.apply', message: 'm1', token: 'g' as TokenId, factor: 1, damageType: 'fire' })!
    expect(r.card).toMatchObject({ amount: 28, type: 'fire', targets: [{ token: 'g', applied: { factor: 1, amount: 14, note: 'resistant' } }] })
    expect(r.patch?.data).toEqual({ hp: { current: 10, max: 20 }, temp_hp: 0 })
    expect(r.numbers).toEqual([{ token: 'g', delta: -4, resource: 'temp_hp' }, { token: 'g', delta: -10, resource: 'hp' }])
    expect(r.notices).toEqual(['g takes 14 fire damage, resistant.'])
  })
  it('swaps a skill card\'s applied damage for half, netting the change', () => {
    const card = { amount: 10, type: 'fire', targets: [{ token: 'g' as TokenId, amount: 10, applied: { factor: 1 as const, amount: 10, changes: [{ key: 'hp', delta: -10 }] } }] }
    const msg: ChatMessage = { id: 'm2', author: gm, at: 1, kind: 'system', text: 'Burning Hands: damage', damage: card }
    const v = doc([msg], [tok('g', { character: 'cg' as CharacterId })], [sheet('cg', { hp: { current: 10, max: 20 } })])
    const r = damageContext(rules, v, { type: 'damage.apply', message: 'm2', token: 'g' as TokenId, factor: 0.5 })!
    expect(r.patch?.data).toEqual({ hp: { current: 15, max: 20 } })
    expect(r.numbers).toEqual([{ token: 'g', delta: 5, resource: 'hp' }])
    expect(r.card.targets[0]).toMatchObject({ amount: 10, applied: { factor: 0.5, amount: 5 } })
    expect(r.notices[0]).toBe('g now takes 5 fire damage (half).')
  })
  it('asks a concentrating token for a save, or drops it at 0', () => {
    const caster = tok('c', { character: 'cc' as CharacterId, concentrating: { skill: 's', name: 'S' } })
    const hit = damageContext(rules, doc([roll], [caster], [sheet('cc')]), { type: 'damage.apply', message: 'm1', token: 'c' as TokenId, factor: 0.5 })!
    expect(hit.check).toEqual({ token: 'c', dc: 10 })
    const big: ChatMessage = { ...roll, roll: { ...roll.roll!, total: 30 } }
    const harder = damageContext(rules, doc([big], [caster], [sheet('cc', { hp: { current: 40, max: 40 } })]), { type: 'damage.apply', message: 'm1', token: 'c' as TokenId, factor: 1 })!
    expect(harder.check?.dc).toBe(15)
    const down = damageContext(rules, doc([big], [caster], [sheet('cc')]), { type: 'damage.apply', message: 'm1', token: 'c' as TokenId, factor: 1 })!
    expect(down.drop).toBe(true)
  })
  it('marks a sheetless token without changing anything', () => {
    const r = damageContext(rules, doc([roll], [tok('m')], []), { type: 'damage.apply', message: 'm1', token: 'm' as TokenId, factor: 2 })!
    expect(r.patch).toBeUndefined()
    expect(r.card.targets[0].applied).toEqual({ factor: 2, amount: 56, changes: [] })
  })
})

describe('skillExtras and concentration saves', () => {
  it('builds the card, durations on the caster\'s turns and the concentration link', async () => {
    const caster = { ...sheet('cc', { wis: 16, spell_ability: 'wis', caster: 'full', slots_1: { current: 2, max: 2 } }), name: 'Mirabel' }
    const ally = sheet('ca')
    const intent = { type: 'skill.use' as const, skill: 'shield-of-faith' as SkillId, source: 'c' as TokenId, targets: ['a' as TokenId], seed: 'x' }
    const r = await rules.resolveSkill('shield-of-faith', caster, [ally], 'x')
    const out = skillExtras(rules, { tokens: {}, characters: {}, chat: [] }, intent, ['a' as TokenId], r)
    expect(out.effects).toEqual([{ token: 'a', condition: 'shield-of-faith', effect: { remaining: 100, on: 'c' } }])
    expect(out.concentration).toEqual({ skill: 'shield-of-faith', name: 'Shield of Faith' })
    expect(out.card).toBeUndefined()
  })
  it('rolls the pack\'s CON save against the prompt DC', async () => {
    const prompt: ChatMessage = { id: 'p', author: gm, at: 1, kind: 'system', text: '', concentration: { token: 'c' as TokenId, dc: 1 } }
    const v: DocView = { chat: [prompt], tokens: { c: tok('c', { character: 'cc' as CharacterId }) }, characters: { cc: sheet('cc') } }
    const r = await concentrationContext(rules, v, { type: 'concentration.save', message: 'p', token: 'c' as TokenId, seed: 'z'.repeat(8) })
    expect(r?.kept).toBe(true)
    expect(r?.roll.formula).toBe('d20 + con_mod + save_prof.con * pb')
    expect(r?.label).toBe('c · Concentration save (DC 1)')
    const done = await concentrationContext(rules, { ...v, chat: [{ ...prompt, concentration: { ...prompt.concentration!, result: 'kept' } }] }, { type: 'concentration.save', message: 'p', token: 'c' as TokenId, seed: 'z' })
    expect(done).toBeUndefined()
  })
})

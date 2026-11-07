import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyIntent, type ApplyContext } from './apply'
import type { Character, ChatMessage, InitiativeEntry, Token } from '@/core/doc'
import type { CharacterId, PlayerPubkey, SceneId, SkillId, TokenId } from '@/core/ids'
import type { Intent } from '@/core/intents'

const gm = 'aa'.repeat(32) as PlayerPubkey
const env = (intent: Intent) => ({ id: crypto.randomUUID(), from: gm, at: 1, intent })
const names: ApplyContext['pack'] = { conditionName: (id) => id.toUpperCase(), concentration: 'concentrating' }

function tok(id: string, extra: Partial<Token> = {}): Token {
  return {
    id: id as TokenId, scene: 's1' as SceneId, name: id, color: '#fff',
    position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 3, light: 0, hidden: false, conditions: [], ...extra,
  }
}
const ch = (id: string, data: Record<string, unknown> = {}): Character => ({ id: id as CharacterId, name: id, data: { conditions: [], ...data } })

function setup(tokens: Token[], characters: Character[] = []) {
  const doc = new Y.Doc()
  for (const t of tokens) applyIntent(doc, env({ type: 'token.add', token: t }))
  for (const c of characters) applyIntent(doc, env({ type: 'character.upsert', character: c }))
  const token = (id: string) => doc.getMap<Token>('tokens').get(id)!
  const sheet = (id: string) => doc.getMap<Character>('characters').get(id)!
  const chat = () => doc.getArray<ChatMessage>('chat').toArray()
  return { doc, token, sheet, chat }
}
const order = (...ids: string[]): InitiativeEntry[] => ids.map((id, i) => ({ token: id as TokenId, score: 20 - i }))

describe('condition durations', () => {
  it('count down on the bearer\'s turn end and expire with a notice', () => {
    const { doc, token, sheet, chat } = setup(
      [tok('a', { character: 'ca' as CharacterId, conditions: ['prone'], effects: { prone: { remaining: 2 }, poisoned: { remaining: 1, tick: 'start' } } }), tok('b')],
      [ch('ca', { conditions: ['poisoned'] })],
    )
    applyIntent(doc, env({ type: 'initiative.start', order: order('a', 'b') }), { pack: names })
    // Start of a's first turn: the start-ticking poison runs out (on the sheet's list too).
    expect(sheet('ca').data.conditions).toEqual([])
    expect(token('a').effects).toEqual({ prone: { remaining: 2 } })
    applyIntent(doc, env({ type: 'initiative.next' }), { pack: names })
    expect(token('a').effects).toEqual({ prone: { remaining: 1 } })
    applyIntent(doc, env({ type: 'initiative.next' }), { pack: names }) // b ends: nothing for a
    expect(token('a').effects?.prone.remaining).toBe(1)
    applyIntent(doc, env({ type: 'initiative.next' }), { pack: names }) // a ends again: prone expires
    expect(token('a').conditions).toEqual([])
    expect(token('a').effects).toBeUndefined()
    expect(chat().map((m) => m.text)).toEqual(['a is no longer POISONED (duration ended).', 'a is no longer PRONE (duration ended).'])
  })
  it('counts the turns of `on` (the caster), not the bearer', () => {
    const { doc, token } = setup([tok('caster'), tok('ally', { conditions: ['blessed'], effects: { blessed: { remaining: 1, on: 'caster' as TokenId } } })])
    applyIntent(doc, env({ type: 'initiative.start', order: order('ally', 'caster') }), { pack: names })
    applyIntent(doc, env({ type: 'initiative.next' }), { pack: names })
    expect(token('ally').conditions).toEqual(['blessed'])
    applyIntent(doc, env({ type: 'initiative.next' }), { pack: names })
    expect(token('ally').conditions).toEqual([])
  })
  it('do not tick when a player\'s end-turn is refused', () => {
    const { doc, token } = setup([tok('a', { conditions: ['prone'], effects: { prone: { remaining: 1 } } }), tok('b')])
    applyIntent(doc, env({ type: 'initiative.start', order: order('a', 'b') }), { pack: names })
    applyIntent(doc, env({ type: 'initiative.next', token: 'b' as TokenId }), { pack: names })
    expect(token('a').conditions).toEqual(['prone'])
  })
})

describe('concentration', () => {
  const skillCtx = (condition: string, target: string): ApplyContext => ({
    pack: names,
    skill: {
      patches: [{ character: `c${target}`, data: { conditions: [condition] } }],
      messages: [],
      effects: [{ token: target as TokenId, condition, effect: { remaining: 10 } }],
      concentration: { skill: condition, name: condition.toUpperCase() },
    },
  })
  const cast = (skill: string, target: string): Intent => ({ type: 'skill.use', skill: skill as SkillId, source: 'caster' as TokenId, targets: [target as TokenId], seed: 'x' })

  it('a new concentration skill ends the previous one and its conditions', () => {
    const { doc, token, sheet, chat } = setup(
      [tok('caster'), tok('x', { character: 'cx' as CharacterId }), tok('y', { character: 'cy' as CharacterId })],
      [ch('cx'), ch('cy')],
    )
    applyIntent(doc, env(cast('shield', 'x')), skillCtx('shield', 'x'))
    expect(token('caster').concentrating).toEqual({ skill: 'shield', name: 'SHIELD' })
    expect(token('caster').conditions).toEqual(['concentrating'])
    expect(token('x').effects).toEqual({ shield: { remaining: 10, concentration: 'caster' } })
    applyIntent(doc, env(cast('bless', 'y')), skillCtx('bless', 'y'))
    expect(sheet('cx').data.conditions).toEqual([])
    expect(token('x').effects).toBeUndefined()
    expect(sheet('cy').data.conditions).toEqual(['bless'])
    expect(token('caster').concentrating?.skill).toBe('bless')
    expect(token('caster').conditions).toEqual(['concentrating'])
    expect(chat().map((m) => m.text)).toContain('caster is no longer concentrating on SHIELD (now BLESS).')
  })
  it('recasting on the same target keeps the condition', () => {
    const { doc, sheet } = setup([tok('caster'), tok('x', { character: 'cx' as CharacterId })], [ch('cx')])
    applyIntent(doc, env(cast('shield', 'x')), skillCtx('shield', 'x'))
    applyIntent(doc, env(cast('shield', 'x')), skillCtx('shield', 'x'))
    expect(sheet('cx').data.conditions).toEqual(['shield'])
  })
  it('prompts a save on damage, ends on a failed save or by hand', () => {
    const { doc, token, chat } = setup([tok('caster', { concentrating: { skill: 's', name: 'S' }, conditions: ['concentrating'] }), tok('x', { conditions: ['s'], effects: { s: { concentration: 'caster' as TokenId } } })])
    applyIntent(doc, env({ type: 'roll', formula: '2d6', seed: 'x' }), { roll: { formula: '2d6', seed: 'x', dice: [], total: 12 } })
    const roll = chat()[0]
    applyIntent(doc, env({ type: 'damage.apply', message: roll.id, token: 'caster' as TokenId, factor: 1 }), {
      pack: names,
      damage: { card: { amount: 12, targets: [{ token: 'caster' as TokenId, applied: { factor: 1, amount: 12, changes: [] } }] }, notices: ['caster takes 12 damage.'], numbers: [], check: { token: 'caster' as TokenId, dc: 10 } },
    })
    expect(chat()[0].damage?.targets[0].applied?.amount).toBe(12)
    const prompt = chat().find((m) => m.concentration)!
    expect(prompt.concentration).toEqual({ token: 'caster', dc: 10 })
    applyIntent(doc, env({ type: 'concentration.save', message: prompt.id, token: 'caster' as TokenId, seed: 'y' }), {
      pack: names,
      concentration: { roll: { formula: 'd20', seed: 'y', dice: [{ sides: 20, value: 3 }], total: 3 }, label: 'caster · Concentration save', kept: false },
    })
    expect(chat().find((m) => m.id === prompt.id)?.concentration?.result).toBe('lost')
    expect(token('caster').concentrating).toBeUndefined()
    expect(token('caster').conditions).toEqual([])
    expect(token('x').conditions).toEqual([])
  })
  it('dismisses a prompt and drops concentration at 0', () => {
    const { doc, token, chat } = setup([tok('caster', { concentrating: { skill: 's', name: 'S' } })])
    applyIntent(doc, env({ type: 'roll', formula: '2d6', seed: 'x' }), { roll: { formula: '2d6', seed: 'x', dice: [], total: 40 } })
    applyIntent(doc, env({ type: 'damage.apply', message: chat()[0].id, token: 'caster' as TokenId, factor: 1 }), {
      pack: names, damage: { card: { amount: 40, targets: [] }, notices: [], numbers: [], drop: true },
    })
    expect(token('caster').concentrating).toBeUndefined()
    expect(chat().some((m) => m.concentration)).toBe(false)
  })
})

describe('roll visibility', () => {
  it('stores the visibility on the message and a reveal clears it', () => {
    const { doc, chat } = setup([])
    applyIntent(doc, env({ type: 'roll', formula: 'd20', seed: 'x', visibility: 'blind' }), { roll: { formula: 'd20', seed: 'x', dice: [], total: 7 } })
    applyIntent(doc, env({ type: 'roll', formula: 'd20', seed: 'y', visibility: 'public' }), { roll: { formula: 'd20', seed: 'y', dice: [], total: 7 } })
    expect(chat().map((m) => m.visibility)).toEqual(['blind', undefined])
    applyIntent(doc, env({ type: 'roll.reveal', message: chat()[0].id }))
    expect(chat()[0].visibility).toBeUndefined()
    expect(chat()[0].roll?.total).toBe(7)
  })
})

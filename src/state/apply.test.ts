import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyIntent, skillNumbers } from './apply'
import type { Character, GameEvent, Token } from '@/core/doc'
import type { CharacterId, PlayerPubkey, SceneId, SkillId, TokenId } from '@/core/ids'

const from = 'aa'.repeat(32) as PlayerPubkey
const env = (intent: Parameters<typeof applyIntent>[1]['intent']) => ({ id: crypto.randomUUID(), from, at: 1, intent })
const token: Token = {
  id: 't1' as TokenId, scene: 's1' as SceneId, name: 'Mouse', color: '#fff',
  position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 3, light: 0, hidden: false, conditions: [],
}

describe('applyIntent', () => {
  it('adds, moves and updates tokens', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'token.add', token }))
    applyIntent(doc, env({ type: 'token.move', token: token.id, position: { x: 1, y: 0, z: 2 } }))
    applyIntent(doc, env({ type: 'token.update', token: token.id, patch: { name: 'Rat' } }))
    const t = doc.getMap<Token>('tokens').get(token.id)!
    expect(t.position).toEqual({ x: 1, y: 0, z: 2 })
    expect(t.name).toBe('Rat')
  })
  it('accumulates fog reveals without duplicates', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'fog.reveal', scene: 's1' as SceneId, cells: ['0,0', '1,0'] }))
    applyIntent(doc, env({ type: 'fog.reveal', scene: 's1' as SceneId, cells: ['1,0', '2,0'] }))
    expect(doc.getMap('fog').get('s1')).toMatchObject({ revealed: ['0,0', '1,0', '2,0'] })
  })
  it('records rolls in chat', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'roll', formula: 'd20', seed: 'x' }), {
      roll: { formula: 'd20', seed: 'x', dice: [{ sides: 20, value: 7 }], total: 7 },
    })
    expect(doc.getArray('chat').toJSON()[0]).toMatchObject({ kind: 'roll', roll: { total: 7 } })
  })
})

describe('skillNumbers', () => {
  const before = (id: string) => (id === 'c1' ? { hp: { current: 6, max: 6 }, wil: 4, conditions: [], name: 'Pip' } : undefined)
  const tokensOf = (id: string) => (id === 'c1' ? ['t1' as TokenId] : [])
  it('reports deltas for changed { current } objects and bare numbers', () => {
    const out = skillNumbers([{ character: 'c1', data: { hp: { current: 2, max: 6 }, wil: 3, conditions: ['hurt'] } }], before, tokensOf)
    expect(out).toEqual([
      { token: 't1', delta: -4, resource: 'hp' },
      { token: 't1', delta: -1, resource: 'wil' },
    ])
  })
  it('drops unchanged values, unknown characters and characters without a token', () => {
    expect(skillNumbers([{ character: 'c1', data: { hp: { current: 6, max: 5 } } }], before, tokensOf)).toEqual([])
    expect(skillNumbers([{ character: 'zz', data: { hp: 1 } }], before, tokensOf)).toEqual([])
    expect(skillNumbers([{ character: 'c1', data: { hp: 1 } }], before, () => [])).toEqual([])
  })
})

describe('skill.use events', () => {
  const sceneId = 's1' as SceneId
  const rat: Token = { ...token, id: 't2' as TokenId, name: 'Rat', character: 'c2' as CharacterId }
  const pip: Token = { ...token, character: 'c1' as CharacterId }
  const sheet = (id: string, name: string, hp: number): Character => ({ id: id as CharacterId, name, data: { hp: { current: hp, max: 6 } } })
  const setup = () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'token.add', token: pip }))
    applyIntent(doc, env({ type: 'token.add', token: rat }))
    applyIntent(doc, env({ type: 'character.upsert', character: sheet('c1', 'Pip', 6) }))
    applyIntent(doc, env({ type: 'character.upsert', character: sheet('c2', 'Rat', 3) }))
    return doc
  }
  const use = { type: 'skill.use' as const, skill: 'attack' as SkillId, source: pip.id, targets: [rat.id], seed: 'x' }

  it('attaches the resource deltas to the vfx event, mapped to the tokens that show the sheets', () => {
    const doc = setup()
    applyIntent(doc, env(use), {
      skill: {
        patches: [{ character: 'c2', data: { hp: { current: 1, max: 6 } } }],
        messages: ['Pip attacks Rat.', 'Rat takes 2 damage (Hit Protection 3 to 1).'],
        vfx: [{ at: 0, preset: 'hit' }],
      },
    })
    const events = doc.getArray<GameEvent>('events').toJSON() as GameEvent[]
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'vfx', scene: sceneId, numbers: [{ token: rat.id, delta: -2, resource: 'hp' }] })
    expect(doc.getMap<Character>('characters').get('c2')!.data).toEqual({ hp: { current: 1, max: 6 } })
    expect(doc.getArray('chat').length).toBe(2)
  })
  it('still emits an event for a skill with no cues when numbers exist, and none at all otherwise', () => {
    const doc = setup()
    applyIntent(doc, env(use), { skill: { patches: [{ character: 'c1', data: { hp: { current: 5, max: 6 } } }], messages: [], vfx: [] } })
    const events = doc.getArray<GameEvent>('events').toJSON() as GameEvent[]
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ cues: [], numbers: [{ token: pip.id, delta: -1, resource: 'hp' }] })

    const quiet = setup()
    applyIntent(quiet, env(use), { skill: { patches: [], messages: ['Nothing happens.'], vfx: [] } })
    expect(quiet.getArray('events').length).toBe(0)
  })
  it('omits `numbers` when nothing changed', () => {
    const doc = setup()
    applyIntent(doc, env(use), { skill: { patches: [], messages: [], vfx: [{ at: 0, preset: 'hit' }] } })
    const ev = (doc.getArray<GameEvent>('events').toJSON() as GameEvent[])[0]!
    expect('numbers' in ev).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyIntent, nextTurn, skillNumbers, sortInitiative, withOrder, withoutToken } from './apply'
import type { Character, GameEvent, InitiativeState, PlacedLight, Token, Wall } from '@/core/doc'
import type { CharacterId, LightId, PlayerPubkey, PrefabId, SceneId, SkillId, TokenId, WallId } from '@/core/ids'

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
  it('records soundboard stops as audio-stop events, for one sound or all', () => {
    const doc = new Y.Doc()
    const asset = { sha256: 'ab'.repeat(32), kind: 'audio', mime: 'audio/ogg', size: 1, sources: [] } as never
    applyIntent(doc, env({ type: 'audio.stop', asset }))
    applyIntent(doc, env({ type: 'audio.stop' }))
    const evs = doc.getArray<GameEvent>('events').toArray()
    expect(evs.map((e) => e.kind)).toEqual(['audio-stop', 'audio-stop'])
    expect(evs[0]).toMatchObject({ asset, by: from })
    expect(evs[1]).not.toHaveProperty('asset')
  })
  it('accumulates fog reveals without duplicates', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'fog.reveal', scene: 's1' as SceneId, cells: ['0,0', '1,0'] }))
    applyIntent(doc, env({ type: 'fog.reveal', scene: 's1' as SceneId, cells: ['1,0', '2,0'] }))
    expect(doc.getMap('fog').get('s1')).toMatchObject({ revealed: ['0,0', '1,0', '2,0'] })
  })
  it('marks the whole map revealed and keeps the flag across reveals until a reset', () => {
    const doc = new Y.Doc()
    const scene = 's1' as SceneId
    applyIntent(doc, env({ type: 'fog.reveal', scene, cells: ['0,0'] }))
    applyIntent(doc, env({ type: 'fog.revealAll', scene }))
    expect(doc.getMap('fog').get(scene)).toEqual({ scene, revealed: ['0,0'], revealAll: true })
    applyIntent(doc, env({ type: 'fog.reveal', scene, cells: ['1,0'] }))
    expect(doc.getMap('fog').get(scene)).toEqual({ scene, revealed: ['0,0', '1,0'], revealAll: true })
    applyIntent(doc, env({ type: 'fog.reset', scene }))
    expect(doc.getMap('fog').get(scene)).toEqual({ scene, revealed: [] })
  })
  it('paints cells back into fog, also as exceptions to a fully revealed map', () => {
    const doc = new Y.Doc()
    const scene = 's1' as SceneId
    applyIntent(doc, env({ type: 'fog.hide', scene, cells: ['0,0'] }))
    expect(doc.getMap('fog').get(scene)).toBeUndefined()
    applyIntent(doc, env({ type: 'fog.reveal', scene, cells: ['0,0', '1,0', '2,0'] }))
    applyIntent(doc, env({ type: 'fog.hide', scene, cells: ['1,0'] }))
    expect(doc.getMap('fog').get(scene)).toEqual({ scene, revealed: ['0,0', '2,0'] })
    applyIntent(doc, env({ type: 'fog.revealAll', scene }))
    applyIntent(doc, env({ type: 'fog.hide', scene, cells: ['5,5', '6,5'] }))
    expect(doc.getMap('fog').get(scene)).toEqual({ scene, revealed: ['0,0', '2,0'], revealAll: true, hidden: ['5,5', '6,5'] })
    applyIntent(doc, env({ type: 'fog.reveal', scene, cells: ['5,5'] }))
    expect(doc.getMap('fog').get(scene)).toMatchObject({ revealAll: true, hidden: ['6,5'] })
    applyIntent(doc, env({ type: 'fog.revealAll', scene }))
    expect(doc.getMap('fog').get(scene)).not.toHaveProperty('hidden')
  })
  it('adds, updates and removes walls, and opens and closes doors', () => {
    const doc = new Y.Doc()
    const scene = 's1' as SceneId
    const wall = { id: 'w1' as WallId, scene, a: { x: 0, z: 0 }, b: { x: 1, z: 0 } }
    const door = { id: 'd1' as WallId, scene, a: { x: 1, z: 0 }, b: { x: 2, z: 0 }, door: { open: false } }
    applyIntent(doc, env({ type: 'wall.add', walls: [wall, door] }))
    applyIntent(doc, env({ type: 'door.set', wall: door.id, open: true }))
    expect(doc.getMap<Wall>('walls').get(door.id)?.door).toEqual({ open: true })
    // A wall is not a door: nothing happens.
    applyIntent(doc, env({ type: 'door.set', wall: wall.id, open: true }))
    expect(doc.getMap<Wall>('walls').get(wall.id)).toEqual(wall)
    applyIntent(doc, env({ type: 'wall.update', wall: door.id, patch: { door: { open: true, locked: true } } }))
    expect(doc.getMap<Wall>('walls').get(door.id)?.door).toEqual({ open: true, locked: true })
    applyIntent(doc, env({ type: 'wall.remove', walls: [wall.id, door.id] }))
    expect(doc.getMap('walls').size).toBe(0)
  })
  it('keeps placed lights and prefabs', () => {
    const doc = new Y.Doc()
    const scene = 's1' as SceneId
    const light = { id: 'l1' as LightId, scene, position: { x: 1, y: 0, z: 1 }, radius: 4, color: '#fff' }
    applyIntent(doc, env({ type: 'light.add', light }))
    applyIntent(doc, env({ type: 'light.update', light: light.id, patch: { radius: 6 } }))
    expect(doc.getMap<PlacedLight>('lights').get(light.id)?.radius).toBe(6)
    applyIntent(doc, env({ type: 'light.remove', light: light.id }))
    expect(doc.getMap('lights').size).toBe(0)
    const prefab = { id: 'pf1' as PrefabId, name: 'Hut', size: { x: 2, z: 2 }, cellSize: 1, props: [], walls: [], createdAt: 1 }
    applyIntent(doc, env({ type: 'prefab.upsert', prefab }))
    expect(doc.getMap('prefabs').get(prefab.id)).toEqual(prefab)
    applyIntent(doc, env({ type: 'prefab.remove', prefab: prefab.id }))
    expect(doc.getMap('prefabs').size).toBe(0)
  })
  it('removes a scene but never the live one, and leaves its tokens in place', () => {
    const doc = new Y.Doc()
    const grid = { type: 'square' as const, cellSize: 1, origin: { x: 0, y: 0, z: 0 } }
    const s1 = { id: 's1' as SceneId, name: 'One', grid, cameraMode: 'orbit' as const, darkness: 0.5 }
    const s2 = { id: 's2' as SceneId, name: 'Two', grid, cameraMode: 'orbit' as const, darkness: 0.5 }
    applyIntent(doc, env({ type: 'scene.add', scene: s1 }))
    applyIntent(doc, env({ type: 'scene.add', scene: s2 }))
    applyIntent(doc, env({ type: 'scene.activate', scene: s1.id }))
    applyIntent(doc, env({ type: 'token.add', token: { ...token, scene: s2.id } }))
    applyIntent(doc, env({ type: 'scene.remove', scene: s1.id }))
    expect(doc.getMap('scenes').has(s1.id)).toBe(true)
    applyIntent(doc, env({ type: 'scene.remove', scene: s2.id }))
    expect(doc.getMap('scenes').has(s2.id)).toBe(false)
    expect(doc.getMap<Token>('tokens').get(token.id)?.scene).toBe(s2.id)
    applyIntent(doc, env({ type: 'scene.add', scene: s2 }))
    expect(doc.getMap('scenes').get(s2.id)).toEqual(s2)
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

describe('initiative', () => {
  const t = (id: string) => id as TokenId
  const entry = (id: string, score: number) => ({ token: t(id), score })
  const read = (doc: Y.Doc) => doc.getMap('initiative').toJSON() as InitiativeState

  it('sorts highest first and keeps ties in the given order', () => {
    expect(sortInitiative([entry('a', 3), entry('b', 17), entry('c', 3), entry('d', 12)]).map((e) => e.token)).toEqual(['b', 'd', 'a', 'c'])
  })
  it('starts at round 1 on the top scorer and wraps the round on next', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'initiative.start', order: [entry('pip', 9), entry('rat', 15)], seed: 'abc' }))
    expect(read(doc)).toEqual({ active: true, round: 1, turn: 0, order: [entry('rat', 15), entry('pip', 9)] })
    applyIntent(doc, env({ type: 'initiative.next' }))
    expect(read(doc)).toMatchObject({ round: 1, turn: 1 })
    applyIntent(doc, env({ type: 'initiative.next' }))
    expect(read(doc)).toMatchObject({ round: 2, turn: 0 })
  })
  it('ends a named turn only while that token is up', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'initiative.start', order: [entry('rat', 15), entry('pip', 9)] }))
    applyIntent(doc, env({ type: 'initiative.next', token: t('pip') }))
    expect(read(doc)).toMatchObject({ turn: 0 })
    applyIntent(doc, env({ type: 'initiative.next', token: t('rat') }))
    expect(read(doc)).toMatchObject({ turn: 1 })
    applyIntent(doc, env({ type: 'initiative.next', token: t('rat') }))
    expect(read(doc)).toMatchObject({ turn: 1 })
  })
  it('ignores next, set and remove while nothing is running', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'initiative.next' }))
    applyIntent(doc, env({ type: 'initiative.set', order: [entry('pip', 1)] }))
    applyIntent(doc, env({ type: 'initiative.remove', token: t('pip') }))
    expect(doc.getMap('initiative').size).toBe(0)
  })
  it('set replaces the order and the current combatant keeps the turn', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'initiative.start', order: [entry('a', 20), entry('b', 10), entry('c', 5)] }))
    applyIntent(doc, env({ type: 'initiative.next' }))
    // b is up; the GM moves b to the top and adds d.
    applyIntent(doc, env({ type: 'initiative.set', order: [entry('b', 10), entry('a', 20), entry('d', 7), entry('c', 5)] }))
    expect(read(doc)).toMatchObject({ turn: 0, round: 1 })
    expect(read(doc).order.map((e) => e.token)).toEqual(['b', 'a', 'd', 'c'])
  })
  it('remove shifts the turn and hands it on when the current combatant leaves', () => {
    const base: InitiativeState = { active: true, round: 1, turn: 1, order: [entry('a', 20), entry('b', 10), entry('c', 5)] }
    expect(withoutToken(base, t('a'))).toMatchObject({ turn: 0, round: 1, order: [entry('b', 10), entry('c', 5)] })
    expect(withoutToken(base, t('b'))).toMatchObject({ turn: 1, round: 1, order: [entry('a', 20), entry('c', 5)] })
    expect(withoutToken({ ...base, turn: 2 }, t('c'))).toMatchObject({ turn: 0, round: 2 })
    expect(withoutToken({ ...base, turn: 0, order: [entry('a', 20)] }, t('a'))).toMatchObject({ turn: 0, round: 1, order: [] })
    expect(withoutToken(base, t('zzz'))).toBe(base)
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'initiative.start', order: base.order }))
    applyIntent(doc, env({ type: 'initiative.remove', token: t('a') }))
    expect(read(doc).order.map((e) => e.token)).toEqual(['b', 'c'])
  })
  it('deleting a token drops it from the order', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'token.add', token }))
    applyIntent(doc, env({ type: 'initiative.start', order: [entry(token.id, 12), entry('other', 3)] }))
    applyIntent(doc, env({ type: 'token.remove', token: token.id }))
    expect(read(doc).order).toEqual([entry('other', 3)])
    expect(doc.getMap('tokens').has(token.id)).toBe(false)
  })
  it('end clears the encounter', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'initiative.start', order: [entry('a', 1)] }))
    applyIntent(doc, env({ type: 'initiative.end' }))
    expect(read(doc)).toEqual({ active: false, round: 0, turn: 0, order: [] })
  })
  it('pure helpers leave inactive or empty state alone', () => {
    const idle: InitiativeState = { active: false, round: 0, turn: 0, order: [] }
    expect(nextTurn(idle)).toBe(idle)
    expect(nextTurn({ ...idle, active: true })).toMatchObject({ turn: 0, round: 0 })
    expect(withOrder({ active: true, round: 2, turn: 1, order: [entry('a', 1), entry('b', 2)] }, [])).toMatchObject({ turn: 0, order: [] })
    expect(withOrder({ active: true, round: 2, turn: 1, order: [entry('a', 1), entry('b', 2)] }, [entry('a', 1)])).toMatchObject({ turn: 0 })
  })
})

describe('creature templates and encounters', () => {
  it('upserts and removes them in their own maps', () => {
    const doc = new Y.Doc()
    const encounter = { id: 'e1', name: 'Ambush', rows: [{ id: 'r1', creatureRef: 'pack:srd-2024_goblin-warrior', count: 4, color: '#fff', hpMode: 'roll' as const }], placed: [] }
    const creature = { id: 'c1', name: 'Swamp Goblin', from: 'srd-2024_goblin-warrior', data: { xp: 50 }, updatedAt: 1 }
    applyIntent(doc, env({ type: 'encounter.upsert', encounter }))
    applyIntent(doc, env({ type: 'creature.upsert', creature }))
    expect(doc.getMap('encounters').toJSON()).toEqual({ e1: encounter })
    expect(doc.getMap('creatures').toJSON()).toEqual({ c1: creature })
    applyIntent(doc, env({ type: 'encounter.remove', encounter: 'e1' }))
    applyIntent(doc, env({ type: 'creature.remove', creature: 'c1' }))
    expect(doc.getMap('encounters').size + doc.getMap('creatures').size).toBe(0)
  })
})

describe('encounter intents', () => {
  const t = (id: string) => id as TokenId
  const read = (doc: Y.Doc) => doc.getMap('initiative').toJSON() as InitiativeState
  const pip: Token = { ...token, id: t('pip'), character: 'c1' as CharacterId }
  const rat: Token = { ...token, id: t('rat'), name: 'Rat', character: 'c2' as CharacterId }
  const sheet = (id: string, hp: number): Character => ({ id: id as CharacterId, name: id, data: { hp: { current: hp, max: 6 } } })
  const setup = () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'token.add', token: pip }))
    applyIntent(doc, env({ type: 'token.add', token: rat }))
    applyIntent(doc, env({ type: 'character.upsert', character: sheet('c1', 6) }))
    applyIntent(doc, env({ type: 'character.upsert', character: sheet('c2', 3) }))
    applyIntent(doc, env({ type: 'initiative.start', order: [{ token: pip.id, score: 10 }, { token: rat.id, score: 5 }] }))
    return doc
  }

  it('declares and resolves an action', () => {
    const doc = setup()
    applyIntent(doc, env({ type: 'initiative.declare', action: { token: rat.id, label: 'Bite', targets: [pip.id] } }))
    expect(read(doc).declared).toEqual({ rat: { token: 'rat', label: 'Bite', targets: ['pip'], at: 1 } })
    applyIntent(doc, env({ type: 'initiative.resolve', token: rat.id }))
    expect(read(doc).declared).toBeUndefined()
    // Not in the order: ignored.
    applyIntent(doc, env({ type: 'initiative.declare', action: { token: t('nobody'), label: 'X', targets: [] } }))
    expect(read(doc).declared).toBeUndefined()
  })
  it('a skill logs damage with a knockout and resolves the caster\'s declared action', () => {
    const doc = setup()
    applyIntent(doc, env({ type: 'initiative.declare', action: { token: pip.id, label: 'Attack', targets: [rat.id] } }))
    applyIntent(doc, env({ type: 'skill.use', skill: 'attack' as SkillId, source: pip.id, targets: [rat.id], seed: 'x' }), {
      skill: { patches: [{ character: 'c2', data: { hp: { current: 0, max: 6 } } }], messages: ['Rat falls.'], vfx: [] },
    })
    const s = read(doc)
    expect(s.log).toEqual([{ source: 'pip', target: 'rat', resource: 'hp', delta: -3, ko: true, round: 1 }])
    expect(s.declared).toBeUndefined()
    expect(doc.getArray('chat').toJSON().at(-1)).toMatchObject({ kind: 'system', channel: 'combat', text: 'Rat falls.' })
  })
  it('logs hand edits on the sheet during combat', () => {
    const doc = setup()
    applyIntent(doc, env({ type: 'character.upsert', character: sheet('c1', 4) }))
    expect(read(doc).log).toEqual([{ target: 'pip', resource: 'hp', delta: -2, round: 1 }])
  })
  it('end posts the summary to chat and clears the log', () => {
    const doc = setup()
    applyIntent(doc, env({ type: 'character.upsert', character: sheet('c1', 4) }))
    const summary = { rounds: 2, rows: [{ token: pip.id, name: 'Pip', dealt: 0, taken: 2, healed: 0, kos: 0 }] }
    applyIntent(doc, env({ type: 'initiative.end', summary }))
    expect(read(doc)).toEqual({ active: false, round: 0, turn: 0, order: [] })
    expect(doc.getArray('chat').toJSON().at(-1)).toMatchObject({ kind: 'system', channel: 'combat', text: 'Encounter over after 2 rounds.', summary })
  })
  it('records the sheet a roll came from', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'roll', formula: 'd20', seed: 'x', label: 'Pip · Initiative', character: 'c1' as CharacterId }))
    expect(doc.getArray('chat').toJSON()[0]).toMatchObject({ kind: 'roll', character: 'c1' })
  })
  it('a group member may end the shared turn', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'initiative.start', order: [{ token: t('g1'), score: 9, group: 'g' }, { token: t('g2'), score: 9, group: 'g' }, { token: t('pip'), score: 3 }] }))
    applyIntent(doc, env({ type: 'initiative.next', token: t('g2') }))
    expect(read(doc)).toMatchObject({ turn: 2, round: 1 })
  })
})

import { beforeAll, describe, expect, it } from 'vitest'
import type { GameDocShape, Token } from '@/core/doc'
import type { Intent } from '@/core/intents'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { diceFromSeed, parseFormula } from '@/dice/fair'
import { bestNatural, createRulesEngine, rolledByCaster } from './engine'
import type { LoadedPack, RulesEngine } from './index'
import { SEED_A, SEED_B, loadMausritter, mouse } from './test-helpers'

let pack: LoadedPack
let engine: RulesEngine
beforeAll(async () => {
  pack = await loadMausritter()
  engine = createRulesEngine(pack)
})

const seeds = Array.from({ length: 40 }, (_, i) => i.toString(16).padStart(2, '0').repeat(32))

describe('bestNatural / rolledByCaster', () => {
  it('reads the best face per resolution: 20 for d20-vs-dc, 1 for roll-under', () => {
    expect(bestNatural({ kind: 'd20-vs-dc' }, 20)).toBe(true)
    expect(bestNatural(undefined, 20)).toBe(true)
    expect(bestNatural({ kind: 'd20-vs-dc' }, 1)).toBe(false)
    expect(bestNatural({ kind: 'roll-under', die: 'd20' }, 1)).toBe(true)
    expect(bestNatural({ kind: 'roll-under', die: 'd20' }, 20)).toBe(false)
    expect(bestNatural({ kind: 'd20-vs-dc' }, undefined)).toBe(false)
  })
  it('tells an attack (the caster rolls) from a save (the target rolls)', () => {
    expect(rolledByCaster('d20 + melee_mod + pb')).toBe(true)
    expect(rolledByCaster('d20 + target.dex_mod')).toBe(false)
  })
})

describe('roll', () => {
  it('matches fair.ts and is deterministic', async () => {
    const a = await engine.roll('2d6 + 3', SEED_A)
    const b = await engine.roll('2d6 + 3', SEED_A)
    expect(a).toEqual(b)
    const fair = await diceFromSeed(parseFormula('2d6'), SEED_A)
    expect(a.dice).toEqual(fair)
    expect(a.total).toBe(fair[0].value + fair[1].value + 3)
    expect(a.seed).toBe(SEED_A)
    expect(a.formula).toBe('2d6 + 3')
  })

  it('resolves roll-under against a target: success when total <= target, critical on 1 or 20', async () => {
    const seen = { success: false, failure: false, critical: false }
    for (const seed of seeds) {
      const r = await engine.roll('d20', seed, { target: 10 })
      const natural = r.dice[0].value
      expect(r.outcome).toEqual({ critical: natural === 1 || natural === 20, target: 10, success: natural <= 10 })
      if (r.outcome!.success) seen.success = true
      else seen.failure = true
      if (r.outcome!.critical) seen.critical = true
    }
    expect(seen).toEqual({ success: true, failure: true, critical: true })
  })

  it('reads the target from a character via vs, with condition modifiers', async () => {
    const c = mouse('c', 'Pip', { dex: 8, conditions: ['exhausted'] })
    const r = await engine.roll('d20', SEED_A, { character: c, vs: 'dex' })
    expect(r.outcome?.target).toBe(6)
    expect(r.outcome?.success).toBe(r.total <= 6)
  })

  it('uses a boolean formula as the success flag', async () => {
    const c = mouse('c', 'Pip', { str: 11 })
    const r = await engine.roll('d20 <= str', SEED_A, { character: c })
    expect(r.total).toBe(r.dice[0].value)
    expect(r.outcome?.success).toBe(r.dice[0].value <= 11)
  })

  it('only reports critical when no target is known', async () => {
    const r = await engine.roll('d20', SEED_B)
    expect(Object.keys(r.outcome!)).toEqual(['critical'])
  })

  it('supports d20-vs-dc packs', async () => {
    const dc = createRulesEngine({ ...pack, manifest: { ...pack.manifest, resolution: { kind: 'd20-vs-dc' } } })
    for (const seed of seeds.slice(0, 10)) {
      const r = await dc.roll('d20 + 3', seed, { dc: 15 })
      expect(r.outcome?.success).toBe(r.total >= 15)
    }
  })

  it('rejects bad formulas', async () => {
    await expect(engine.roll('d20 +', SEED_A)).rejects.toThrow()
    await expect(engine.roll('d20 + nope', SEED_A)).rejects.toThrow(/unknown identifier/)
  })
})

describe('evaluate', () => {
  it('reads character data with condition modifiers and derived helpers', async () => {
    const c = mouse('c', 'Pip', { str: 10, conditions: ['injured'], items: [{ name: 'Hammer', damage: 'd8' }, null, { name: 'Jerkin', armor: 1 }] })
    expect(await engine.evaluate('str', c)).toBe(7)
    expect(await engine.evaluate('str.current', c)).toBe(7)
    expect(await engine.evaluate('str.max', c)).toBe(10)
    expect(await engine.evaluate('weapon.damage', c)).toBe('d8')
    expect(await engine.evaluate('armor', c)).toBe(1)
    expect(await engine.evaluate('name', c)).toBe('Pip')
    expect(await engine.evaluate('weapon.name', mouse('d', 'Dot'))).toBe('Unarmed')
  })
  it('needs a seed for dice, and context overrides', async () => {
    const c = mouse('c', 'Pip')
    await expect(engine.evaluate('d6 + 1', c)).rejects.toThrow(/seed/)
    expect(await engine.evaluate('d6 + 1', c, { seed: SEED_A })).toBe((await diceFromSeed(parseFormula('d6'), SEED_A))[0].value + 1)
    expect(await engine.evaluate('bonus + str', c, { bonus: 2 })).toBe(11)
  })
})

describe('validate', () => {
  const gm = 'gm'.repeat(32) as PlayerPubkey
  const alice = 'a1'.repeat(32) as PlayerPubkey
  const bob = 'b2'.repeat(32) as PlayerPubkey
  const scene = 's1' as SceneId
  const token = (id: string, owner: PlayerPubkey | undefined, character?: string): Token => ({
    id: id as TokenId, scene, name: id, owner, character: character as Token['character'],
    color: '#fff', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [],
  })
  const doc = (): GameDocShape => ({
    meta: { name: 'g', gm, pack: pack.manifest.id, activeScene: scene, createdAt: 0 },
    events: [],
    props: {},
    notes: {},
    customSkills: {},
    scenes: {},
    tokens: {
      ['t-alice' as TokenId]: token('t-alice', alice, 'c-alice'),
      ['t-bob' as TokenId]: token('t-bob', bob, 'c-bob'),
      ['t-broke' as TokenId]: token('t-broke', alice, 'c-broke'),
      ['t-npc' as TokenId]: token('t-npc', undefined),
    },
    characters: {
      ['c-alice' as never]: mouse('c-alice', 'Alice', { wil: 5 }, alice),
      ['c-bob' as never]: mouse('c-bob', 'Bob', {}, bob),
      ['c-broke' as never]: mouse('c-broke', 'Broke', { wil: 0 }, alice),
    },
    chat: [],
    fog: {},
  })
  const asAlice = { isGm: false, pubkey: alice }
  const asGm = { isGm: true, pubkey: gm }
  const move = (t: string): Intent => ({ type: 'token.move', token: t as TokenId, position: { x: 1, y: 0, z: 1 } })

  it('lets the GM do anything', () => {
    const d = doc()
    expect(engine.validate(move('t-bob'), asGm, d)).toBeNull()
    expect(engine.validate({ type: 'fog.reset', scene }, asGm, d)).toBeNull()
    expect(engine.validate({ type: 'token.remove', token: 't-npc' as TokenId }, asGm, d)).toBeNull()
  })
  it('restricts token moves to owned tokens', () => {
    const d = doc()
    expect(engine.validate(move('t-alice'), asAlice, d)).toBeNull()
    expect(engine.validate(move('t-bob'), asAlice, d)).toMatch(/own/)
    expect(engine.validate(move('t-npc'), asAlice, d)).toMatch(/own/)
    expect(engine.validate(move('t-missing'), asAlice, d)).toMatch(/unknown token/)
    expect(engine.validate({ type: 'token.update', token: 't-bob' as TokenId, patch: { hidden: true } }, asAlice, d)).toMatch(/own/)
  })
  it('restricts character upserts to the player\'s own characters', () => {
    const d = doc()
    expect(engine.validate({ type: 'character.upsert', character: mouse('c-alice', 'Alice', {}, alice) }, asAlice, d)).toBeNull()
    expect(engine.validate({ type: 'character.upsert', character: mouse('c-new', 'New', {}, alice) }, asAlice, d)).toBeNull()
    expect(engine.validate({ type: 'character.upsert', character: mouse('c-new', 'New', {}, bob) }, asAlice, d)).toMatch(/own/)
    expect(engine.validate({ type: 'character.upsert', character: mouse('c-bob', 'Bob', {}, alice) }, asAlice, d)).toMatch(/someone else/)
    expect(engine.validate({ type: 'character.remove', character: 'c-bob' as never }, asAlice, d)).toMatch(/someone else/)
  })
  it('keeps initiative to the GM', () => {
    const d = doc()
    const all: Intent[] = [
      { type: 'initiative.start', order: [{ token: 't-alice' as TokenId, score: 12 }], seed: SEED_A },
      { type: 'initiative.set', order: [] },
      { type: 'initiative.next' },
      { type: 'initiative.remove', token: 't-alice' as TokenId },
      { type: 'initiative.end' },
    ]
    for (const i of all) {
      expect(engine.validate(i, asAlice, d)).toMatch(/GM/)
      expect(engine.validate(i, asGm, d)).toBeNull()
    }
  })
  it('lets players work unlocked doors only where the scene allows it, and keeps walls to the GM', () => {
    const grid = { type: 'square' as const, cellSize: 1, origin: { x: 0, y: 0, z: 0 } }
    const door = (id: string, locked = false) => ({ id: id as never, scene, a: { x: 0, z: 0 }, b: { x: 1, z: 0 }, door: { open: false, locked } })
    const base = doc()
    const d = (playersOpenDoors: boolean): GameDocShape => ({
      ...base,
      scenes: { [scene]: { id: scene, name: 'S', grid, cameraMode: 'orbit', darkness: 0, playersOpenDoors } },
      walls: { ['d1' as never]: door('d1'), ['d2' as never]: door('d2', true), ['w1' as never]: { id: 'w1' as never, scene, a: { x: 0, z: 0 }, b: { x: 0, z: 1 } } },
    })
    const open = (wall: string): Intent => ({ type: 'door.set', wall: wall as never, open: true })
    expect(engine.validate(open('d1'), asAlice, d(true))).toBeNull()
    expect(engine.validate(open('d1'), asAlice, d(false))).toMatch(/GM/)
    expect(engine.validate(open('d2'), asAlice, d(true))).toMatch(/locked/)
    expect(engine.validate(open('w1'), asAlice, d(true))).toMatch(/not a door/)
    expect(engine.validate(open('d2'), asGm, d(false))).toBeNull()
    expect(engine.validate({ type: 'wall.remove', walls: ['w1' as never] }, asAlice, d(true))).toMatch(/GM/)
    expect(engine.validate({ type: 'fog.hide', scene, cells: ['0,0'] }, asAlice, d(true))).toMatch(/GM/)
  })
  it('lets players open unlocked door props where the scene allows it; locking stays with the GM', () => {
    const grid = { type: 'square' as const, cellSize: 1, origin: { x: 0, y: 0, z: 0 } }
    const model = { sha256: 'builtin:no-model', kind: 'other', mime: 'application/x-vtt-part', size: 0, sources: [] } as never
    const door = (id: string, locked = false) => ({ id: id as never, scene, name: 'Door', model, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, door: { open: false, locked, width: 1 } })
    const base = doc()
    const d = (playersOpenDoors: boolean): GameDocShape => ({
      ...base,
      scenes: { [scene]: { id: scene, name: 'S', grid, cameraMode: 'orbit', darkness: 0, playersOpenDoors } },
      props: { ['p1' as never]: door('p1'), ['p2' as never]: door('p2', true), ['p3' as never]: { ...door('p3'), door: undefined, wall: { length: 1, blocks: 'both' } } },
    })
    const open = (prop: string): Intent => ({ type: 'prop.door', prop: prop as never, open: true })
    expect(engine.validate(open('p1'), asAlice, d(true))).toBeNull()
    expect(engine.validate(open('p1'), asAlice, d(false))).toMatch(/GM/)
    expect(engine.validate(open('p2'), asAlice, d(true))).toMatch(/locked/)
    expect(engine.validate(open('p3'), asAlice, d(true))).toMatch(/not a door/)
    expect(engine.validate(open('p2'), asGm, d(false))).toBeNull()
    const lock: Intent = { type: 'props.update', updates: [{ id: 'p1' as never, patch: { door: { open: false, locked: true, width: 1 } } }] }
    expect(engine.validate(lock, asAlice, d(true))).toMatch(/GM/)
    expect(engine.validate(lock, asGm, d(true))).toBeNull()
  })
  it('lets a player end their own token\'s turn, and only while it is up', () => {
    const d = { ...doc(), initiative: { active: true, round: 1, turn: 0, order: [{ token: 't-alice' as TokenId, score: 12 }, { token: 't-bob' as TokenId, score: 8 }] } }
    expect(engine.validate({ type: 'initiative.next', token: 't-alice' as TokenId }, asAlice, d)).toBeNull()
    expect(engine.validate({ type: 'initiative.next', token: 't-bob' as TokenId }, asAlice, d)).toMatch(/control/)
    const later = { ...d, initiative: { ...d.initiative, turn: 1 } }
    expect(engine.validate({ type: 'initiative.next', token: 't-alice' as TokenId }, asAlice, later)).toMatch(/turn/)
  })
  it('keeps a token\'s skill list to the GM and its skills to the token', () => {
    const d = doc()
    expect(engine.validate({ type: 'token.update', token: 't-alice' as TokenId, patch: { skills: [] } }, asAlice, d)).toMatch(/GM/)
  })
  it('always allows rolls and chat', () => {
    const d = doc()
    expect(engine.validate({ type: 'roll', formula: 'd20', seed: SEED_A }, asAlice, d)).toBeNull()
    expect(engine.validate({ type: 'chat.say', text: 'hi' }, asAlice, d)).toBeNull()
  })
  it('allows skills only from owned tokens that can pay', () => {
    const d = doc()
    const use = (skill: string, source: string, targets: string[] = []): Intent => ({
      type: 'skill.use', skill: skill as never, source: source as TokenId, targets: targets as TokenId[], seed: SEED_A,
    })
    expect(engine.validate(use('fireball', 't-alice', ['t-bob']), asAlice, d)).toBeNull()
    expect(engine.validate(use('fireball', 't-bob'), asAlice, d)).toMatch(/control/)
    expect(engine.validate(use('fireball', 't-broke'), asAlice, d)).toMatch(/not enough Willpower/)
    expect(engine.validate(use('attack', 't-broke', ['t-bob']), asAlice, d)).toBeNull()
    expect(engine.validate(use('nope', 't-alice'), asAlice, d)).toMatch(/unknown skill/)
    expect(engine.validate(use('heal', 't-alice', ['t-bob', 't-broke']), asAlice, d)).toMatch(/single/)
    expect(engine.validate(use('heal', 't-npc'), asAlice, d)).toMatch(/control/)
  })
  it('keeps fog, scene and token add/remove for the GM', () => {
    const d = doc()
    for (const intent of [
      { type: 'fog.reveal', scene, cells: ['0,0'] },
      { type: 'fog.reset', scene },
      { type: 'scene.activate', scene },
      { type: 'scene.update', scene, patch: { name: 'x' } },
      { type: 'token.add', token: token('t-x', alice) },
      { type: 'token.remove', token: 't-alice' },
      { type: 'fog.revealAll', scene },
      { type: 'scene.remove', scene: 's2' },
    ] as Intent[]) {
      expect(engine.validate(intent, asAlice, d), intent.type).toMatch(/GM/)
    }
    expect(engine.validate({ type: 'fog.revealAll', scene }, asGm, d)).toBeNull()
    expect(engine.validate({ type: 'scene.remove', scene: 's2' as SceneId }, asGm, d)).toBeNull()
  })
  it('refuses to remove the live scene, GM included', () => {
    const d = doc()
    expect(engine.validate({ type: 'scene.remove', scene }, asGm, d)).toMatch(/switch to another scene/)
    expect(engine.validate({ type: 'scene.remove', scene }, asAlice, d)).toMatch(/switch to another scene/)
  })
})

describe('validating prop batches', () => {
  const scene = 's1'
  const model = { sha256: 'ab'.repeat(32), kind: 'model', mime: 'model/gltf-binary', size: 1, sources: [] }
  const crate = { id: 'p1', scene, name: 'Crate', model, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
  const d = { scenes: { [scene]: { id: scene } }, props: { p1: crate } }
  const gm = { isGm: true, pubkey: 'aa'.repeat(32) }
  const player = { isGm: false, pubkey: 'bb'.repeat(32) }
  it('lets the GM and co-GMs send well-formed batches and refuses players', () => {
    const place = { type: 'props.place', props: [{ ...crate, id: 'p2' }] } as unknown as Intent
    const move = { type: 'props.update', updates: [{ id: 'p1', patch: { position: { x: 1, y: 0, z: 1 } } }] } as unknown as Intent
    expect(engine.validate(place, gm, d)).toBeNull()
    expect(engine.validate(move, gm, d)).toBeNull()
    expect(engine.validate(place, player, d)).toMatch(/only the GM/)
    expect(engine.validate(move, player, d)).toMatch(/only the GM/)
  })
  it('checks the shape for the GM too', () => {
    const bad = { type: 'props.update', updates: [{ id: 'p1', patch: { scale: { x: Number.NaN, y: 1, z: 1 } } }] } as unknown as Intent
    expect(engine.validate(bad, gm, d)).toMatch(/finite/)
    expect(engine.validate({ type: 'props.remove', ids: ['nope'] } as unknown as Intent, gm, d)).toMatch(/unknown prop/)
  })
})

import { beforeAll, describe, expect, it } from 'vitest'
import type { GameDocShape, Token } from '@/core/doc'
import type { Intent } from '@/core/intents'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { diceFromSeed, parseFormula } from '@/dice/fair'
import { createRulesEngine } from './engine'
import type { LoadedPack, RulesEngine } from './index'
import { SEED_A, SEED_B, loadMausritter, mouse } from './test-helpers'

let pack: LoadedPack
let engine: RulesEngine
beforeAll(async () => {
  pack = await loadMausritter()
  engine = createRulesEngine(pack)
})

const seeds = Array.from({ length: 40 }, (_, i) => i.toString(16).padStart(2, '0').repeat(32))

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

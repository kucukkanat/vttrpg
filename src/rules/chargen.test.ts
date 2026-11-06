import { beforeAll, describe, expect, it } from 'vitest'
import type { Character } from '@/core/doc'
import { createRulesEngine } from './engine'
import type { LoadedPack, RulesEngine } from './index'
import { listItems } from './inventory'
import { isContinuation, isItem, type InventorySlot } from './scope'
import { SEED_A, SEED_B, loadMausritter } from './test-helpers'

let pack: LoadedPack
let engine: RulesEngine
beforeAll(async () => {
  pack = await loadMausritter()
  engine = createRulesEngine(pack)
})

type Stat = { current: number; max: number }
const stat = (c: Character, id: string) => c.data[id] as Stat

describe('generateCharacter (Mausritter)', () => {
  it('is deterministic for a seed and differs across seeds', async () => {
    const a = await engine.generateCharacter(SEED_A, 'Pip')
    const b = await engine.generateCharacter(SEED_A, 'Pip')
    expect(a).toEqual(b)
    const c = await engine.generateCharacter(SEED_B, 'Pip')
    expect(c.id).not.toBe(a.id)
    expect(c.data).not.toEqual(a.data)
  })

  it('matches the golden snapshot', async () => {
    expect(await engine.generateCharacter(SEED_A, 'Pip')).toMatchSnapshot()
  })

  it('rolls stats as 3d6 keep two, HP and pips as d6', async () => {
    for (const seed of ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32), SEED_A, SEED_B]) {
      const c = await engine.generateCharacter(seed, 'Mouse')
      for (const id of ['str', 'dex', 'wil']) {
        const s = stat(c, id)
        expect(s.max).toBeGreaterThanOrEqual(2)
        expect(s.max).toBeLessThanOrEqual(12)
        expect(s.current).toBe(s.max)
      }
      expect(stat(c, 'hp').max).toBeGreaterThanOrEqual(1)
      expect(stat(c, 'hp').max).toBeLessThanOrEqual(6)
      expect(stat(c, 'hp').current).toBe(stat(c, 'hp').max)
      expect(stat(c, 'pips')).toMatchObject({ max: 250 })
      expect(stat(c, 'pips').current).toBeGreaterThanOrEqual(1)
      expect(stat(c, 'pips').current).toBeLessThanOrEqual(6)
    }
  })

  it('fills background, birthsign, coat and detail from the tables', async () => {
    const c = await engine.generateCharacter(SEED_A, 'Pip')
    const tables = pack.chargen!.tables
    const backgrounds = Object.values(tables.background.rows).map((r) => r.background)
    expect(backgrounds).toContain(c.data.background)
    expect(Object.values(tables.birthsign.rows).map((r) => r.birthsign)).toContain(c.data.birthsign)
    expect(typeof c.data.disposition).toBe('string')
    const coat = c.data.coat as { color: string; pattern: string }
    expect(Object.values(tables['coat-color'].rows).map((r) => r['coat.color'])).toContain(coat.color)
    expect(Object.values(tables['coat-pattern'].rows).map((r) => r['coat.pattern'])).toContain(coat.pattern)
    expect(Object.values(tables.detail.rows).map((r) => r.detail)).toContain(c.data.detail)
    expect(c.data).toMatchObject({ level: 1, xp: 0, grit: 0, conditions: [], notes: '' })
    expect(c.name).toBe('Pip')
    expect(c.id).toBe(`mausritter-${SEED_A.slice(0, 12)}`)
  })

  it('places starting items into the 2x5 grid with weapons in the paws', async () => {
    for (const seed of ['44'.repeat(32), '55'.repeat(32), '66'.repeat(32), SEED_A]) {
      const c = await engine.generateCharacter(seed, 'Mouse')
      const grid = c.data.inventory as InventorySlot[]
      expect(grid).toHaveLength(10)
      const items = listItems(grid)
      const names = items.map((i) => i.name)
      expect(names).toContain('Torches')
      expect(names).toContain('Rations')
      // weapon + 2 background items + torches + rations
      expect(items.length).toBe(5)
      const weapon = items.find((i) => typeof i.damage === 'string' && i.slot === 'paw')!
      expect(weapon).toBeDefined()
      expect(grid.indexOf(weapon)).toBeLessThan(2)
      if (weapon.size === 2) expect(isContinuation(grid[1]) && grid[1].continuationOf === 0).toBe(true)
      for (const [i, slot] of grid.entries()) {
        if (isItem(slot) && slot.slot === 'body') expect([2, 3]).toContain(i)
        if (isItem(slot) && slot.slot === 'pack') expect(i).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('runs choose steps with the seed', async () => {
    const custom = createRulesEngine({
      ...pack,
      chargen: {
        steps: [{ id: 'w', title: 'Weapon', choose: { bind: 'favourite', options: ['Needle', 'Sling', 'Hammer'] } }],
        tables: {},
      },
    })
    const picks = new Set<string>()
    for (let i = 0; i < 12; i++) picks.add((await custom.generateCharacter(i.toString(16).padStart(2, '0').repeat(32), 'M')).data.favourite as string)
    for (const p of picks) expect(['Needle', 'Sling', 'Hammer']).toContain(p)
    expect(picks.size).toBeGreaterThan(1)
  })

  it('supports ranged table keys and array appends', async () => {
    const custom = createRulesEngine({
      ...pack,
      chargen: {
        steps: [
          { id: 'a', title: 'A', set: { tags: ['one'] } },
          { id: 'b', title: 'B', table: 'spread' },
        ],
        tables: { spread: { die: 'd20', rows: { '1-10': { half: 'low', tags: ['low'] }, '11-20': { half: 'high', tags: ['high'] } } } },
      },
    })
    const c = await custom.generateCharacter(SEED_A, 'M')
    expect(['low', 'high']).toContain(c.data.half)
    expect(c.data.tags).toEqual(['one', c.data.half])
  })

  it('throws without a chargen schema', async () => {
    await expect(createRulesEngine({ ...pack, chargen: undefined }).generateCharacter(SEED_A, 'x')).rejects.toThrow(/no chargen/)
  })
})

import { describe, expect, it } from 'vitest'
import type { CreatureEntry } from '@/core/pack'
import { formatCr, searchCreatures } from './creatureSearch'

const c = (name: string, cr: number, source = 'srd-2024', type = 'Humanoid'): CreatureEntry => ({ key: `${source}_${name}`, name, cr, source, type, data: {} })
const list = [c('Hobgoblin Warrior', 0.5), c('Goblin Boss', 1), c('Goblin Warrior', 0.25), c('Goblin', 0.25, 'srd-2014'), c('Adult Red Dragon', 17, 'srd-2024', 'Dragon'), c('Bugbear Warrior', 1)]

describe('creature search', () => {
  it('ranks exact and prefix name matches first', () => {
    expect(searchCreatures(list, { query: 'goblin', source: '' }).results.map((x) => x.name)).toEqual(['Goblin', 'Goblin Boss', 'Goblin Warrior', 'Hobgoblin Warrior'])
  })
  it('needs every word and matches the creature type', () => {
    expect(searchCreatures(list, { query: 'warrior gob', source: '' }).results.map((x) => x.name)).toEqual(['Goblin Warrior', 'Hobgoblin Warrior'])
    expect(searchCreatures(list, { query: 'dragon', source: '' }).results.map((x) => x.name)).toEqual(['Adult Red Dragon'])
  })
  it('filters by source and CR, and counts past the limit', () => {
    expect(searchCreatures(list, { query: 'goblin', source: 'srd-2014' }).results.map((x) => x.name)).toEqual(['Goblin'])
    expect(searchCreatures(list, { query: '', source: '', crMin: 1, crMax: 5 }).results.map((x) => x.name)).toEqual(['Bugbear Warrior', 'Goblin Boss'])
    const r = searchCreatures(list, { query: '', source: '', limit: 2 })
    expect([r.results.length, r.total]).toEqual([2, 6])
  })
  it('formats fractional challenge ratings', () => {
    expect([0.125, 0.25, 0.5, 3, undefined].map(formatCr)).toEqual(['1/8', '1/4', '1/2', '3', '—'])
  })
})

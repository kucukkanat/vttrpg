import { beforeEach, describe, expect, it } from 'vitest'
import type { CreatureTemplate, Encounter, Prefab } from '@/core/doc'
import type { PrefabId } from '@/core/ids'
import type { CreatureEntry } from '@/core/pack'
import { useBuildUi } from '@/table/build/buildState'
import { armKitPiece, pieceInHand, useKitUi } from '@/table/kits/kitState'
import { KAYKIT, KENNEY } from '@/table/kits/testKits'
import { creatureShelf, encounterAsGroup, encounterMeta, kitShelf, matchesQuery, modelShelfFor, savedShelf, type ShelfPrefs } from './shelves'
import { filtersFor } from './LibraryPanel'

const prefs = (over: Partial<ShelfPrefs> = {}): ShelfPrefs => ({ query: '', filter: 'all', recent: [], favourites: [], ...over })

const goblin: CreatureEntry = { key: 'srd_goblin', name: 'Goblin', source: 'srd', cr: 0.25, xp: 50, type: 'humanoid', size: 'Small', data: { hp: 7 } }
const wolf: CreatureEntry = { key: 'srd_wolf', name: 'Wolf', source: 'srd', cr: 0.25, type: 'beast', data: { hp: 11 } }
const dragon: CreatureEntry = { key: 'srd_red-dragon', name: 'Red Dragon', source: 'srd', cr: 17, type: 'dragon', data: {} }
const boss: CreatureTemplate = { id: 't1', name: 'Goblin Boss', from: 'srd_goblin', source: 'srd', data: { hp: 21 }, updatedAt: 1 }
const templates = { t1: boss }
const compendium = [goblin, wolf, dragon]

describe('search', () => {
  it('matches every word, ignoring case and accents', () => {
    expect(matchesQuery('Château chest', 'chateau')).toBe(true)
    expect(matchesQuery('Red Dragon', 'dragon red')).toBe(true)
    expect(matchesQuery('Red Dragon', 'blue')).toBe(false)
    expect(matchesQuery('anything', '  ')).toBe(true)
  })
  it('maps the filter onto the models shelf', () => {
    expect(modelShelfFor('all')).toBe('all')
    expect(modelShelfFor('mine')).toBe('mine')
    expect(modelShelfFor('recent')).toBe('recent')
    expect(modelShelfFor('favourites')).toBe('favourites')
  })
  it('offers My models only where there are imports', () => {
    expect(filtersFor('models').map((f) => f.id)).toContain('mine')
    expect(filtersFor('creatures').find((f) => f.id === 'mine')?.label).toBe('This game')
    expect(filtersFor('kit').map((f) => f.id)).not.toContain('mine')
    expect(filtersFor('saved').map((f) => f.id)).toEqual(['all', 'recent', 'favourites', 'in-scene'])
  })
})

describe('kit shelf', () => {
  it('groups the pieces by slot in the plan order, dropping empty sections', () => {
    const groups = kitShelf(KAYKIT, prefs())
    const labels = groups.map((g) => g.label)
    expect(labels[0]).toBe('Floors')
    expect(labels).toContain('Walls')
    const order = ['Floors', 'Walls', 'Doors', 'Windows', 'Stairs', 'Roofs', 'Pillars']
    expect(labels).toEqual(order.filter((l) => labels.includes(l)))
    for (const g of groups) expect(g.pieces.length).toBeGreaterThan(0)
    expect(groups.find((g) => g.label === 'Walls')!.pieces.every((p) => p.slot === 'wall')).toBe(true)
  })
  it('searches across the kit and filters to starred pieces', () => {
    const floor = KAYKIT.pieces.find((p) => p.slot === 'floor')!
    const hits = kitShelf(KAYKIT, prefs({ query: floor.title }))
    expect(hits.flatMap((g) => g.pieces).map((p) => p.id)).toContain(floor.id)
    const starred = kitShelf(KAYKIT, prefs({ filter: 'favourites', favourites: [floor.catalogue] }))
    expect(starred.flatMap((g) => g.pieces).map((p) => p.id)).toEqual([floor.id])
    expect(kitShelf(KAYKIT, prefs({ query: 'zzzz-no-such-piece' }))).toEqual([])
    expect(kitShelf(undefined, prefs())).toEqual([])
  })
})

describe('kit card arms the paint tool', () => {
  beforeEach(() => {
    useKitUi.setState({ kit: 'kaykit-dungeon', pieces: {}, wallPiece: null, tool: null })
    useBuildUi.setState({ tool: null })
  })
  it('a floor card arms the floor tool with that piece', () => {
    const floor = KAYKIT.pieces.filter((p) => p.slot === 'floor').at(-1)!
    expect(armKitPiece(KAYKIT, floor)).toBe('floor')
    expect(useKitUi.getState().tool).toBe('floor')
    expect(useKitUi.getState().pieces.floor).toBe(floor.id)
    expect(useBuildUi.getState().tool).toBe('kit')
    expect(pieceInHand(useKitUi.getState(), 'floor', KAYKIT, floor)).toBe(true)
  })
  it('picking the same card again keeps the tool armed (never toggles off)', () => {
    const floor = KAYKIT.pieces.find((p) => p.slot === 'floor')!
    armKitPiece(KAYKIT, floor)
    armKitPiece(KAYKIT, floor)
    expect(useKitUi.getState().tool).toBe('floor')
    expect(useBuildUi.getState().tool).toBe('kit')
  })
  it('a card of another kit switches the kit and drops the old picks', () => {
    const a = KAYKIT.pieces.find((p) => p.slot === 'floor')!
    armKitPiece(KAYKIT, a)
    const door = KENNEY.pieces.find((p) => p.slot === 'door') ?? KENNEY.pieces[0]!
    armKitPiece(KENNEY, door)
    expect(useKitUi.getState().kit).toBe(KENNEY.id)
    expect(useKitUi.getState().pieces).toEqual({ [door.slot]: door.id })
  })
  it('a plain wall paints joined runs; a decor wall is placed one edge at a time', () => {
    const plain = KAYKIT.pieces.find((p) => p.id === KAYKIT.defaults.wall)!
    expect(armKitPiece(KAYKIT, plain)).toBe('wall')
    expect(useKitUi.getState().wallPiece).toBeNull()
    const decor = KAYKIT.pieces.find((p) => p.slot === 'wall' && ![KAYKIT.defaults.wall, KAYKIT.defaults.half].includes(p.id))
    if (decor) {
      armKitPiece(KAYKIT, decor)
      expect(useKitUi.getState().wallPiece).toBe(decor.id)
    }
  })
})

describe('creatures shelf', () => {
  it("lists the game's stat blocks first, then the compendium", () => {
    const { cards, total } = creatureShelf({ templates, compendium }, prefs())
    expect(cards.map((c) => c.name)).toEqual(['Goblin Boss', 'Goblin', 'Red Dragon', 'Wolf'])
    expect(cards[0]).toMatchObject({ ref: 'game:t1', custom: true, meta: 'This game' })
    expect(cards[1]).toMatchObject({ ref: 'pack:srd_goblin', meta: 'CR 1/4 · humanoid' })
    expect(total).toBe(4)
  })
  it('searches both', () => {
    expect(creatureShelf({ templates, compendium }, prefs({ query: 'gob' })).cards.map((c) => c.ref)).toEqual(['game:t1', 'pack:srd_goblin'])
    expect(creatureShelf({ templates, compendium }, prefs({ query: 'beast' })).cards.map((c) => c.name)).toEqual(['Wolf'])
  })
  it("'mine' keeps the game's stat blocks; recent and favourites keep their order", () => {
    expect(creatureShelf({ templates, compendium }, prefs({ filter: 'mine' })).cards.map((c) => c.ref)).toEqual(['game:t1'])
    const recent = creatureShelf({ templates, compendium }, prefs({ filter: 'recent', recent: ['pack:srd_wolf', 'b:barrel', 'game:t1'] }))
    expect(recent.cards.map((c) => c.ref)).toEqual(['pack:srd_wolf', 'game:t1'])
    const fav = creatureShelf({ templates, compendium }, prefs({ filter: 'favourites', favourites: ['pack:srd_red-dragon'], query: 'dragon' }))
    expect(fav.cards.map((c) => c.name)).toEqual(['Red Dragon'])
  })
  it('caps the compendium and reports the total', () => {
    const many = Array.from({ length: 100 }, (_, i): CreatureEntry => ({ key: `k${i}`, name: `Rat ${String(i).padStart(3, '0')}`, source: 's', data: {} }))
    const r = creatureShelf({ templates: {}, compendium: many }, prefs(), 60)
    expect(r.cards).toHaveLength(60)
    expect(r.total).toBe(100)
  })
})

const prefab = (id: string, name: string, createdAt: number): Prefab => ({ id: id as PrefabId, name, size: { x: 3, z: 3 }, cellSize: 1.5, props: [], walls: [{ a: { x: 0, z: 0 }, b: { x: 3, z: 0 } }], createdAt })
const ambush: Encounter = {
  id: 'e1', name: 'Ambush', placed: [], createdAt: 5,
  rows: [
    { id: 'r1', creatureRef: 'pack:srd_goblin', count: 3, color: '#f00' },
    { id: 'r2', creatureRef: 'game:t1', count: 1, color: '#0f0', overrides: { name: 'Grik' } },
    { id: 'r3', creatureRef: 'pack:srd_gone', count: 2, color: '#00f' },
    { id: 'r4', count: 0, color: '#000' },
  ],
}

describe('saved shelf', () => {
  const src = { prefabs: { p2: prefab('p2', 'Tavern bar', 2), p1: prefab('p1', 'Crate stack', 1) }, encounters: { e1: ambush }, compendium, templates }
  it('lists groups oldest first and encounters with their creatures', () => {
    const s = savedShelf(src, prefs())
    expect(s.groups.map((c) => c.name)).toEqual(['Crate stack', 'Tavern bar'])
    expect(s.groups[0]!.meta).toContain('1 wall')
    expect(s.encounters[0]!.meta).toBe('6 tokens · Goblin, Grik, Creature')
  })
  it('searches across groups and encounters', () => {
    const s = savedShelf(src, prefs({ query: 'goblin' }))
    expect(s.groups).toEqual([])
    expect(s.encounters.map((c) => c.id)).toEqual(['e1'])
    expect(savedShelf(src, prefs({ query: 'tavern' })).groups.map((c) => c.id)).toEqual(['p2'])
  })
  it('recent keeps the recent order', () => {
    const s = savedShelf(src, prefs({ filter: 'recent', recent: ['p2', 'e1'] }))
    expect(s.groups.map((c) => c.id)).toEqual(['p2'])
    expect(s.encounters.map((c) => c.id)).toEqual(['e1'])
  })
  it('names plain rows without a resolver', () => {
    expect(encounterMeta({ rows: [{ id: 'x', count: 2, color: '#fff', overrides: { name: 'Guard' } }] })).toBe('2 tokens · Guard')
  })
})

describe('encounter to group', () => {
  it('turns rows of creature refs into the tokens placeRows would place, leaving out missing stat blocks', () => {
    const g = encounterAsGroup(ambush, compendium, templates)
    expect(g.title).toBe('Ambush')
    expect(g.tokens).toEqual([
      { name: 'Goblin 1', color: '#f00', row: 'r1' },
      { name: 'Goblin 2', color: '#f00', row: 'r1' },
      { name: 'Goblin 3', color: '#f00', row: 'r1' },
      { name: 'Grik', color: '#0f0', row: 'r2' },
    ])
    expect(g.missing).toEqual(['Creature'])
  })
  it('keeps plain minis (rows without a creature)', () => {
    const g = encounterAsGroup({ name: '', rows: [{ id: 'a', count: 2, color: '#123', overrides: { name: 'Guard' } }] }, undefined, undefined)
    expect(g.title).toBe('Encounter')
    expect(g.tokens.map((t) => t.name)).toEqual(['Guard 1', 'Guard 2'])
  })
})

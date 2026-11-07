import { beforeAll, describe, expect, it } from 'vitest'
import type { Character } from '@/core/doc'
import type { CharacterId } from '@/core/ids'
import type { SheetSchema } from '@/core/pack'
import { createRulesEngine, loadPack, type LoadedPack } from '@/rules'
import { fileFetch, loadMausritter } from '@/rules/test-helpers'
import {
  attributeTiles, cardLevel, cardSubtitle, formatMod, formulaIdentifiers, initials, inventorySummary, notesSummary, referencesAttribute, tileRoll,
} from './sheetCard'

const char = (data: Record<string, unknown>, name = 'Pip'): Character => ({ id: 'c1' as CharacterId, name, data })

let maus: LoadedPack
let dnd: LoadedPack
beforeAll(async () => {
  maus = await loadMausritter()
  dnd = await loadPack('packs/dnd5e/', fileFetch)
})

describe('formula references', () => {
  it('keeps dotted paths and drops quoted strings', () => {
    expect(formulaIdentifiers("d20 + save_prof.str * pb + (x == 'dex' ? 1 : 0)")).toEqual(['d20', 'save_prof.str', 'pb', 'x'])
  })
  it('matches the attribute, its modifier, or a path segment', () => {
    expect(referencesAttribute('d20 <= str', 'str')).toBe(true)
    expect(referencesAttribute('d20 + str_mod', 'str')).toBe(true)
    expect(referencesAttribute('d20 + save_prof.str * pb', 'str')).toBe(true)
    expect(referencesAttribute('d20 + strength', 'str')).toBe(false)
    expect(referencesAttribute('d20 + dex_mod', 'str')).toBe(false)
  })
})

describe('tileRoll', () => {
  it('prefers a save over a check', () => {
    const schema: SheetSchema = { sections: [{ title: 'A', fields: [
      { kind: 'roll', label: 'STR check', formula: 'd20 + str_mod' },
      { kind: 'roll', label: 'Athletics', formula: 'd20 + str_mod + prof.athletics' },
      { kind: 'roll', label: 'STR save', formula: 'd20 + str_mod + save_prof.str * pb' },
    ] }] }
    expect(tileRoll(schema, { id: 'str', name: 'Strength', abbr: 'STR' })?.label).toBe('STR save')
  })
  it('falls back to a roll named after the attribute, then any match, then nothing', () => {
    const schema: SheetSchema = { sections: [{ title: 'A', fields: [
      { kind: 'roll', label: 'Athletics', formula: 'd20 + str_mod' },
      { kind: 'roll', label: 'Strength test', formula: 'd20 + str_mod' },
      { kind: 'roll', label: 'Sneak', formula: 'd20 + dex_mod' },
    ] }] }
    expect(tileRoll(schema, { id: 'str', name: 'Strength', abbr: 'STR' })?.label).toBe('Strength test')
    expect(tileRoll(schema, { id: 'dex', name: 'Dexterity', abbr: 'DEX' })?.label).toBe('Sneak')
    expect(tileRoll(schema, { id: 'wis', name: 'Wisdom', abbr: 'WIS' })).toBeNull()
  })
  it('picks the saves in both bundled packs', () => {
    expect(tileRoll(maus.sheet, maus.attributes.find((a) => a.id === 'wil')!)).toEqual({ label: 'WIL save', formula: 'd20 <= wil' })
    expect(tileRoll(dnd.sheet, dnd.attributes.find((a) => a.id === 'dex')!)?.label).toBe('DEX save')
  })
})

describe('cardSubtitle', () => {
  it('joins the first identity text values, skipping the name and blanks', () => {
    const c = char({ background: 'Beetleherd', birthsign: '', disposition: 'Curious', coat: { color: 'Brown' } })
    expect(cardSubtitle(maus.sheet, c)).toBe('Beetleherd · Curious · Brown')
    expect(cardSubtitle(maus.sheet, c, 1)).toBe('Beetleherd')
    expect(cardSubtitle(maus.sheet, char({}))).toBe('')
  })
  it('reads race and class on a D&D sheet', () => {
    expect(cardSubtitle(dnd.sheet, char({ race: 'Elf', class: 'Wizard', background: 'Sage' }))).toBe('Elf · Wizard · Sage')
  })
  it('level badge only for a number', () => {
    expect(cardLevel(char({ level: 3 }))).toBe(3)
    expect(cardLevel(char({ level: '3' }))).toBeNull()
  })
})

describe('attributeTiles', () => {
  it('reads Mausritter resource-shaped stats and shows a reduced max', async () => {
    const c = char({ str: { current: 7, max: 9 }, dex: { current: 10, max: 10 }, wil: { current: 8, max: 8 } })
    const tiles = attributeTiles(maus.sheet, maus.attributes, c)
    expect(tiles.map((t) => [t.abbr, t.value, t.max, t.roll?.label])).toEqual([
      ['STR', 7, 9, 'STR save'], ['DEX', 10, null, 'DEX save'], ['WIL', 8, null, 'WIL save'],
    ])
  })
  it('shows D&D scores with modifiers and derived AC', () => {
    const rules = createRulesEngine(dnd)
    const c = rules.blankCharacter('c1', 'Ana')
    c.data = { ...c.data, str: 16, dex: 14 }
    const tiles = attributeTiles(dnd.sheet, dnd.attributes, c, (e) => rules.evaluateNow(e, c))
    const str = tiles.find((t) => t.id === 'str')!
    expect([str.value, str.mod, str.roll?.label]).toEqual([16, 3, 'STR save'])
    const ac = tiles.find((t) => t.id === 'ac')!
    expect(typeof ac.value).toBe('number')
    expect(ac.roll).toBeNull()
  })
})

describe('summaries', () => {
  it('lists inventory grid items with slots used', () => {
    const c = char({ inventory: [{ name: 'Needle', damage: 'd6' }, null, { name: 'Torch' }, { continuationOf: 2 }, null] })
    expect(inventorySummary(maus.sheet, c)).toEqual([{ label: 'Carried', text: 'Needle, Torch (3/10)' }])
    expect(inventorySummary(maus.sheet, char({}))).toEqual([])
  })
  it('lists equipment with quantities', () => {
    const c = char({ equipment: [{ name: 'Rope', qty: 1 }, { name: 'Ration', qty: 5 }, {}], features: ['Darkvision'] })
    expect(inventorySummary(dnd.sheet, c)).toEqual([{ label: 'Equipment', text: 'Rope, Ration ×5' }])
  })
  it('takes the first non-empty notes line', () => {
    expect(notesSummary(maus.sheet, char({ notes: '\n  Owes the rat king\nmore' }))).toBe('Owes the rat king')
    expect(notesSummary(maus.sheet, char({}))).toBe('')
  })
  it('formats modifiers and initials', () => {
    expect(formatMod(2)).toBe('+2')
    expect(formatMod(0)).toBe('+0')
    expect(formatMod(-1)).toBe('−1')
    expect(initials('Mira Thistlewood')).toBe('MT')
    expect(initials('bob')).toBe('BO')
    expect(initials(' ')).toBe('?')
  })
})

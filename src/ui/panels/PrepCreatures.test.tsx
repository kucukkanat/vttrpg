import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Character, Encounter, GameMeta, Token } from '@/core/doc'
import type { CharacterId, PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import { createRulesEngine, loadCreatures, type RulesEngine } from '@/rules'
import { loadPack } from '@/rules/load'
import { fileFetch } from '@/rules/test-helpers'
import type { GameController } from '../controller'
import { CreaturePicker, StatBlock, type Compendium } from './CreaturesPrep'
import { Encounters } from './EncountersPrep'

type Hook<S> = { getState(): S }
function liveHook<S>(hook: Hook<S>) {
  return Object.assign((selector: (s: S) => unknown) => selector(hook.getState()), hook)
}
vi.mock('@/state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/state/store')>()
  return { ...actual, useGame: liveHook(actual.useGame) }
})

const gm = 'gm'.padEnd(64, '0') as PlayerPubkey
const alice = 'alice'.padEnd(64, '0') as PlayerPubkey
const scene = 'cave' as SceneId
const meta: GameMeta = { name: 'g', gm, pack: 'dnd5e' as GameMeta['pack'], activeScene: scene, createdAt: 0 }

let rules: RulesEngine
let compendium: Compendium
beforeAll(async () => {
  rules = createRulesEngine(await loadPack('packs/dnd5e/', fileFetch))
  const c = await loadCreatures(rules.pack, fileFetch)
  compendium = { status: 'ready', creatures: c.creatures, documents: c.documents }
})

const controller = () => ({ connection: { isGm: true, gm, gameId: 'game-1' }, pubkey: gm, rules, dispatch: async () => {} } as unknown as GameController)
const goblin = () => compendium.creatures.find((c) => c.key === 'srd-2024_goblin-warrior')!

describe('creature prep views', () => {
  beforeEach(() => {
    const hero: Token = { id: 'hero' as TokenId, scene, name: 'Hero', owner: alice, character: 'c1' as CharacterId, color: '#fff', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [] }
    const sheet: Character = { id: 'c1' as CharacterId, name: 'Hero', owner: alice, data: { level: 2 } }
    useGame.getState()._replaceFromDoc({ meta, tokens: { [hero.id]: hero } as Record<TokenId, Token>, characters: { [sheet.id]: sheet } as Record<CharacterId, Character>, creatures: {}, encounters: {} })
  })

  it('renders a stat block with the NPC layout and computed values', () => {
    const html = renderToStaticMarkup(<StatBlock rules={rules} creature={goblin()} />)
    for (const text of ['Defense', 'Actions', 'Scimitar', 'Shortbow', 'Nimble Escape', 'AC with conditions', 'Passive Perception', 'darkvision 60 ft.']) expect(html).toContain(text)
    expect(html).toMatch(/AC with conditions<\/span><div class="readonly computed">15</)
    expect(html).toMatch(/Passive Perception<\/span><div class="readonly computed">9</)
  })

  it('lists compendium creatures with CR, XP and source in the picker', () => {
    const html = renderToStaticMarkup(<CreaturePicker rules={rules} compendium={compendium} onPick={() => {}} />)
    expect(html).toContain('Search creatures')
    expect(html).toContain('SRD 5.2.1')
    expect(html).toContain('Showing 30 of')
  })

  it('shows an open encounter with its rows and the difficulty arithmetic', () => {
    const e: Encounter = {
      id: 'e1', name: 'Cave mouth', placed: [], createdAt: 1,
      rows: [
        { id: 'r1', creatureRef: 'pack:srd-2024_goblin-warrior', count: 3, color: '#f28b82', hpMode: 'roll' },
        { id: 'r2', creatureRef: 'pack:srd-2024_goblin-boss', count: 1, color: '#e0a458' },
        { id: 'r3', creatureRef: 'pack:srd-2024_goblin-warrior', count: 1, color: '#8fd18f', friendly: true, overrides: { name: 'Snik' } },
      ],
    }
    useGame.getState()._replaceFromDoc({ encounters: { e1: e } })
    const html = renderToStaticMarkup(<Encounters controller={controller()} disabled={false} compendium={compendium} open="e1" setOpen={() => {}} onEditTemplate={() => {}} />)
    expect(html).toContain('Goblin Warrior')
    expect(html).toContain('CR 1/4 · 50 XP · AC 15 · HP 10 (3d6)')
    expect(html).toContain('Party: 1 character (levels 2)')
    expect(html).toContain('Budget: Low 100 · Moderate 150 · High 200')
    expect(html).toContain('Creatures: 3 × Goblin Warrior (50) + 1 × Goblin Boss (200) = 350 XP (1 friendly left out)')
    expect(html).toContain('Above High')
    expect(html).toContain('System Reference Document 5.2.1')
  })
})

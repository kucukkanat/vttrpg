import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Encounter, GameMeta, Token } from '@/core/doc'
import type { Intent } from '@/core/intents'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import type { GameController } from '../controller'

const placeRows = vi.fn()
const groupInitiative = vi.fn(async () => 2)
const setHidden = vi.fn(async () => {})
const startCombat = vi.fn(async () => true)
vi.mock('./placeCreatures', () => ({ placeRows: (...a: unknown[]) => placeRows(...a), groupInitiative: (...a: unknown[]) => groupInitiative(...(a as [])) }))
vi.mock('./npc', () => ({ setHidden: (...a: unknown[]) => setHidden(...(a as [])) }))
vi.mock('../panels/InitiativePanel', () => ({ startCombat: (...a: unknown[]) => startCombat(...(a as [])) }))

const { initiativeOffer, rollForPlaced, runEncounter } = await import('./runEncounter')

const gm = 'gm'.padEnd(64, '0') as PlayerPubkey
const scene = 'tavern' as SceneId
const meta: GameMeta = { name: 'g', gm, pack: 'dnd5e' as GameMeta['pack'], activeScene: scene, createdAt: 0 }
const token = (id: string, hidden = true): Token => ({
  id: id as TokenId, scene, name: id, color: '#fff', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden, conditions: [],
})
const rowA = { id: 'ra', count: 2, color: '#f00', creatureRef: 'pack:goblin' }
const rowB = { id: 'rb', count: 1, color: '#0f0', creatureRef: 'pack:wolf' }
const ambush: Encounter = { id: 'e1', name: 'Ambush', rows: [rowA, rowB], placed: [], createdAt: 1 }

let sent: Intent[] = []
const controller = { connection: { isGm: true, gm }, pubkey: gm, rules: null, dispatch: async (i: Intent) => { sent.push(i) } } as unknown as GameController

describe('running an encounter from Play', () => {
  beforeEach(() => {
    sent = []
    vi.clearAllMocks()
    const placed = [token('g1'), token('g2'), token('w1')]
    useGame.getState()._replaceFromDoc({ meta, tokens: Object.fromEntries(placed.map((t) => [t.id, t])) as Record<TokenId, Token>, characters: {}, initiative: null, encounters: { e1: ambush } })
    placeRows.mockResolvedValue({ placed: [{ row: rowA, tokens: ['g1', 'g2'] }, { row: rowB, tokens: ['w1'] }], missing: [] })
  })

  it('places the rows hidden and records the placement on the encounter', async () => {
    const r = await runEncounter(controller, ambush, { visible: false, compendium: [], templates: {} })
    expect(placeRows).toHaveBeenCalledWith(controller, ambush.rows, [], {})
    expect(setHidden).not.toHaveBeenCalled()
    expect(r).toEqual({ tokens: ['g1', 'g2', 'w1'], missing: [] })
    const saved = sent.find((i) => i.type === 'encounter.upsert')
    expect(saved).toMatchObject({ encounter: { id: 'e1', placed: ['g1', 'g2', 'w1'], placedRows: { ra: ['g1', 'g2'], rb: ['w1'] } } })
  })

  it('reveals them when placing visible', async () => {
    await runEncounter(controller, ambush, { visible: true, compendium: [], templates: {} })
    expect(setHidden).toHaveBeenCalledWith(controller, ['g1', 'g2', 'w1'], false)
  })

  it('records nothing when nothing could be placed', async () => {
    placeRows.mockResolvedValue({ placed: [], missing: ['Wolf'] })
    const r = await runEncounter(controller, ambush, { visible: false, compendium: [], templates: {} })
    expect(r).toEqual({ tokens: [], missing: ['Wolf'] })
    expect(sent).toEqual([])
  })

  it('then offers initiative for the placed creatures', () => {
    expect(initiativeOffer(1)).toBe('Roll initiative for 1 creature?')
    expect(initiativeOffer(3)).toBe('Roll initiative for 3 creatures?')
  })

  it('yes starts combat including the placed (hidden) tokens', async () => {
    const r = await runEncounter(controller, ambush, { visible: false, compendium: [], templates: {} })
    expect(await rollForPlaced(controller, ambush, r.tokens)).toBe(true)
    expect(startCombat).toHaveBeenCalledWith(controller, { include: ['g1', 'g2', 'w1'] })
    expect(groupInitiative).not.toHaveBeenCalled()
  })

  it('in a running combat the placed rows join the order as groups', async () => {
    useGame.getState()._replaceFromDoc({
      initiative: { active: true, round: 1, turn: 0, order: [] },
      encounters: { e1: { ...ambush, placed: ['g1', 'g2', 'w1'] as TokenId[], placedRows: { ra: ['g1', 'g2'] as TokenId[], rb: ['w1'] as TokenId[] } } },
    })
    expect(await rollForPlaced(controller, ambush, ['g1', 'g2', 'w1'] as TokenId[])).toBe(true)
    expect(startCombat).not.toHaveBeenCalled()
    expect(groupInitiative).toHaveBeenCalledTimes(1)
    const groups = (groupInitiative.mock.calls[0] as unknown[])[1] as { tokens: string[] }[]
    expect(groups.map((g) => g.tokens)).toEqual([['g1', 'g2'], ['w1']])
  })

  it('does nothing once the placed tokens are gone', async () => {
    expect(await rollForPlaced(controller, ambush, ['nope'] as TokenId[])).toBe(false)
    expect(startCombat).not.toHaveBeenCalled()
  })
})

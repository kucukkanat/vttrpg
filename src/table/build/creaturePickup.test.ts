import { beforeEach, describe, expect, it } from 'vitest'
import type { GridSpec } from '@/core/geometry'
import type { CharacterId, SceneId, TokenId } from '@/core/ids'
import { putDownModel, useBuildUi } from './buildState'
import { creatureGhost, pickUpCreatures, pickupTokens, type HeldCreatures } from './creaturePickup'

const scene = 's1' as SceneId
const grid: GridSpec = { type: 'square', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }
let n = 0
const makeId = () => `t${++n}` as TokenId
const held = (count = 1): HeldCreatures => ({
  title: 'Goblin', tokens: Array.from({ length: count }, (_, i) => ({ name: count > 1 ? `Goblin ${i + 1}` : 'Goblin', color: '#f28b82' })), place: async () => {},
})

describe('creature pickup', () => {
  beforeEach(() => { n = 0; useBuildUi.setState({ tool: null, creatures: null, placeVisible: false }) })

  it('picking a creature arms the creature tool; Esc puts it down', () => {
    const h = held()
    pickUpCreatures(h)
    expect(useBuildUi.getState().tool).toBe('creature')
    expect(useBuildUi.getState().creatures).toBe(h)
    putDownModel()
    expect(useBuildUi.getState().tool).toBeNull()
  })

  it('a click places one hidden token on the clicked cell', () => {
    const [t, ...rest] = pickupTokens({ held: held(), at: { x: 3.2, y: 0, z: 1.4 }, grid, scene, tokens: [], makeId, characters: ['c1' as CharacterId] })
    expect(rest).toEqual([])
    expect(t).toMatchObject({
      id: 't1', scene, name: 'Goblin', color: '#f28b82', character: 'c1', hidden: true,
      position: { x: 3, y: 0, z: 1.5 }, cell: { q: 2, r: 1 }, vision: 4, scale: 1, conditions: [],
    })
  })

  it('places visible when asked', () => {
    const [t] = pickupTokens({ held: held(), at: { x: 0, y: 0, z: 0 }, grid, scene, tokens: [], makeId, hidden: false })
    expect(t!.hidden).toBe(false)
  })

  it('a group spreads onto free cells around the click, skipping tokens already there', () => {
    const tokens = [{ scene, position: { x: 0, y: 0, z: 0 } }, { scene: 'other' as SceneId, position: { x: 1.5, y: 0, z: 0 } }]
    const placed = pickupTokens({ held: held(3), at: { x: 0, y: 0, z: 0 }, grid, scene, tokens, makeId })
    const cells = placed.map((t) => `${t.cell!.q},${t.cell!.r}`)
    expect(cells).not.toContain('0,0')
    expect(new Set(cells).size).toBe(3)
    expect(placed.map((t) => t.name)).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3'])
    expect(placed.every((t) => t.hidden)).toBe(true)
  })

  it('the ghost shows exactly where a click would place', () => {
    const at = { x: 4.4, y: 0, z: -1 }
    const ghost = creatureGhost(grid, at, held(2), [], scene)
    const placed = pickupTokens({ held: held(2), at, grid, scene, tokens: [], makeId })
    expect(ghost.map((g) => g.position)).toEqual(placed.map((t) => t.position))
  })
})

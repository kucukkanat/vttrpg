import { describe, expect, it } from 'vitest'
import type { Prop } from '@/core/doc'
import type { PropId, SceneId } from '@/core/ids'
import { NO_MODEL } from '@/core/propParts'
import { propClickFor, registerPropClick } from './propClick'
import { doorAnswers, playerCanWork, toggleDoorIntent, toggleLockIntent } from './doorClick'
import { useGame } from '@/state/store'

const grid = { type: 'square' as const, cellSize: 1, origin: { x: 0, y: 0, z: 0 } }
const door = (over: Partial<Prop['door']> = {}): Prop => ({
  id: 'd' as PropId, scene: 's' as SceneId, name: 'Door', model: NO_MODEL, position: { x: 0.5, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, door: { open: false, width: 1, ...over },
})

describe('door clicks', () => {
  it('toggles open and locked through intents', () => {
    expect(toggleDoorIntent(door())).toEqual({ type: 'prop.door', prop: 'd', open: true })
    expect(toggleDoorIntent(door({ open: true }))).toEqual({ type: 'prop.door', prop: 'd', open: false })
    expect(toggleLockIntent(door())).toEqual({ type: 'props.update', updates: [{ id: 'd', patch: { door: { open: false, width: 1, locked: true } } }] })
    expect(toggleLockIntent(door({ locked: true }))).toEqual({ type: 'props.update', updates: [{ id: 'd', patch: { door: { open: false, width: 1 } } }] })
  })

  it('players work unlocked doors where allowed, while a side is in sight', () => {
    const scene = { playersOpenDoors: true, grid }
    // The door runs along x from 0 to 1 at z = 0; cells are centred on the grid points, so its sides fall in cell (1,0).
    expect(playerCanWork(door(), scene, null)).toBe(true)
    expect(playerCanWork(door(), scene, new Set(['1,0']))).toBe(true)
    expect(playerCanWork(door(), scene, new Set(['5,5']))).toBe(false)
    expect(playerCanWork(door({ locked: true }), scene, null)).toBe(false)
    expect(playerCanWork(door(), { playersOpenDoors: false, grid }, null)).toBe(false)
  })

  it('answers through the prop click registry for the GM always, players by the rule', () => {
    useGame.setState({ scenes: { s: { id: 's', name: 'S', grid, cameraMode: 'orbit', darkness: 0, playersOpenDoors: false } } } as never)
    expect(doorAnswers(door({ locked: true }), true)).toBe(true)
    expect(doorAnswers(door(), false)).toBe(false)
    const off = registerPropClick({ wants: doorAnswers, click: () => undefined })
    expect(propClickFor(door(), true)).toBeDefined()
    expect(propClickFor({ ...door(), door: undefined }, true)).toBeUndefined()
    off()
  })
})

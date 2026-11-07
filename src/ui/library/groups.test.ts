import { beforeEach, describe, expect, it } from 'vitest'
import type { GameMeta, Prefab, Prop, Scene, Wall } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { PlayerPubkey, PrefabId, PropId, SceneId, WallId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { useGame } from '@/state/store'
import { stampPrefab } from '@/table/build/prefab'
import type { GameController } from '../controller'
import { groupFromSelection, nextGroupName, saveSelectionAsGroup } from './groups'
import { useLibraryView } from './libraryView'

const scene = 's1' as SceneId
const other = 's2' as SceneId
const grid: GridSpec = { type: 'square', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }
const model = { sha256: 'ab'.repeat(32), kind: 'model', mime: 'model/gltf-binary', size: 1, sources: [] } as unknown as Prop['model']
const prop = (id: string, x: number, z: number, s: SceneId = scene): Prop => ({
  id: id as PropId, scene: s, name: id, model, position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, createdBy: 'gm' as PlayerPubkey,
})
const wall = (id: string, ax: number, az: number, bx: number, bz: number, s: SceneId = scene, door = false): Wall => ({
  id: id as WallId, scene: s, a: { x: ax, z: az }, b: { x: bx, z: bz }, ...(door ? { door: { open: true, locked: true } } : {}),
})

describe('groupFromSelection', () => {
  it('keeps only the selected props, relative to the cell-snapped bounds, with the walls inside', () => {
    const g = groupFromSelection({
      name: 'Bar', grid, now: 7,
      props: [prop('a', 0, 0), prop('b', 3, 1.5)],
      walls: [wall('w1', -0.75, -0.75, 3.75, -0.75), wall('w2', -0.75, -0.75, 9, -0.75), wall('w3', 0, 0, 1.5, 0, other), wall('d', 0.75, 0.75, 0.75, 2.25, scene, true)],
    })!
    expect(g.name).toBe('Bar')
    expect(g.createdAt).toBe(7)
    // Props at x 0..3 and z 0..1.5 snap outwards to the cell corners -0.75..3.75 and -0.75..2.25.
    expect(g.size).toEqual({ x: 4.5, z: 3 })
    expect(g.cellSize).toBe(1.5)
    expect(g.props.map((p) => p.name)).toEqual(['a', 'b'])
    expect(g.props[0]!.position).toEqual({ x: 0.75, y: 0, z: 0.75 })
    expect(g.props[0]).not.toHaveProperty('id')
    expect(g.props[0]).not.toHaveProperty('createdBy')
    // The wall running out of the bounds and the other scene's wall are left out; the door comes back closed.
    expect(g.walls).toEqual([{ a: { x: 0, z: 0 }, b: { x: 4.5, z: 0 } }, { a: { x: 1.5, z: 1.5 }, b: { x: 1.5, z: 3 }, door: { open: false } }])
  })
  it('a lone prop still captures its cell', () => {
    const g = groupFromSelection({ name: 'One', grid, props: [prop('a', 1.5, 1.5)], walls: [] })!
    expect(g.size).toEqual({ x: 1.5, z: 1.5 })
    expect(g.props[0]!.position).toEqual({ x: 0.75, y: 0, z: 0.75 })
  })
  it('stamps back as the same layout', () => {
    const g = groupFromSelection({ name: 'Bar', grid, props: [prop('a', 0, 0), prop('b', 3, 1.5)], walls: [] })!
    const out = stampPrefab(g, { scene: other, corner: { x: 5.25, z: 5.25 }, turns: 0, cellSize: 1.5, floorY: 0 })
    expect(out.props.map((p) => [p.position.x, p.position.z])).toEqual([[6, 6], [9, 7.5]])
    expect(new Set(out.props.map((p) => p.scene))).toEqual(new Set([other]))
  })
  it('is null without a selection', () => {
    expect(groupFromSelection({ name: 'x', grid, props: [], walls: [] })).toBeNull()
  })
  it('names groups after the next free number', () => {
    expect(nextGroupName({})).toBe('Group 1')
    expect(nextGroupName({ a: { name: 'Group 2' } })).toBe('Group 3')
  })
})

describe('saveSelectionAsGroup', () => {
  const meta: GameMeta = { name: 'g', gm: 'gm' as PlayerPubkey, pack: 'p' as GameMeta['pack'], activeScene: scene, createdAt: 0 }
  const scenes = { [scene]: { id: scene, name: 'Hall', grid } as unknown as Scene }
  let sent: Intent[]
  const controller = { dispatch: async (i: Intent) => { sent.push(i) } } as unknown as GameController
  beforeEach(() => {
    sent = []
    useLibraryView.setState({ shelf: 'models', filter: 'recent', query: 'x' })
    useGame.getState()._replaceFromDoc({
      meta, scenes, prefabs: {} as Record<PrefabId, Prefab>,
      props: { a: prop('a', 0, 0), b: prop('b', 1.5, 0), c: prop('c', 30, 30) } as Record<PropId, Prop>,
      walls: { w: wall('w', -0.75, -0.75, 2.25, -0.75) } as Record<WallId, Wall>,
    })
  })
  it('saves the selection as one prefab.upsert and shows the Saved shelf', async () => {
    useGame.getState().setPropSelection(['a' as PropId, 'b' as PropId])
    const id = await saveSelectionAsGroup(controller, '  Crates ')
    expect(sent).toHaveLength(1)
    const i = sent[0]!
    if (i.type !== 'prefab.upsert') throw new Error('expected prefab.upsert')
    expect(i.prefab.id).toBe(id)
    expect(i.prefab.name).toBe('Crates')
    expect(i.prefab.props.map((p) => p.name)).toEqual(['a', 'b'])
    expect(i.prefab.walls).toHaveLength(1)
    expect(useLibraryView.getState()).toMatchObject({ shelf: 'saved', filter: 'all', query: '' })
  })
  it('defaults the name and resolves null with nothing selected', async () => {
    useGame.getState().setPropSelection(['c' as PropId])
    await saveSelectionAsGroup(controller)
    expect((sent[0] as Extract<Intent, { type: 'prefab.upsert' }>).prefab.name).toBe('Group 1')
    useGame.getState().clearPropSelection()
    expect(await saveSelectionAsGroup(controller)).toBeNull()
    expect(sent).toHaveLength(1)
  })
})

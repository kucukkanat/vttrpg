import { beforeEach, describe, expect, it } from 'vitest'
import type { GameMeta, Prop, Scene } from '@/core/doc'
import type { PlayerPubkey, PropId, SceneId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { useGame } from '@/state/store'
import { tableRuntime } from '../tableState'
import { copySelection, duplicateSelection, paste, pasteToHand, removeSelection, restingHeight, turnSelection } from './propActions'
import { useBuildUi } from './buildState'
import { decodeClip } from './propClipboard'

const scene = 's1' as SceneId
const meta: GameMeta = { name: 'g', gm: 'gm' as PlayerPubkey, pack: 'p' as GameMeta['pack'], activeScene: scene, createdAt: 0 }
const model = { sha256: 'ab'.repeat(32), kind: 'model', mime: 'model/gltf-binary', size: 1, sources: [] } as unknown as Prop['model']
const prop = (id: string, x: number, z: number): Prop => ({
  id: id as PropId, scene, name: id, model, position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
})
const scenes = { [scene]: { id: scene, name: 'Hall', grid: { type: 'square', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } } } as unknown as Scene }

describe('prop selection actions', () => {
  let sent: Intent[]
  const dispatch = (i: Intent) => { sent.push(i) }
  beforeEach(() => {
    sent = []
    useGame.getState()._replaceFromDoc({ meta, scenes, props: { a: prop('a', 0, 0), b: prop('b', 2, 0) } as Record<PropId, Prop> })
    useGame.getState().setPropSelection(['a' as PropId, 'b' as PropId])
  })

  it('turns the whole selection about its centre in one update', () => {
    expect(turnSelection(90, dispatch)).toBe(true)
    expect(sent).toHaveLength(1)
    const i = sent[0]!
    if (i.type !== 'props.update') throw new Error('expected props.update')
    expect(i.updates.map((u) => u.id)).toEqual(['a', 'b'])
    expect(i.updates[0]!.patch.position!.x).toBeCloseTo(1)
    expect(i.updates[0]!.patch.position!.z).toBeCloseTo(1)
    expect(i.updates[0]!.patch.rotation!.y).toBeCloseTo(Math.PI / 2)
  })
  it('duplicates one cell over in one place and selects the copies', () => {
    duplicateSelection(dispatch)
    const i = sent[0]!
    if (i.type !== 'props.place') throw new Error('expected props.place')
    expect(i.props.map((p) => p.position.x)).toEqual([1.5, 3.5])
    expect(useGame.getState().propSelection).toEqual(i.props.map((p) => p.id))
  })
  it('copies as text and pastes centred under the pointer', () => {
    const text = copySelection()
    expect(decodeClip(text)?.items).toHaveLength(2)
    tableRuntime.cursorFloor = { x: 10, y: 0, z: 10 }
    expect(paste(dispatch, text)).toBe(true)
    const i = sent[0]!
    if (i.type !== 'props.place') throw new Error('expected props.place')
    expect(i.props.map((p) => [p.position.x, p.position.z])).toEqual([[9, 10], [11, 10]])
    expect(i.props.every((p) => p.scene === scene)).toBe(true)
    // Without text the internal clipboard pastes.
    expect(paste(dispatch, 'not ours')).toBe(true)
    expect(sent).toHaveLength(2)
    tableRuntime.cursorFloor = null
  })
  it('pastes into the hand: the clip becomes the stamp ghost, nothing is placed yet', () => {
    const text = copySelection()
    expect(pasteToHand(text)).toBe(true)
    expect(sent).toHaveLength(0)
    const ui = useBuildUi.getState()
    expect(ui.tool).toBe('place')
    expect(ui.held?.parts?.map((p) => p.offset.x)).toEqual([-1, 1])
    ui.set({ tool: null, held: null })
    expect(pasteToHand('not ours')).toBe(true)
    expect(useBuildUi.getState().held?.parts).toHaveLength(2)
    useBuildUi.getState().set({ tool: null, held: null })
  })
  it('removes the selection in one intent', () => {
    removeSelection(dispatch)
    expect(sent).toEqual([{ type: 'props.remove', ids: ['a', 'b'] }])
    expect(useGame.getState().propSelection).toEqual([])
  })
})

describe('drop to surface', () => {
  it('rests on the highest hit below the bottom, never under the floor', () => {
    expect(restingHeight(2, [0.8, 1.2, 3], 0)).toBe(1.2)
    expect(restingHeight(2, [], 0)).toBe(0)
    expect(restingHeight(-1, [], 0)).toBe(0)
    expect(restingHeight(0.5, [0.5], 0)).toBe(0.5)
  })
})

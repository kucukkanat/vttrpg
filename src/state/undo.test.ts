import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Intent } from '@/core/intents'
import type { FogState, Note, Prop, Token } from '@/core/doc'
import type { LightId, NoteId, PrefabId, PropId, SceneId, TokenId, WallId } from '@/core/ids'
import { bindUndoDispatcher, captureUndo, MAX_UNDO, recordUndo, undoLast, useUndo, type UndoSnapshot } from './undo'

const scene = 'scene-1' as SceneId
const token: Token = {
  id: 't1' as TokenId, scene, name: 'Rat Guard', color: '#e0a458', position: { x: 1, y: 0, z: 2 }, rotationY: 0,
  scale: 1, vision: 4, light: 0, hidden: false, conditions: [],
}
const prop: Prop = {
  id: 'p1' as PropId, scene, name: 'Crate', model: { kind: 'library', path: 'props/crate.glb', sha256: 'x' } as unknown as Prop['model'],
  position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1,
}
const note: Note = { id: 'n1' as NoteId, title: 'Rumours', body: 'The well is haunted.', sharedWith: 'gm', createdAt: 1, updatedAt: 2 }
const fog: FogState = { scene, revealed: ['0,0', '1,0', '1,1'] }

const snapshot = (over: Partial<UndoSnapshot> = {}): UndoSnapshot => ({
  tokens: { [token.id]: token },
  props: { [prop.id]: prop },
  notes: { [note.id]: note },
  fog: { [scene]: { ...fog, revealed: [...fog.revealed] } },
  scenes: { [scene]: { id: scene, name: 'Dungeon', grid: { type: 'square', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }, cameraMode: 'orbit', darkness: 0.8 } },
  ...over,
})

describe('captureUndo', () => {
  it('brings removed walls and doors, lights and prefabs back', () => {
    const wall = { id: 'w1' as WallId, scene, a: { x: 0, z: 0 }, b: { x: 1, z: 0 } }
    const door = { id: 'd1' as WallId, scene, a: { x: 1, z: 0 }, b: { x: 2, z: 0 }, door: { open: true } }
    const light = { id: 'l1' as LightId, scene, position: { x: 0, y: 0, z: 0 }, radius: 3, color: '#fff' }
    const prefab = { id: 'pf' as PrefabId, name: 'Hut', size: { x: 1, z: 1 }, cellSize: 1, props: [], walls: [], createdAt: 1 }
    const s = snapshot({ walls: { [wall.id]: wall, [door.id]: door }, lights: { [light.id]: light }, prefabs: { [prefab.id]: prefab } })
    const w = captureUndo({ type: 'wall.remove', walls: [wall.id, door.id, 'gone' as WallId] }, s, 1)
    expect(w?.inverse).toEqual([{ type: 'wall.add', walls: [wall, door] }])
    expect(w?.label).toBe('Removed 2 walls and doors')
    expect(captureUndo({ type: 'wall.remove', walls: [door.id] }, s)?.label).toBe('Removed 1 door')
    expect(captureUndo({ type: 'wall.remove', walls: ['gone' as WallId] }, s)).toBeNull()
    expect(captureUndo({ type: 'light.remove', light: light.id }, s)?.inverse).toEqual([{ type: 'light.add', light }])
    expect(captureUndo({ type: 'prefab.remove', prefab: prefab.id }, s)?.inverse).toEqual([{ type: 'prefab.upsert', prefab }])
  })
  it('inverts token.remove into token.add with the same data', () => {
    const e = captureUndo({ type: 'token.remove', token: token.id }, snapshot(), 123)
    expect(e).toEqual({ label: 'Removed Rat Guard', subject: 'Rat Guard', inverse: [{ type: 'token.add', token }], at: 123 })
  })
  it('inverts prop.remove into prop.add', () => {
    const e = captureUndo({ type: 'prop.remove', prop: prop.id }, snapshot())
    expect(e?.label).toBe('Removed Crate')
    expect(e?.inverse).toEqual([{ type: 'prop.add', prop }])
  })
  it('inverts note.remove into note.upsert', () => {
    const e = captureUndo({ type: 'note.remove', note: note.id }, snapshot())
    expect(e?.label).toBe('Deleted Rumours')
    expect(e?.inverse).toEqual([{ type: 'note.upsert', note }])
  })
  it('inverts fog.reset into fog.reveal of the previously revealed cells', () => {
    const e = captureUndo({ type: 'fog.reset', scene }, snapshot())
    expect(e?.label).toBe('Reset fog on Dungeon')
    expect(e?.inverse).toEqual([{ type: 'fog.reveal', scene, cells: ['0,0', '1,0', '1,1'] }])
  })
  it('copies the cell list so later fog changes do not alter the entry', () => {
    const s = snapshot()
    const e = captureUndo({ type: 'fog.reset', scene }, s)
    s.fog[scene].revealed.push('9,9')
    expect((e?.inverse[0] as { cells: string[] }).cells).toHaveLength(3)
  })
  it('returns null when there is nothing to restore', () => {
    expect(captureUndo({ type: 'token.remove', token: 'missing' as TokenId }, snapshot())).toBeNull()
    expect(captureUndo({ type: 'fog.reset', scene }, snapshot({ fog: {} }))).toBeNull()
    expect(captureUndo({ type: 'fog.reset', scene }, snapshot({ fog: { [scene]: { scene, revealed: [] } } }))).toBeNull()
  })
  it('inverts scene.remove into scene.add, except for the live scene', () => {
    const e = captureUndo({ type: 'scene.remove', scene }, snapshot(), 7)
    expect(e?.label).toBe('Removed Dungeon')
    expect(e?.inverse).toEqual([{ type: 'scene.add', scene: snapshot().scenes[scene] }])
    expect(captureUndo({ type: 'scene.remove', scene }, snapshot({ meta: { activeScene: scene } }))).toBeNull()
    expect(captureUndo({ type: 'scene.remove', scene: 'nope' as SceneId }, snapshot())).toBeNull()
  })
  it('inverts fog.revealAll into a reset followed by the cells explored before', () => {
    const e = captureUndo({ type: 'fog.revealAll', scene }, snapshot())
    expect(e?.label).toBe('Revealed all of Dungeon')
    expect(e?.inverse).toEqual([{ type: 'fog.reset', scene }, { type: 'fog.reveal', scene, cells: ['0,0', '1,0', '1,1'] }])
    expect(captureUndo({ type: 'fog.revealAll', scene }, snapshot({ fog: {} }))?.inverse).toEqual([{ type: 'fog.reset', scene }])
    expect(captureUndo({ type: 'fog.revealAll', scene }, snapshot({ fog: { [scene]: { scene, revealed: [], revealAll: true } } }))).toBeNull()
  })
  it('restores a full reveal when a reset is undone', () => {
    const e = captureUndo({ type: 'fog.reset', scene }, snapshot({ fog: { [scene]: { scene, revealed: ['0,0'], revealAll: true } } }))
    expect(e?.inverse).toEqual([{ type: 'fog.reveal', scene, cells: ['0,0'] }, { type: 'fog.revealAll', scene }])
    const only = captureUndo({ type: 'fog.reset', scene }, snapshot({ fog: { [scene]: { scene, revealed: [], revealAll: true } } }))
    expect(only?.inverse).toEqual([{ type: 'fog.revealAll', scene }])
  })
  it('ignores non-destructive intents', () => {
    expect(captureUndo({ type: 'token.add', token }, snapshot())).toBeNull()
    expect(captureUndo({ type: 'token.move', token: token.id, position: { x: 0, y: 0, z: 0 } }, snapshot())).toBeNull()
    expect(captureUndo({ type: 'chat.say', text: 'hi' }, snapshot())).toBeNull()
  })
})

describe('undo stack', () => {
  beforeEach(() => {
    bindUndoDispatcher(null)
    useUndo.getState().clear()
  })

  it('keeps only the last MAX_UNDO entries', () => {
    for (let i = 0; i < MAX_UNDO + 5; i++) {
      recordUndo({ type: 'token.remove', token: token.id }, snapshot({ tokens: { [token.id]: { ...token, name: `T${i}` } } }))
    }
    const { stack } = useUndo.getState()
    expect(stack).toHaveLength(MAX_UNDO)
    expect(stack[0].label).toBe('Removed T5')
    expect(stack[stack.length - 1].label).toBe(`Removed T${MAX_UNDO + 4}`)
  })

  it('does not record non-destructive intents', () => {
    expect(recordUndo({ type: 'token.add', token }, snapshot())).toBeNull()
    expect(useUndo.getState().stack).toHaveLength(0)
  })

  it('undoLast dispatches the inverse of the most recent entry and pops it', async () => {
    const sent: Intent[] = []
    bindUndoDispatcher(async (i) => { sent.push(i) })
    recordUndo({ type: 'prop.remove', prop: prop.id }, snapshot())
    recordUndo({ type: 'token.remove', token: token.id }, snapshot())
    const first = await undoLast()
    expect(first?.subject).toBe('Rat Guard')
    expect(sent).toEqual([{ type: 'token.add', token }])
    const second = await undoLast()
    expect(second?.subject).toBe('Crate')
    expect(sent[1]).toEqual({ type: 'prop.add', prop })
    expect(await undoLast()).toBeNull()
    expect(sent).toHaveLength(2)
  })

  it('undoLast is a no-op without a dispatcher (players never bind one)', async () => {
    recordUndo({ type: 'token.remove', token: token.id }, snapshot())
    expect(await undoLast()).toBeNull()
    expect(useUndo.getState().stack).toHaveLength(1)
  })

  it('binding a different dispatcher clears the stack; rebinding the same one keeps it', () => {
    const a = vi.fn(async () => {})
    const b = vi.fn(async () => {})
    bindUndoDispatcher(a)
    recordUndo({ type: 'token.remove', token: token.id }, snapshot())
    bindUndoDispatcher(a)
    expect(useUndo.getState().stack).toHaveLength(1)
    bindUndoDispatcher(b)
    expect(useUndo.getState().stack).toHaveLength(0)
  })
})

describe('undo for encounters and creature templates', () => {
  it('brings a deleted encounter or stat block back', () => {
    const encounter = { id: 'e1', name: 'Ambush', rows: [], placed: [] }
    const creature = { id: 'c1', name: 'Swamp Goblin', data: {}, updatedAt: 1 }
    const s = snapshot({ encounters: { e1: encounter }, creatures: { c1: creature } })
    expect(captureUndo({ type: 'encounter.remove', encounter: 'e1' }, s, 9)).toEqual({ label: 'Deleted Ambush', subject: 'Ambush', inverse: [{ type: 'encounter.upsert', encounter }], at: 9 })
    expect(captureUndo({ type: 'creature.remove', creature: 'c1' }, s)?.inverse).toEqual([{ type: 'creature.upsert', creature }])
    expect(captureUndo({ type: 'encounter.remove', encounter: 'gone' }, s)).toBeNull()
  })
})

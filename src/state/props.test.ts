/**
 * Prop batches end to end: apply in one transaction, the incremental store mirror, and undo/redo
 * of build edits against a real Y.Doc (with another builder editing the same props).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { Prop, Scene, Wall } from '@/core/doc'
import type { PlayerPubkey, PropId, SceneId, WallId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { validatePropsIntent } from '@/core/props'
import { applyIntent } from './apply'
import { bindDoc, useGame } from './store'
import { bindUndoDispatcher, captureUndo, commitUndo, describeOutcome, isReplaying, MAX_UNDO, redoLast, undoLast, useUndo } from './undo'

const me = 'aa'.repeat(32) as PlayerPubkey
const other = 'bb'.repeat(32) as PlayerPubkey
const scene = 's1' as SceneId
const model = { sha256: 'ab'.repeat(32), kind: 'model', mime: 'model/gltf-binary', size: 1, sources: [] } as unknown as Prop['model']
const prop = (id: string, over: Partial<Prop> = {}): Prop => ({
  id: id as PropId, scene, name: id, model, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, ...over,
})
const wall = (id: string): Wall => ({ id: id as WallId, scene, a: { x: 0, z: 0 }, b: { x: 1, z: 0 }, source: 'prefab' })
let seq = 0
const env = (intent: Intent, from: PlayerPubkey = me) => ({ id: `i${++seq}`, from, at: 1, intent })

function newDoc(): Y.Doc {
  const doc = new Y.Doc()
  doc.getMap<Scene>('scenes').set(scene, { id: scene, name: 'Hall', grid: { type: 'square', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }, cameraMode: 'orbit', darkness: 0 })
  return doc
}

describe('prop batches in apply', () => {
  it('applies a whole stamp, walls included, in one transaction', () => {
    const doc = newDoc()
    let transactions = 0
    // One document update per intent: one delta on the wire.
    doc.on('update', () => { transactions++ })
    applyIntent(doc, env({ type: 'props.place', props: [prop('a'), prop('b'), prop('c')], walls: [wall('w1'), wall('w2')] }))
    expect(transactions).toBe(1)
    expect(doc.getMap('props').size).toBe(3)
    expect(doc.getMap('walls').size).toBe(2)
    transactions = 0
    applyIntent(doc, env({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { position: { x: 1, y: 0, z: 0 } } }, { id: 'b' as PropId, patch: { solid: true } }] }))
    applyIntent(doc, env({ type: 'props.remove', ids: ['a' as PropId, 'c' as PropId] }))
    expect(transactions).toBe(2)
    expect([...doc.getMap('props').keys()]).toEqual(['b'])
  })

  it('stamps the author and last writer from the sender', () => {
    const doc = newDoc()
    applyIntent(doc, env({ type: 'props.place', props: [prop('a')] }))
    expect(doc.getMap<Prop>('props').get('a')).toMatchObject({ createdBy: me, editedBy: me })
    applyIntent(doc, env({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { name: 'Crate' } }] }, other))
    expect(doc.getMap<Prop>('props').get('a')).toMatchObject({ createdBy: me, editedBy: other, name: 'Crate' })
  })

  it('migrates a version 1 scale once, keeping its size, and leaves migrated props alone', () => {
    const doc = newDoc()
    applyIntent(doc, env({ type: 'props.place', props: [prop('old', { scale: 2 }), prop('new')] }))
    applyIntent(doc, env({ type: 'props.migrate', items: [{ id: 'old' as PropId, fit: 0.25 }, { id: 'new' as PropId, fit: 0.5 }] }))
    const props = doc.getMap<Prop>('props')
    expect(props.get('old')).toMatchObject({ scale: { x: 0.5, y: 0.5, z: 0.5 }, legacyFit: 0.25 })
    expect(props.get('new')?.scale).toEqual({ x: 1, y: 1, z: 1 })
    expect(props.get('new')).not.toHaveProperty('legacyFit')
    // A second GM client migrating the same prop (with its own measurement) changes nothing.
    applyIntent(doc, env({ type: 'props.migrate', items: [{ id: 'old' as PropId, fit: 0.3 }] }, other))
    expect(props.get('old')).toMatchObject({ scale: { x: 0.5, y: 0.5, z: 0.5 }, legacyFit: 0.25 })
  })

  it('keeps the single-prop intents working for older clients', () => {
    const doc = newDoc()
    applyIntent(doc, env({ type: 'prop.add', prop: prop('a') }))
    applyIntent(doc, env({ type: 'prop.update', prop: 'a' as PropId, patch: { name: 'Barrel' } }))
    expect(doc.getMap<Prop>('props').get('a')).toMatchObject({ name: 'Barrel', editedBy: me })
    applyIntent(doc, env({ type: 'prop.remove', prop: 'a' as PropId }))
    expect(doc.getMap('props').size).toBe(0)
  })
})

describe('incremental store mirror', () => {
  it('keeps unchanged props, and the props record itself, by identity', () => {
    const doc = newDoc()
    const off = bindDoc(doc)
    applyIntent(doc, env({ type: 'props.place', props: [prop('a'), prop('b'), prop('c')] }))
    const first = useGame.getState().props
    const [a, b, c] = [first['a' as PropId], first['b' as PropId], first['c' as PropId]]
    applyIntent(doc, env({ type: 'props.update', updates: [{ id: 'b' as PropId, patch: { position: { x: 3, y: 0, z: 0 } } }] }))
    const second = useGame.getState().props
    expect(second).not.toBe(first)
    expect(second['a' as PropId]).toBe(a)
    expect(second['c' as PropId]).toBe(c)
    expect(second['b' as PropId]).not.toBe(b)
    expect(second['b' as PropId].position.x).toBe(3)
    // An unrelated change (chat) leaves the props record and the token map untouched.
    const tokens = useGame.getState().tokens
    applyIntent(doc, env({ type: 'chat.say', text: 'hello' }))
    expect(useGame.getState().props).toBe(second)
    expect(useGame.getState().tokens).toBe(tokens)
    expect(useGame.getState().chat).toHaveLength(1)
    applyIntent(doc, env({ type: 'props.remove', ids: ['a' as PropId] }))
    expect(Object.keys(useGame.getState().props).sort()).toEqual(['b', 'c'])
    expect(useGame.getState().props['c' as PropId]).toBe(c)
    off()
  })

  it('follows remote updates and stops after unbinding', () => {
    const doc = newDoc()
    const remote = newDoc()
    const off = bindDoc(doc)
    applyIntent(remote, env({ type: 'props.place', props: [prop('r')] }, other))
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote))
    expect(useGame.getState().props['r' as PropId]?.editedBy).toBe(other)
    expect(useGame.getState().scenes[scene]?.name).toBe('Hall')
    off()
    applyIntent(doc, env({ type: 'props.remove', ids: ['r' as PropId] }))
    expect(useGame.getState().props['r' as PropId]).toBeDefined()
  })
})

describe('undo and redo of build edits', () => {
  let doc: Y.Doc
  let off: () => void
  const props = () => doc.getMap<Prop>('props')
  /** What the controller does for this user: validate, capture, apply, settle. */
  const dispatch = async (intent: Intent) => {
    const s = useGame.getState()
    const pending = isReplaying() ? null : captureUndo(intent, s)
    if (validatePropsIntent(intent, s)) return
    applyIntent(doc, env(intent))
    commitUndo(pending, useGame.getState())
  }
  /** Another builder's edit, straight into the document. */
  const theirs = (intent: Intent) => applyIntent(doc, env(intent, other))

  beforeEach(() => {
    off?.()
    doc = newDoc()
    off = bindDoc(doc)
    bindUndoDispatcher(null)
    bindUndoDispatcher(dispatch)
  })

  it('round-trips place, move, turn, scale and remove', async () => {
    await dispatch({ type: 'props.place', props: [prop('a', { tags: ['crate'], catalogue: 'builtin:props/crate.glb' })] })
    await dispatch({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { position: { x: 3, y: 0, z: 1 } } }] })
    await dispatch({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { rotation: { x: 0.1, y: 1, z: 0 } } }] })
    await dispatch({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { scale: { x: 2, y: 1, z: 0.5 } } }] })
    await dispatch({ type: 'props.remove', ids: ['a' as PropId] })
    expect(useUndo.getState().stack.map((e) => e.label)).toEqual(['Placed a', 'Moved a', 'Turned a', 'Resized a', 'Removed a'])

    const removed = await undoLast()
    expect(describeOutcome(removed!, 'undo')).toBe('Restored a')
    expect(props().get('a')).toMatchObject({ tags: ['crate'], catalogue: 'builtin:props/crate.glb', scale: { x: 2, y: 1, z: 0.5 } })
    await undoLast()
    expect(props().get('a')?.scale).toEqual({ x: 1, y: 1, z: 1 })
    await undoLast()
    expect(props().get('a')?.rotation).toEqual({ x: 0, y: 0, z: 0 })
    await undoLast()
    expect(props().get('a')?.position).toEqual({ x: 0, y: 0, z: 0 })
    await undoLast()
    expect(props().has('a')).toBe(false)
    expect(await undoLast()).toBeNull()

    for (let i = 0; i < 5; i++) await redoLast()
    expect(props().has('a')).toBe(false) // the last redo removed it again
    await undoLast()
    expect(props().get('a')).toMatchObject({ position: { x: 3, y: 0, z: 1 }, rotation: { x: 0.1, y: 1, z: 0 }, scale: { x: 2, y: 1, z: 0.5 } })
    expect(await redoLast()).not.toBeNull()
    expect(await redoLast()).toBeNull()
  })

  it('undoes and redoes light, wall and door parts; opening a door is never undone', async () => {
    await dispatch({ type: 'props.place', props: [prop('t')] })
    await dispatch({ type: 'props.update', updates: [{ id: 't' as PropId, patch: { light: { color: '#ffa040', radius: 6, flicker: true } } }] })
    await dispatch({ type: 'props.update', updates: [{ id: 't' as PropId, patch: { light: { color: '#ffffff', radius: 3 } } }] })
    await dispatch({ type: 'props.update', updates: [{ id: 't' as PropId, patch: { door: { open: false, width: 1 } } }] })
    await dispatch({ type: 'props.update', updates: [{ id: 't' as PropId, patch: { door: { open: false, locked: true, width: 1 } } }] })
    // Someone opens it (play, not an edit).
    applyIntent(doc, env({ type: 'prop.door', prop: 't' as PropId, open: true }, other))
    expect(props().get('t')!.door).toEqual({ open: true, locked: true, width: 1 })
    await undoLast() // unlock: still open
    expect(props().get('t')!.door).toEqual({ open: true, width: 1 })
    await undoLast() // the door part goes
    expect(props().get('t')!.door).toBeUndefined()
    await undoLast()
    expect(props().get('t')!.light).toEqual({ color: '#ffa040', radius: 6, flicker: true })
    await undoLast()
    expect(props().get('t')!.light).toBeUndefined()
    await redoLast()
    await redoLast()
    expect(props().get('t')!.light).toEqual({ color: '#ffffff', radius: 3 })
  })

  it('skips, with a note, props someone else changed since, and still undoes the rest', async () => {
    await dispatch({ type: 'props.place', props: [prop('a'), prop('b')] })
    await dispatch({ type: 'props.update', updates: [
      { id: 'a' as PropId, patch: { position: { x: 1, y: 0, z: 0 } } },
      { id: 'b' as PropId, patch: { position: { x: 2, y: 0, z: 0 } } },
    ] })
    theirs({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { position: { x: 9, y: 0, z: 9 } } }] })

    const out = await undoLast()
    expect(out?.skipped).toEqual(['a'])
    expect(out?.note).toMatch(/a was changed by someone else/)
    expect(describeOutcome(out!, 'undo')).toMatch(/^Undid: Moved 2 props\. a was changed/)
    expect(props().get('a')?.position).toEqual({ x: 9, y: 0, z: 9 })
    expect(props().get('b')?.position).toEqual({ x: 0, y: 0, z: 0 })

    // The redo step only holds what was undone.
    expect(useUndo.getState().redo.at(-1)?.props?.map((c) => c.id)).toEqual(['b'])
    await redoLast()
    expect(props().get('b')?.position).toEqual({ x: 2, y: 0, z: 0 })
    expect(props().get('a')?.position).toEqual({ x: 9, y: 0, z: 9 })
  })

  it('skips the whole step when every prop was changed, and moves on to the next one', async () => {
    await dispatch({ type: 'props.place', props: [prop('a')] })
    await dispatch({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { name: 'Mine' } }] })
    theirs({ type: 'props.remove', ids: ['a' as PropId] })
    const out = await undoLast()
    expect(describeOutcome(out!, 'undo')).toBe('Nothing to undo: a was changed by someone else since; left as it is')
    expect(useUndo.getState().redo).toHaveLength(0)
    // The place step's prop is gone as well (removed by them): skipped too, nothing comes back.
    const next = await undoLast()
    expect(next?.skipped).toEqual(['a'])
    expect(props().has('a')).toBe(false)
  })

  it('does not count their edit if my later undo already restored my state', async () => {
    await dispatch({ type: 'props.place', props: [prop('a')] })
    await dispatch({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { position: { x: 1, y: 0, z: 0 } } }] })
    await dispatch({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { position: { x: 2, y: 0, z: 0 } } }] })
    await undoLast()
    await undoLast()
    expect(props().get('a')?.position).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('clears the redo stack on a new edit', async () => {
    await dispatch({ type: 'props.place', props: [prop('a')] })
    await dispatch({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { position: { x: 1, y: 0, z: 0 } } }] })
    await undoLast()
    expect(useUndo.getState().redo).toHaveLength(1)
    await dispatch({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { name: 'New' } }] })
    expect(useUndo.getState().redo).toHaveLength(0)
    expect(await redoLast()).toBeNull()
  })

  it('undoes a stamp, props and walls, as one step', async () => {
    await dispatch({ type: 'props.place', props: [prop('a'), prop('b')], walls: [wall('w1')] })
    expect(useUndo.getState().stack).toHaveLength(1)
    expect(useUndo.getState().stack[0].label).toBe('Placed 2 props')
    await undoLast()
    expect(props().size).toBe(0)
    expect(doc.getMap('walls').size).toBe(0)
    await redoLast()
    expect([...props().keys()].sort()).toEqual(['a', 'b'])
    expect(doc.getMap('walls').has('w1')).toBe(true)
  })

  it('records nothing for a refused or empty edit, and nothing while replaying', async () => {
    await dispatch({ type: 'props.update', updates: [{ id: 'nope' as PropId, patch: { name: 'x' } }] })
    await dispatch({ type: 'props.place', props: [prop('a', { scale: { x: 0, y: 1, z: 1 } })] })
    expect(useUndo.getState().stack).toHaveLength(0)
    await dispatch({ type: 'props.place', props: [prop('a')] })
    await dispatch({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { position: { x: 0, y: 0, z: 0 } } }] }) // no change
    expect(useUndo.getState().stack).toHaveLength(1)
    await undoLast()
    expect(useUndo.getState().stack).toHaveLength(0)
    expect(useUndo.getState().redo).toHaveLength(1)
  })

  it('is not confused by the one-off scale migration', async () => {
    await dispatch({ type: 'props.place', props: [prop('old', { scale: 2 })] })
    await dispatch({ type: 'props.update', updates: [{ id: 'old' as PropId, patch: { position: { x: 4, y: 0, z: 0 } } }] })
    theirs({ type: 'props.migrate', items: [{ id: 'old' as PropId, fit: 0.25 }] })
    const out = await undoLast()
    expect(out?.skipped).toEqual([])
    expect(props().get('old')).toMatchObject({ position: { x: 0, y: 0, z: 0 }, scale: { x: 0.5, y: 0.5, z: 0.5 } })
  })

  it('keeps the last MAX_UNDO steps', async () => {
    await dispatch({ type: 'props.place', props: [prop('a')] })
    for (let i = 1; i <= MAX_UNDO + 10; i++) await dispatch({ type: 'props.update', updates: [{ id: 'a' as PropId, patch: { position: { x: i, y: 0, z: 0 } } }] })
    expect(useUndo.getState().stack).toHaveLength(MAX_UNDO)
    for (let i = 0; i < MAX_UNDO; i++) await undoLast()
    expect(props().get('a')?.position.x).toBe(10)
  })
})

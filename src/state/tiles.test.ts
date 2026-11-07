/**
 * Kit tiles end to end: intent validation, apply into the nested chunk maps, the store's per-chunk
 * mirror, the game file round trip and undo/redo with the conflict skip.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { Scene } from '@/core/doc'
import type { PlayerPubkey, SceneId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { MAX_TILES_PER_INTENT } from '@/core/kits'
import { toIntentValues, validateTilesIntent } from '@/core/tiles'
import { applyIntent } from './apply'
import { bindDoc, useGame } from './store'
import { readAllTiles, writeTilesJson } from './tilesDoc'
import { bindUndoDispatcher, captureUndo, commitUndo, describeOutcome, isReplaying, redoLast, undoLast, useUndo } from './undo'

const me = 'aa'.repeat(32) as PlayerPubkey
const other = 'bb'.repeat(32) as PlayerPubkey
const scene = 's1' as SceneId
let seq = 0
const env = (intent: Intent, from: PlayerPubkey = me) => ({ id: `i${++seq}`, from, at: 1, intent })
const place = (keys: string[], values: string[], kits = ['kaykit-dungeon']): Intent => ({ type: 'tiles.place', scene, kits, keys, values })

function newDoc(): Y.Doc {
  const doc = new Y.Doc()
  doc.getMap<Scene>('scenes').set(scene, { id: scene, name: 'Hall', grid: { type: 'square', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }, cameraMode: 'orbit', darkness: 0 })
  return doc
}
const docShape = () => ({ scenes: useGame.getState().scenes, tiles: useGame.getState().tiles })

describe('validateTilesIntent', () => {
  const doc = { scenes: { [scene]: {} as Scene }, tiles: { [scene]: { kits: ['kaykit-dungeon'], chunks: { '0,0': { '1,0,0,n': '0:3:0' } } } } }
  it('accepts a packed stroke, clears included', () => {
    expect(validateTilesIntent(place(['0,0,0,f', '1,0,0,n', '2,1,-3,v'], ['0:1:0', '', '0:2:3:1']), doc)).toBeNull()
  })
  it('refuses bad batches', () => {
    expect(validateTilesIntent({ type: 'tiles.place', scene: 'nope' as SceneId, kits: ['kaykit-dungeon'], keys: ['0,0,0,f'], values: ['0:1:0'] }, doc)).toBe('unknown scene')
    expect(validateTilesIntent(place([], []), doc)).toBe('nothing to place')
    expect(validateTilesIntent(place(['0,0,0,q'], ['0:1:0']), doc)).toBe('not a tile cell')
    expect(validateTilesIntent(place(['0,0,0,f', '0,0,0,f'], ['0:1:0', '0:1:0']), doc)).toBe('the same cell twice in one batch')
    expect(validateTilesIntent(place(['0,0,0,f'], []), doc)).toBe('one value per cell')
    expect(validateTilesIntent(place(['0,0,0,f'], ['0:1:9']), doc)).toBe('not a tile value')
    expect(validateTilesIntent(place(['0,0,0,f'], ['1:1:0']), doc)).toBe('tile names a kit the intent does not list')
    expect(validateTilesIntent(place(['0,0,0,f'], ['0:1:0'], ['Bad Kit']), doc)).toBe('bad kit id')
    const many = Array.from({ length: MAX_TILES_PER_INTENT + 1 }, (_, i) => `${i % 8000},0,${Math.floor(i / 8000)},f`)
    expect(validateTilesIntent(place(many, many.map(() => '0:1:0')), doc)).toMatch(/too many/)
    expect(validateTilesIntent({ type: 'tiles.erase', scene, keys: ['x'] }, doc)).toBe('not a tile cell')
  })
  it('checks doors against the document', () => {
    expect(validateTilesIntent({ type: 'tiles.door', scene, key: '1,0,0,n', open: true }, doc)).toBeNull()
    expect(validateTilesIntent({ type: 'tiles.door', scene, key: '2,0,0,n', open: true }, doc)).toBe('no door there')
    expect(validateTilesIntent({ type: 'tiles.door', scene, key: '1,0,0,f', open: true }, doc)).toBe('not a wall edge')
  })
})

describe('tiles in the document and the store', () => {
  let doc: Y.Doc
  let off: () => void
  beforeEach(() => { off?.(); doc = newDoc(); off = bindDoc(doc) })

  it('writes one transaction per stroke into per-chunk maps, mapping the intent kits onto the scene table', () => {
    let updates = 0
    doc.on('update', () => { updates++ })
    applyIntent(doc, env(place(['0,0,0,f', '20,1,-1,n'], ['0:5:1', '1:2:0'], ['kenney-town', 'kaykit-dungeon'])))
    expect(updates).toBe(1)
    const t = readAllTiles(doc)[scene]!
    // Built-in kits keep their fixed index: kaykit-dungeon 0, kenney-town 1.
    expect(t.kits).toEqual(['kaykit-dungeon', 'kenney-town'])
    expect(t.chunks).toEqual({ '0,0': { '0,0,0,f': '1:5:1' }, '1,-1': { '20,1,-1,n': '0:2:0' } })
  })

  it('mirrors chunk by chunk: an edit replaces only the chunk records it touched', () => {
    applyIntent(doc, env(place(['0,0,0,f', '17,0,0,f', '40,0,40,f'], ['0:1:0', '0:1:0', '0:1:0'])))
    const before = useGame.getState().tiles[scene]!
    expect(Object.keys(before.chunks).sort()).toEqual(['0,0', '1,0', '2,2'])
    applyIntent(doc, env(place(['1,0,0,f'], ['0:2:0'])))
    const after = useGame.getState().tiles[scene]!
    expect(after).not.toBe(before)
    expect(after.chunks['0,0']).not.toBe(before.chunks['0,0'])
    expect(after.chunks['0,0']).toEqual({ '0,0,0,f': '0:1:0', '1,0,0,f': '0:2:0' })
    expect(after.chunks['1,0']).toBe(before.chunks['1,0'])
    expect(after.chunks['2,2']).toBe(before.chunks['2,2'])
    // A chat line leaves the tiles alone.
    applyIntent(doc, env({ type: 'chat.say', text: 'hi' }))
    expect(useGame.getState().tiles).toBe(useGame.getState().tiles)
    expect(useGame.getState().tiles[scene]).toBe(after)
    applyIntent(doc, env({ type: 'tiles.erase', scene, keys: ['0,0,0,f', '1,0,0,f'] }))
    expect(useGame.getState().tiles[scene]!.chunks['0,0']).toEqual({})
    expect(useGame.getState().tiles[scene]!.chunks['1,0']).toBe(before.chunks['1,0'])
  })

  it('opens and closes kit doors through the variant', () => {
    applyIntent(doc, env(place(['3,0,0,n'], ['0:7:0'])))
    applyIntent(doc, env({ type: 'tiles.door', scene, key: '3,0,0,n', open: true }))
    expect(useGame.getState().tiles[scene]!.chunks['0,0']!['3,0,0,n']).toBe('0:7:0:1')
    applyIntent(doc, env({ type: 'tiles.door', scene, key: '3,0,0,n', open: false }))
    expect(useGame.getState().tiles[scene]!.chunks['0,0']!['3,0,0,n']).toBe('0:7:0')
  })

  it('round-trips through the game file shape', () => {
    applyIntent(doc, env(place(['0,0,0,f', '-1,2,-1,v'], ['0:1:0', '0:9:2'])))
    const json = readAllTiles(doc)
    const copy = new Y.Doc()
    copy.transact(() => writeTilesJson(copy, JSON.parse(JSON.stringify(json))))
    expect(readAllTiles(copy)).toEqual(json)
  })

  it('converts stored values back into an intent', () => {
    expect(toIntentValues(['1:4:0', null, '0:2:1:1'], ['kaykit-dungeon', 'kenney-town'])).toEqual({ kits: ['kenney-town', 'kaykit-dungeon'], values: ['0:4:0', '', '1:2:1:1'] })
  })
})

describe('undo and redo of tile strokes', () => {
  let doc: Y.Doc
  let off: () => void
  const cells = () => readAllTiles(doc)[scene]?.chunks['0,0'] ?? {}
  const dispatch = async (intent: Intent) => {
    const s = useGame.getState()
    const pending = isReplaying() ? null : captureUndo(intent, s)
    if (validateTilesIntent(intent, docShape())) return
    applyIntent(doc, env(intent))
    commitUndo(pending, useGame.getState())
  }
  const theirs = (intent: Intent) => applyIntent(doc, env(intent, other))

  beforeEach(() => {
    off?.()
    doc = newDoc()
    off = bindDoc(doc)
    bindUndoDispatcher(null)
    bindUndoDispatcher(dispatch)
  })

  it('restores exactly the cells a stroke wrote, and redoes it', async () => {
    await dispatch(place(['0,0,0,f'], ['0:1:0']))
    await dispatch(place(['0,0,0,f', '1,0,0,n', '2,0,0,n'], ['0:2:0', '0:3:0', '0:3:2']))
    expect(useUndo.getState().stack.map((e) => e.label)).toEqual(['Built 1 tile', 'Built 3 tiles'])
    const o = await undoLast()
    expect(describeOutcome(o!, 'undo')).toBe('Undid: Built 3 tiles')
    expect(cells()).toEqual({ '0,0,0,f': '0:1:0' })
    await redoLast()
    expect(cells()).toEqual({ '0,0,0,f': '0:2:0', '1,0,0,n': '0:3:0', '2,0,0,n': '0:3:2' })
    await undoLast()
    await undoLast()
    expect(cells()).toEqual({})
  })

  it('undoes an erase', async () => {
    await dispatch(place(['0,0,0,f', '1,0,0,f'], ['0:1:0', '0:1:1']))
    await dispatch({ type: 'tiles.erase', scene, keys: ['0,0,0,f', '1,0,0,f'] })
    expect(cells()).toEqual({})
    await undoLast()
    expect(cells()).toEqual({ '0,0,0,f': '0:1:0', '1,0,0,f': '0:1:1' })
  })

  it('skips cells someone else changed since, with a note, and undoes the rest', async () => {
    await dispatch(place(['0,0,0,f', '1,0,0,f', '2,0,0,f'], ['0:1:0', '0:1:0', '0:1:0']))
    theirs(place(['1,0,0,f'], ['0:5:0']))
    theirs({ type: 'tiles.erase', scene, keys: ['2,0,0,f'] })
    const o = await undoLast()
    expect(o!.skippedTiles).toBe(2)
    expect(describeOutcome(o!, 'undo')).toBe('Undid: Built 3 tiles. 2 tiles changed by someone else since; left as they are')
    expect(cells()).toEqual({ '1,0,0,f': '0:5:0' })
    // Redo puts back only the cell the undo took.
    await redoLast()
    expect(cells()).toEqual({ '0,0,0,f': '0:1:0', '1,0,0,f': '0:5:0' })
  })

  it('records nothing for a stroke that changed nothing', async () => {
    await dispatch(place(['0,0,0,f'], ['0:1:0']))
    await dispatch(place(['0,0,0,f'], ['0:1:0']))
    await dispatch({ type: 'tiles.erase', scene, keys: ['5,0,5,f'] })
    expect(useUndo.getState().stack).toHaveLength(1)
  })
})

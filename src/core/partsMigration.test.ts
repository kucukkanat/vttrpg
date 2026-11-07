/**
 * The conversion of drawn walls, doors, imported segments and placed lights into props, end to
 * end through apply: every fixture viewer sees exactly the same cells before and after, doors keep
 * working, players' locked doors stay shut, and the lights shine the same.
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import type { GameDocShape, PlacedLight, Prop, Scene, Wall } from './doc'
import type { LightId, PlayerPubkey, PropId, SceneId, WallId } from './ids'
import type { Intent } from './intents'
import { applyIntent } from '@/state/apply'
import { computeVisibleCells } from '@/table/vision'
import { docBlockingSegments, moveBlocked } from '@/table/build/wallEdit'
import { conversionIntents, convertedLightId, convertedWallId, needsConversion } from './partsMigration'
import { BARE_LIGHT_HEIGHT_CELLS, doorRefusal, hasModel, lightEmitter, moveSegments, propSegmentsByLevel, sightSegments } from './propParts'
import { validatePropsIntent } from './props'

const gm = 'aa'.repeat(32) as PlayerPubkey
const scene = 's1' as SceneId
const grid = { type: 'square' as const, cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }
const w = (id: string, a: [number, number], b: [number, number], over: Partial<Wall> = {}): Wall =>
  ({ id: id as WallId, scene, a: { x: a[0], z: a[1] }, b: { x: b[0], z: b[1] }, source: 'drawn', ...over })

/** A room with a closed door, an open door, a locked door, a detected wall, imported segments and two lights. */
function fixture(): Y.Doc {
  const doc = new Y.Doc()
  const sc: Scene = {
    id: scene, name: 'Crypt', grid, cameraMode: 'orbit', darkness: 0.6, playersOpenDoors: true,
    walls: [{ a: { x: 12, z: -6 }, b: { x: 12, z: 6 } }, { a: { x: -6, z: 9 }, b: { x: 6, z: 9 } }],
  }
  doc.getMap<Scene>('scenes').set(scene, sc)
  const walls = doc.getMap<Wall>('walls')
  for (const x of [
    w('n', [-6, -6], [6, -6]), w('s1', [-6, 6], [-1.5, 6]), w('s2', [1.5, 6], [6, 6]),
    w('e1', [6, -6], [6, -1]), w('e2', [6, 1], [6, 6]), w('wW', [-6, -6], [-6, 6], { source: 'detected' }),
    w('dS', [-1.5, 6], [1.5, 6], { door: { open: false } }),
    w('dE', [6, -1], [6, 1], { door: { open: true } }),
    w('dL', [3, -6], [3, 6], { door: { open: false, locked: true } }),
  ]) walls.set(x.id, x)
  const lights = doc.getMap<PlacedLight>('lights')
  lights.set('l1' as LightId, { id: 'l1' as LightId, scene, position: { x: 0, y: 0, z: 0 }, radius: 6, color: '#ffb35c' })
  lights.set('l2' as LightId, { id: 'l2' as LightId, scene, position: { x: 4, y: 0, z: 2 }, radius: 9, color: '#88aaff', intensity: 1.5 })
  return doc
}

const json = (doc: Y.Doc) => ({
  scenes: doc.getMap('scenes').toJSON(), walls: doc.getMap('walls').toJSON(), lights: doc.getMap('lights').toJSON(), props: doc.getMap('props').toJSON(),
}) as unknown as Pick<GameDocShape, 'scenes' | 'walls' | 'lights' | 'props'>

const viewers = [
  { x: 0.75, z: 0.75, vision: 12 }, { x: 4.5, z: -3, vision: 8 }, { x: 9, z: 0, vision: 10 }, { x: -3, z: 10.5, vision: 6 }, { x: 0, z: 7.5, vision: 6 },
]
/** Sight before: imported plus drawn walls and closed doors, as the table blocks them today. */
const sightBefore = (d: ReturnType<typeof json>) => docBlockingSegments(d.scenes[scene], Object.values(d.walls ?? {}))
/** Sight after: the wall and door props of level 0 (nothing else is left). */
const sightAfter = (d: ReturnType<typeof json>) => [...docBlockingSegments(d.scenes[scene], Object.values(d.walls ?? {})), ...sightSegments(propSegmentsByLevel(d.props, scene, { floorY: 0, cellSize: grid.cellSize }).get(0))]
const visible = (segs: ReturnType<typeof sightBefore>) => viewers.map((v) => [...computeVisibleCells(grid, [v], segs)].sort())

let seq = 0
const send = (doc: Y.Doc, intent: Intent) => {
  const bad = validatePropsIntent(intent, json(doc) as GameDocShape)
  if (bad) throw new Error(bad)
  applyIntent(doc, { id: `m${++seq}`, from: gm, at: 1, intent })
}

describe('walls, doors and lights become props', () => {
  it('builds one batched props.convert and leaves sight exactly as it was', () => {
    const doc = fixture()
    const before = visible(sightBefore(json(doc)))
    const intents = conversionIntents(json(doc), scene, 0)
    expect(intents).toHaveLength(1)
    const c = intents[0]!
    if (c.type !== 'props.convert') throw new Error('expected props.convert')
    expect(c.props).toHaveLength(9 + 2 + 2)
    expect(c.sceneWalls).toBe(true)
    for (const i of intents) send(doc, i)

    const after = json(doc)
    expect(Object.keys(after.walls ?? {})).toEqual([])
    expect(Object.keys(after.lights ?? {})).toEqual([])
    expect(after.scenes[scene]!.walls).toBeUndefined()
    expect(needsConversion(after, scene)).toBe(false)
    expect(Object.values(after.props).every((p) => !hasModel(p))).toBe(true)
    expect(visible(sightAfter(after))).toEqual(before)
    // Detected walls stay recognisable.
    expect(after.props[convertedWallId('wW' as WallId)]!.tags).toEqual(['detected'])
  })

  it('keeps doors working: open and locked survive, and opening one opens the same view', () => {
    const doc = fixture()
    for (const i of conversionIntents(json(doc), scene, 0)) send(doc, i)
    const props = json(doc).props
    const dS = props[convertedWallId('dS' as WallId)]!
    const dE = props[convertedWallId('dE' as WallId)]!
    const dL = props[convertedWallId('dL' as WallId)]!
    expect(dS.door).toMatchObject({ open: false })
    expect(dE.door).toMatchObject({ open: true })
    expect(dL.door).toMatchObject({ open: false, locked: true })
    expect(doorRefusal(dL, { playersOpenDoors: true }, { isGm: false })).toMatch(/locked/)

    // Open the south door in both worlds: the same cells come into view.
    const old = fixture()
    const ow = old.getMap<Wall>('walls')
    ow.set('dS' as WallId, { ...ow.get('dS' as WallId)!, door: { open: true } })
    send(doc, { type: 'prop.door', prop: dS.id, open: true })
    expect(visible(sightAfter(json(doc)))).toEqual(visible(sightBefore(json(old))))
    // And movement through the open door is free, through a wall blocked.
    const move = moveSegments(propSegmentsByLevel(json(doc).props, scene, { floorY: 0, cellSize: grid.cellSize }).get(0))
    expect(moveBlocked({ x: 0, z: 4.5 }, { x: 0, z: 7.5 }, move)).toBe(false)
    expect(moveBlocked({ x: -3, z: 4.5 }, { x: -3, z: 7.5 }, move)).toBe(true)
  })

  it('converts lights to bare light props that shine from the same place with the same strength', () => {
    const doc = fixture()
    for (const i of conversionIntents(json(doc), scene, 0)) send(doc, i)
    const props = json(doc).props
    const l2 = props[convertedLightId('l2' as LightId)]!
    expect(l2.light).toEqual({ color: '#88aaff', radius: 9, intensity: 1.5 })
    const e = lightEmitter(l2, grid.cellSize)!
    const cell = grid.cellSize
    // BuildLayer's placed light: at floorY + 1.4 cells, distance radius·cell·1.6, intensity 5·cell²·k·max(1, r/3).
    expect(e).toMatchObject({ x: 4, z: 2, color: '#88aaff', flicker: false, kind: 'point' })
    expect(e.y).toBeCloseTo(BARE_LIGHT_HEIGHT_CELLS * cell)
    expect(e.distance).toBeCloseTo(9 * cell * 1.6)
    expect(e.intensity).toBeCloseTo(5 * cell * cell * 1.5 * 3)
  })

  it('is idempotent: a second GM client converting the same scene adds nothing', () => {
    const doc = fixture()
    const intents = conversionIntents(json(doc), scene, 0)
    for (const i of intents) send(doc, i)
    const once = JSON.stringify(json(doc).props)
    for (const i of intents) applyIntent(doc, { id: `x${++seq}`, from: gm, at: 2, intent: i })
    expect(JSON.stringify(json(doc).props)).toBe(once)
    expect(conversionIntents(json(doc), scene, 0)).toEqual([])
  })

  it('stands converted props on the floor of a scene whose floor is raised', () => {
    const doc = fixture()
    const [c] = conversionIntents(json(doc), scene, 2.25)
    if (c?.type !== 'props.convert') throw new Error('expected props.convert')
    expect(c.props.every((p: Prop) => p.position.y === 2.25)).toBe(true)
    expect(propSegmentsByLevel(c.props, scene, { floorY: 2.25, cellSize: grid.cellSize }).has(0)).toBe(true)
  })

  it('splits huge imports into batches and clears the imported segments with the last', () => {
    const doc = new Y.Doc()
    const many = Array.from({ length: 5003 }, (_, i) => ({ a: { x: i, z: 0 }, b: { x: i, z: 1 } }))
    doc.getMap<Scene>('scenes').set(scene, { id: scene, name: 'Big', grid, cameraMode: 'orbit', darkness: 0, walls: many })
    const intents = conversionIntents(json(doc), scene, 0)
    expect(intents).toHaveLength(2)
    expect(intents.map((i) => (i.type === 'props.convert' ? !!i.sceneWalls : null))).toEqual([false, true])
    expect(intents.map((i) => (i.type === 'props.convert' ? i.props.length : 0)).reduce((a, b) => a + b)).toBe(5003)
    void ({} as Record<PropId, Prop>)
  })
})

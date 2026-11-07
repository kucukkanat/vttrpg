import { beforeEach, describe, expect, it } from 'vitest'
import type { GameMeta, PlacedLight, Prop, Token } from '@/core/doc'
import type { LightId, PlayerPubkey, PropId, SceneId, TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import { tableRuntime, useTableUi } from '@/table/tableState'
import { framePose, hideIntent, outlineRows, removeIntent, sceneOutline, selectOutlineRow } from './outlineLogic'

const scene = 's1' as SceneId
const other = 's2' as SceneId
const model = { sha256: 'ab'.repeat(32), kind: 'model', mime: 'model/gltf-binary', size: 1, sources: [] } as unknown as Prop['model']
const prop = (id: string, name: string, x: number, s: SceneId = scene, extra: Partial<Prop> = {}): Prop => ({
  id: id as PropId, scene: s, name, model, position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, ...extra,
})
const token = (id: string, name: string, x: number, hidden = false, s: SceneId = scene): Token => ({
  id: id as TokenId, scene: s, name, color: '#f00', position: { x, y: 0, z: 2 }, rotationY: 0, scale: 1, vision: 4, light: 0, hidden, conditions: [],
})
const light = (id: string, x: number, s: SceneId = scene): PlacedLight => ({ id: id as LightId, scene: s, position: { x, y: 0, z: 0 }, radius: 6, color: '#ffb35c' })

const src = {
  tokens: { t1: token('t1', 'Wolf', 1, true), t2: token('t2', 'Aria', 2), t3: token('t3', 'Elsewhere', 0, false, other) },
  props: { p1: prop('p1', 'Table', 4, scene, { locked: true }), p2: prop('p2', 'Barrel', 5), p3: prop('p3', 'Barrel', 6, other) },
  lights: { l1: light('l1', 7), l2: light('l2', 8, other) },
}

describe('sceneOutline', () => {
  it("groups the scene's tokens, props and lights, sorted by name", () => {
    const o = sceneOutline(src, scene)
    expect(o.tokens.map((r) => r.name)).toEqual(['Aria', 'Wolf'])
    expect(o.tokens[1]).toMatchObject({ kind: 'token', hidden: true, meta: 'hidden' })
    expect(o.props.map((r) => r.name)).toEqual(['Barrel', 'Table'])
    expect(o.props[1]!.meta).toBe('locked')
    expect(o.lights).toEqual([expect.objectContaining({ kind: 'light', id: 'l1', name: 'Light 1', meta: '6 cells · #ffb35c' })])
    expect(outlineRows(o).map((r) => r.id)).toEqual(['t2', 't1', 'p2', 'p1', 'l1'])
  })
  it('searches names and meta', () => {
    expect(outlineRows(sceneOutline(src, scene, 'barrel')).map((r) => r.id)).toEqual(['p2'])
    expect(outlineRows(sceneOutline(src, scene, 'hidden')).map((r) => r.id)).toEqual(['t1'])
    expect(outlineRows(sceneOutline(src, null))).toEqual([])
  })
})

describe('outliner actions', () => {
  const meta: GameMeta = { name: 'g', gm: 'gm' as PlayerPubkey, pack: 'p' as GameMeta['pack'], activeScene: scene, createdAt: 0 }
  beforeEach(() => {
    useGame.getState()._replaceFromDoc({ meta, tokens: src.tokens as Record<TokenId, Token>, props: src.props as Record<PropId, Prop>, lights: src.lights as Record<LightId, PlacedLight> })
    useGame.getState().clearSelection()
    useTableUi.setState({ viewRequest: undefined, focusRequest: undefined } as never)
    tableRuntime.cameraPosition = { x: 0, y: 10, z: 10 }
    tableRuntime.cameraTarget = { x: 0, y: 0, z: 0 }
  })
  const rows = () => sceneOutline(src, scene)

  it('a token row selects the token and frames it', () => {
    selectOutlineRow(rows().tokens[0]!)
    expect(useGame.getState().selectedToken).toBe('t2')
    expect(useTableUi.getState().focusRequest?.id).toBe('t2')
  })
  it('a prop row selects the prop and glides the camera onto it, keeping the camera offset', () => {
    selectOutlineRow(rows().props[1]!)
    expect(useGame.getState().propSelection).toEqual(['p1'])
    expect(useTableUi.getState().viewRequest?.pose).toEqual({ pos: { x: 4, y: 10, z: 10 }, target: { x: 4, y: 0, z: 0 } })
  })
  it('shift-click adds props to the selection (and takes them out again)', () => {
    selectOutlineRow(rows().props[0]!)
    selectOutlineRow(rows().props[1]!, { shift: true })
    expect(useGame.getState().propSelection).toEqual(['p2', 'p1'])
    selectOutlineRow(rows().props[0]!, { shift: true })
    expect(useGame.getState().propSelection).toEqual(['p1'])
  })
  it('a light row clears the selection and frames the light', () => {
    useGame.getState().setPropSelection(['p1' as PropId])
    selectOutlineRow(rows().lights[0]!)
    expect(useGame.getState().propSelection).toEqual([])
    expect(useTableUi.getState().viewRequest?.pose?.target).toEqual({ x: 7, y: 0, z: 0 })
  })
  it('hide and delete are one intent each', () => {
    const [aria, wolf] = rows().tokens
    expect(hideIntent(aria!)).toEqual({ type: 'token.update', token: 't2', patch: { hidden: true } })
    expect(hideIntent(wolf!)).toEqual({ type: 'token.update', token: 't1', patch: { hidden: false } })
    expect(removeIntent(aria!)).toEqual({ type: 'token.remove', token: 't2' })
    expect(removeIntent(rows().props[0]!)).toEqual({ type: 'props.remove', ids: ['p2'] })
    expect(removeIntent(rows().lights[0]!)).toEqual({ type: 'light.remove', light: 'l1' })
  })
  it('frames from a default height when the camera is unknown', () => {
    expect(framePose({ x: 1, y: 0, z: 1 }, { position: null, target: null })).toEqual({ pos: { x: 1, y: 9, z: 10 }, target: { x: 1, y: 0, z: 1 } })
  })
})

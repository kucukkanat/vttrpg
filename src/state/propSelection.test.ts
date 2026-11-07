import { beforeEach, describe, expect, it } from 'vitest'
import type { GameMeta, Prop } from '@/core/doc'
import type { PlayerPubkey, PropId, SceneId, TokenId } from '@/core/ids'
import { useGame } from './store'

const meta = (activeScene: SceneId | null): GameMeta => ({ name: 'g', gm: 'gm' as PlayerPubkey, pack: 'p' as GameMeta['pack'], activeScene, createdAt: 0 })
const s1 = 's1' as SceneId
const p = (id: string) => id as PropId
const prop = (id: string) => ({ id, scene: s1 } as unknown as Prop)
const props = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, prop(id)])) as Record<PropId, Prop>
const g = () => useGame.getState()

describe('prop multi-selection', () => {
  beforeEach(() => {
    g()._replaceFromDoc({ meta: meta(s1), props: props('a', 'b', 'c'), tokens: {} })
    g().setSelection(null)
  })

  it('set replaces the set; the last id is the primary selection', () => {
    g().setPropSelection([p('a'), p('b'), p('a')])
    expect(g().propSelection).toEqual(['a', 'b'])
    expect(g().selection).toEqual({ kind: 'prop', id: 'b' })
  })
  it('toggle adds and removes; the primary follows the last selected', () => {
    g().togglePropSelected(p('a'))
    g().togglePropSelected(p('c'))
    expect(g().propSelection).toEqual(['a', 'c'])
    expect(g().selection).toEqual({ kind: 'prop', id: 'c' })
    g().togglePropSelected(p('c'))
    expect(g().propSelection).toEqual(['a'])
    expect(g().selection).toEqual({ kind: 'prop', id: 'a' })
    g().togglePropSelected(p('a'))
    expect(g().propSelection).toEqual([])
    expect(g().selection).toBeNull()
  })
  it('add appends only new ids', () => {
    g().setPropSelection([p('a')])
    g().addPropsToSelection([p('a'), p('b'), p('c')])
    expect(g().propSelection).toEqual(['a', 'b', 'c'])
    expect(g().selection).toEqual({ kind: 'prop', id: 'c' })
  })
  it('clear empties the set and the primary', () => {
    g().setPropSelection([p('a'), p('b')])
    g().clearPropSelection()
    expect(g().propSelection).toEqual([])
    expect(g().selection).toBeNull()
  })
  it('a single prop selection is a set of one; other selections empty it', () => {
    g().setSelection({ kind: 'prop', id: p('b') })
    expect(g().propSelection).toEqual(['b'])
    g().setSelection({ kind: 'scene', id: s1 })
    expect(g().propSelection).toEqual([])
    g().setPropSelection([p('a'), p('b')])
    g().setSelectedToken('t1' as TokenId)
    expect(g().propSelection).toEqual([])
    expect(g().selectedTokens).toEqual(['t1'])
  })
  it('a prop selection clears the token selection', () => {
    g().selectMany(['t1' as TokenId, 't2' as TokenId])
    g().setPropSelection([p('a')])
    expect(g().selectedTokens).toEqual([])
    expect(g().selectedToken).toBeNull()
  })
  it('props that leave the document leave the selection', () => {
    g().setPropSelection([p('a'), p('b'), p('c')])
    g()._replaceFromDoc({ props: props('a', 'b') })
    expect(g().propSelection).toEqual(['a', 'b'])
    expect(g().selection).toEqual({ kind: 'prop', id: 'b' })
  })
  it('a scene switch drops the prop selection', () => {
    g().setPropSelection([p('a'), p('b')])
    g()._replaceFromDoc({ meta: meta('s2' as SceneId) })
    expect(g().propSelection).toEqual([])
    expect(g().selection).toBeNull()
  })
})

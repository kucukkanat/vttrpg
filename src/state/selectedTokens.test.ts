import { beforeEach, describe, expect, it } from 'vitest'
import type { GameMeta, Token } from '@/core/doc'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { useGame } from './store'

const meta = (activeScene: SceneId | null): GameMeta => ({ name: 'g', gm: 'gm' as PlayerPubkey, pack: 'p' as GameMeta['pack'], activeScene, createdAt: 0 })
const s1 = 's1' as SceneId
const a = 'a' as TokenId
const b = 'b' as TokenId
const c = 'c' as TokenId
const token = (id: TokenId): Token => ({ id, scene: s1, name: id, color: '#fff', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [] })

const state = () => useGame.getState()

describe('multi-select', () => {
  beforeEach(() => {
    state()._replaceFromDoc({ meta: meta(s1), scenes: {}, tokens: { [a]: token(a), [b]: token(b), [c]: token(c) } })
    state().clearSelection()
  })

  it('a plain select replaces the set with one token', () => {
    state().toggleSelected(a)
    state().toggleSelected(b)
    state().setSelectedToken(c)
    expect(state().selectedTokens).toEqual([c])
    expect(state().selectedToken).toBe(c)
    expect(state().selection).toEqual({ kind: 'token', id: c })
  })

  it('toggle adds to the set and keeps the first token as primary', () => {
    state().setSelectedToken(a)
    state().toggleSelected(b)
    state().toggleSelected(c)
    expect(state().selectedTokens).toEqual([a, b, c])
    expect(state().selectedToken).toBe(a)
  })

  it('toggle on a member removes it; removing the primary hands primary to the last remaining member', () => {
    state().selectMany([a, b, c])
    state().toggleSelected(b)
    expect(state().selectedTokens).toEqual([a, c])
    expect(state().selectedToken).toBe(a)
    state().toggleSelected(a)
    expect(state().selectedTokens).toEqual([c])
    expect(state().selectedToken).toBe(c)
    state().toggleSelected(c)
    expect(state().selectedTokens).toEqual([])
    expect(state().selectedToken).toBeNull()
    expect(state().selection).toBeNull()
  })

  it('toggle on an empty selection makes that token primary', () => {
    state().toggleSelected(b)
    expect(state().selectedToken).toBe(b)
    expect(state().selection).toEqual({ kind: 'token', id: b })
  })

  it('selectMany dedupes, keeps the current primary when it is included, else takes the first', () => {
    state().setSelectedToken(b)
    state().selectMany([a, b, b, c])
    expect(state().selectedTokens).toEqual([a, b, c])
    expect(state().selectedToken).toBe(b)
    state().selectMany([c, a])
    expect(state().selectedToken).toBe(c)
    state().selectMany([a, c], c)
    expect(state().selectedToken).toBe(c)
    state().selectMany([a, c], b) // not a member: ignored
    expect(state().selectedToken).toBe(c)
    state().selectMany([])
    expect(state().selectedToken).toBeNull()
  })

  it('selecting a prop or clearing the selection empties the set', () => {
    state().selectMany([a, b])
    state().setSelection({ kind: 'prop', id: 'p' as never })
    expect(state().selectedTokens).toEqual([])
    state().selectMany([a, b])
    state().setSelection(null)
    expect(state().selectedTokens).toEqual([])
    state().selectMany([a, b])
    state().clearSelection()
    expect(state().selectedTokens).toEqual([])
    expect(state().selection).toBeNull()
  })

  it('tokens that leave the document leave the set; the primary falls back to a remaining member', () => {
    state().selectMany([a, b, c], b)
    state()._replaceFromDoc({ tokens: { [a]: token(a), [c]: token(c) } })
    expect(state().selectedTokens).toEqual([a, c])
    expect(state().selectedToken).toBe(c)
    state()._replaceFromDoc({ tokens: {} })
    expect(state().selectedTokens).toEqual([])
    expect(state().selectedToken).toBeNull()
    expect(state().selection).toBeNull()
  })

  it('a scene switch drops the whole set', () => {
    state().selectMany([a, b])
    state()._replaceFromDoc({ meta: meta('s2' as SceneId) })
    expect(state().selectedTokens).toEqual([])
    expect(state().selectedToken).toBeNull()
  })
})

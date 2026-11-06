import { beforeEach, describe, expect, it } from 'vitest'
import type { GameMeta } from '@/core/doc'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { useGame } from './store'

const meta = (activeScene: SceneId | null): GameMeta => ({ name: 'g', gm: 'gm' as PlayerPubkey, pack: 'p' as GameMeta['pack'], activeScene, createdAt: 0 })
const s1 = 's1' as SceneId
const s2 = 's2' as SceneId

describe('selection across scene switches', () => {
  beforeEach(() => {
    useGame.getState()._replaceFromDoc({ meta: meta(s1), scenes: {}, tokens: {} })
    useGame.getState().setSelection(null)
  })

  it('drops the selection when the live scene changes', () => {
    useGame.getState().setSelectedToken('t1' as TokenId)
    useGame.getState()._replaceFromDoc({ meta: meta(s2) })
    expect(useGame.getState().selection).toBeNull()
    expect(useGame.getState().selectedToken).toBeNull()
  })
  it('keeps the selection through syncs that leave the live scene alone', () => {
    useGame.getState().setSelection({ kind: 'prop', id: 'p1' as never })
    useGame.getState()._replaceFromDoc({ meta: meta(s1), tokens: {} })
    useGame.getState()._replaceFromDoc({ tokens: {} })
    expect(useGame.getState().selection).toEqual({ kind: 'prop', id: 'p1' })
  })
  it('drops the selection when the live scene is cleared', () => {
    useGame.getState().setSelection({ kind: 'node', id: 'Door' })
    useGame.getState()._replaceFromDoc({ meta: meta(null) })
    expect(useGame.getState().selection).toBeNull()
  })
})

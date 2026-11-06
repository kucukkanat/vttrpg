import { describe, expect, it } from 'vitest'
import type { GameMeta, Token } from '@/core/doc'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { effectiveToken, firstOwnedToken, useGame } from './store'

const me = 'me'.padEnd(64, '0') as PlayerPubkey
const other = 'other'.padEnd(64, '0') as PlayerPubkey
const tavern = 'tavern' as SceneId
const cellar = 'cellar' as SceneId

function token(id: string, over: Partial<Token> = {}): Token {
  return {
    id: id as TokenId, scene: tavern, name: id, color: '#e0a458', position: { x: 0, y: 0, z: 0 }, rotationY: 0,
    scale: 1, vision: 4, light: 0, hidden: false, conditions: [], ...over,
  }
}

const meta = { gm: other, activeScene: tavern } as unknown as GameMeta
const tokensOf = (...list: Token[]) => Object.fromEntries(list.map((t) => [t.id, t])) as Record<TokenId, Token>

describe('firstOwnedToken', () => {
  it('returns nothing for the GM or without a pubkey', () => {
    const s = { tokens: tokensOf(token('pip', { owner: me })), meta }
    expect(firstOwnedToken(s, other)).toBeUndefined()
    expect(firstOwnedToken(s, null)).toBeUndefined()
    expect(firstOwnedToken(s, undefined)).toBeUndefined()
  })

  it('picks the first owned token in insertion order', () => {
    const s = { tokens: tokensOf(token('rat'), token('pip', { owner: me }), token('nettle', { owner: me })), meta }
    expect(firstOwnedToken(s, me)?.id).toBe('pip')
  })

  it('prefers a visible token in the active scene over hidden ones and other scenes', () => {
    const elsewhere = token('elsewhere', { owner: me, scene: cellar })
    const ghost = token('ghost', { owner: me, hidden: true })
    const pip = token('pip', { owner: me })
    expect(firstOwnedToken({ tokens: tokensOf(elsewhere, ghost, pip), meta }, me)?.id).toBe('pip')
    expect(firstOwnedToken({ tokens: tokensOf(elsewhere, ghost), meta }, me)?.id).toBe('ghost')
    expect(firstOwnedToken({ tokens: tokensOf(elsewhere), meta }, me)?.id).toBe('elsewhere')
  })

  it('works without meta (no active scene yet)', () => {
    const s = { tokens: tokensOf(token('pip', { owner: me })), meta: null }
    expect(firstOwnedToken(s, me)?.id).toBe('pip')
  })
})

describe('effectiveToken', () => {
  const tokens = tokensOf(token('rat'), token('pip', { owner: me }))

  it('is the selected token when one is selected, whoever owns it', () => {
    expect(effectiveToken({ tokens, meta, selectedToken: 'rat' as TokenId }, me)?.id).toBe('rat')
  })

  it('falls back to the first owned token when nothing is selected', () => {
    expect(effectiveToken({ tokens, meta, selectedToken: null }, me)?.id).toBe('pip')
  })

  it('falls back when the selected token no longer exists', () => {
    expect(effectiveToken({ tokens, meta, selectedToken: 'gone' as TokenId }, me)?.id).toBe('pip')
  })

  it('is undefined for a GM with nothing selected', () => {
    expect(effectiveToken({ tokens, meta, selectedToken: null }, other)).toBeUndefined()
  })

  it('reads the live store', () => {
    useGame.setState({ tokens, meta, selectedToken: null })
    expect(effectiveToken(useGame.getState(), me)?.id).toBe('pip')
    useGame.getState().setSelectedToken('rat' as TokenId)
    expect(effectiveToken(useGame.getState(), me)?.id).toBe('rat')
    useGame.getState().setSelectedToken(null)
    expect(effectiveToken(useGame.getState(), me)?.id).toBe('pip')
  })
})

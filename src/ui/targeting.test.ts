import { describe, expect, it } from 'vitest'
import type { CharacterId, PlayerPubkey } from '@/core/ids'
import { isPlayerCharacter } from './targeting'

const gm = 'gm-pubkey' as PlayerPubkey
const pip = 'pip-pubkey' as PlayerPubkey
const sheet = 'sheet' as CharacterId

describe('isPlayerCharacter', () => {
  it('is true for a token a player owns', () => {
    expect(isPlayerCharacter({ owner: pip }, undefined, gm)).toBe(true)
  })

  it('is true when only the linked sheet belongs to a player', () => {
    expect(isPlayerCharacter({ character: sheet }, { owner: pip }, gm)).toBe(true)
  })

  it('is false for GM-owned, unowned and sheetless tokens', () => {
    expect(isPlayerCharacter({ owner: gm }, { owner: gm }, gm)).toBe(false)
    expect(isPlayerCharacter({}, undefined, gm)).toBe(false)
    expect(isPlayerCharacter({ character: sheet }, { owner: undefined }, gm)).toBe(false)
  })

  it('treats any owner as a player when the GM is unknown', () => {
    expect(isPlayerCharacter({ owner: pip }, undefined, undefined)).toBe(true)
  })
})

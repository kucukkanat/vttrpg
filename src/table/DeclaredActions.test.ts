import { describe, expect, it } from 'vitest'
import type { DeclaredAction, Token } from '@/core/doc'
import type { SceneId, TokenId } from '@/core/ids'
import { dashes, visibleDeclarations } from './DeclaredActions'

const token = (id: string, over: Partial<Token> = {}): Token => ({
  id: id as TokenId, scene: 's' as SceneId, name: id, color: '#fff', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [], ...over,
})
const tokens = Object.fromEntries([
  token('ogre'), token('pip', { position: { x: 3, y: 0, z: 0 } }), token('spy', { hidden: true }), token('far', { scene: 'x' as SceneId }),
].map((t) => [t.id, t])) as Record<TokenId, Token>
const act = (id: string, targets: string[]): DeclaredAction => ({ token: id as TokenId, label: 'Smash', targets: targets as TokenId[], at: 1 })

describe('visibleDeclarations', () => {
  it('draws declarations in the scene with their targets', () => {
    const out = visibleDeclarations({ ogre: act('ogre', ['pip', 'far', 'gone']) }, tokens, 's', false)
    expect(out).toHaveLength(1)
    expect(out[0]!.targets.map((t) => t.id)).toEqual(['pip'])
  })
  it('keeps hidden tokens from players', () => {
    const declared = { spy: act('spy', ['pip']), ogre: act('ogre', ['spy']) }
    expect(visibleDeclarations(declared, tokens, 's', false).map((d) => [d.source.id, d.targets.length])).toEqual([['ogre', 0]])
    expect(visibleDeclarations(declared, tokens, 's', true)).toHaveLength(2)
    expect(visibleDeclarations(undefined, tokens, 's', true)).toEqual([])
  })
})

describe('dashes', () => {
  it('lays dashes between the token edges', () => {
    const d = dashes({ x: 0, z: 0 }, { x: 3, z: 0 }, 0.5, 0.5)
    expect(d.map((s) => s.x)).toEqual([0.75, 1.75])
    expect(d.every((s) => s.len === 0.5 && s.angle === 0)).toBe(true)
    expect(dashes({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 0.5, 0.2)).toEqual([])
  })
})

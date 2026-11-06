import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyIntent } from './apply'
import type { Token } from '@/core/doc'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'

const from = 'aa'.repeat(32) as PlayerPubkey
const env = (intent: Parameters<typeof applyIntent>[1]['intent']) => ({ id: crypto.randomUUID(), from, at: 1, intent })
const token: Token = {
  id: 't1' as TokenId, scene: 's1' as SceneId, name: 'Mouse', color: '#fff',
  position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 3, light: 0, hidden: false, conditions: [],
}

describe('applyIntent', () => {
  it('adds, moves and updates tokens', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'token.add', token }))
    applyIntent(doc, env({ type: 'token.move', token: token.id, position: { x: 1, y: 0, z: 2 } }))
    applyIntent(doc, env({ type: 'token.update', token: token.id, patch: { name: 'Rat' } }))
    const t = doc.getMap<Token>('tokens').get(token.id)!
    expect(t.position).toEqual({ x: 1, y: 0, z: 2 })
    expect(t.name).toBe('Rat')
  })
  it('accumulates fog reveals without duplicates', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'fog.reveal', scene: 's1' as SceneId, cells: ['0,0', '1,0'] }))
    applyIntent(doc, env({ type: 'fog.reveal', scene: 's1' as SceneId, cells: ['1,0', '2,0'] }))
    expect(doc.getMap('fog').get('s1')).toMatchObject({ revealed: ['0,0', '1,0', '2,0'] })
  })
  it('records rolls in chat', () => {
    const doc = new Y.Doc()
    applyIntent(doc, env({ type: 'roll', formula: 'd20', seed: 'x' }), {
      roll: { formula: 'd20', seed: 'x', dice: [{ sides: 20, value: 7 }], total: 7 },
    })
    expect(doc.getArray('chat').toJSON()[0]).toMatchObject({ kind: 'roll', roll: { total: 7 } })
  })
})

/**
 * Applies a validated intent to the Yjs document. Runs only on the GM client
 * (and optimistically on the sender). Pure with respect to everything but `doc`.
 */
import * as Y from 'yjs'
import type { ChatMessage, FogState, RollResult, Scene, Token } from '@/core/doc'
import type { IntentEnvelope } from '@/core/intents'

export interface ApplyContext {
  /** Resolved roll for 'roll' intents (the GM computes it from the seed). */
  roll?: RollResult
  /** Character patches + messages produced by the rules engine for 'skill.use'. */
  skill?: { patches: { character: string; data: Record<string, unknown> }[]; messages: string[] }
}

export function applyIntent(doc: Y.Doc, env: IntentEnvelope, ctx: ApplyContext = {}): void {
  const { intent, from, at } = env
  const tokens = doc.getMap<Token>('tokens')
  const scenes = doc.getMap<Scene>('scenes')
  const characters = doc.getMap<Record<string, unknown>>('characters')
  const chat = doc.getArray<ChatMessage>('chat')
  const fog = doc.getMap<FogState>('fog')
  const meta = doc.getMap<unknown>('meta')

  doc.transact(() => {
    switch (intent.type) {
      case 'token.add':
        tokens.set(intent.token.id, intent.token)
        break
      case 'token.remove':
        tokens.delete(intent.token)
        break
      case 'token.move': {
        const t = tokens.get(intent.token)
        if (!t) return
        tokens.set(intent.token, { ...t, position: intent.position, rotationY: intent.rotationY ?? t.rotationY })
        break
      }
      case 'token.update': {
        const t = tokens.get(intent.token)
        if (!t) return
        tokens.set(intent.token, { ...t, ...intent.patch, id: t.id })
        break
      }
      case 'scene.add':
        scenes.set(intent.scene.id, intent.scene)
        break
      case 'scene.activate':
        meta.set('activeScene', intent.scene)
        break
      case 'scene.update': {
        const s = scenes.get(intent.scene)
        if (!s) return
        scenes.set(intent.scene, { ...s, ...intent.patch, id: s.id })
        break
      }
      case 'character.upsert':
        characters.set(intent.character.id, intent.character as unknown as Record<string, unknown>)
        break
      case 'character.remove':
        characters.delete(intent.character)
        break
      case 'chat.say':
        chat.push([{ id: env.id, author: from, at, kind: intent.to ? 'whisper' : 'say', text: intent.text, to: intent.to }])
        break
      case 'roll':
        chat.push([
          {
            id: env.id,
            author: from,
            at,
            kind: 'roll',
            text: intent.label ?? intent.formula,
            roll: ctx.roll ?? { formula: intent.formula, seed: intent.seed, dice: [], total: 0 },
          },
        ])
        break
      case 'skill.use': {
        for (const p of ctx.skill?.patches ?? []) {
          const c = characters.get(p.character)
          if (c) characters.set(p.character, { ...c, data: { ...(c.data as object), ...p.data } })
        }
        for (const text of ctx.skill?.messages ?? []) {
          chat.push([{ id: crypto.randomUUID(), author: from, at, kind: 'system', text }])
        }
        break
      }
      case 'fog.reveal': {
        const f = fog.get(intent.scene) ?? { scene: intent.scene, revealed: [] }
        const set = new Set(f.revealed)
        for (const c of intent.cells) set.add(c)
        if (set.size !== f.revealed.length) fog.set(intent.scene, { scene: intent.scene, revealed: [...set] })
        break
      }
      case 'fog.reset':
        fog.set(intent.scene, { scene: intent.scene, revealed: [] })
        break
    }
  }, from)
}

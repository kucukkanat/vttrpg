/**
 * Applies a validated intent to the Yjs document. Runs only on the GM client
 * (and optimistically on the sender). Pure with respect to everything but `doc`.
 */
import * as Y from 'yjs'
import type { ChatMessage, FogState, GameEvent, Note, Prop, RollResult, Scene, Token } from '@/core/doc'
import type { SkillDef } from '@/core/pack'
import type { VfxCue } from '@/core/pack'
import type { IntentEnvelope } from '@/core/intents'

export interface ApplyContext {
  /** Resolved roll for 'roll' intents (the GM computes it from the seed). */
  roll?: RollResult
  /** Character patches + messages produced by the rules engine for 'skill.use'. */
  skill?: { patches: { character: string; data: Record<string, unknown> }[]; messages: string[]; vfx?: VfxCue[] }
}

/** Shallow merge that removes keys set to undefined (Yjs cannot store undefined). */
function merge<T extends object>(base: T, patch: Partial<T>): T {
  const out = { ...base, ...patch } as Record<string, unknown>
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out as T
}

export function applyIntent(doc: Y.Doc, env: IntentEnvelope, ctx: ApplyContext = {}): void {
  const { intent, from, at } = env
  const tokens = doc.getMap<Token>('tokens')
  const scenes = doc.getMap<Scene>('scenes')
  const characters = doc.getMap<Record<string, unknown>>('characters')
  const chat = doc.getArray<ChatMessage>('chat')
  const fog = doc.getMap<FogState>('fog')
  const meta = doc.getMap<unknown>('meta')
  const events = doc.getArray<GameEvent>('events')
  const props = doc.getMap<Prop>('props')
  const notes = doc.getMap<Note>('notes')
  const customSkills = doc.getMap<SkillDef>('customSkills')

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
        tokens.set(intent.token, merge(t, { ...intent.patch, id: t.id }))
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
        scenes.set(intent.scene, merge(s, { ...intent.patch, id: s.id }))
        break
      }
      case 'scene.remove':
        // The live scene stays: switching first is the only way to remove it.
        if (meta.get('activeScene') === intent.scene) return
        scenes.delete(intent.scene)
        break
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
        const src = tokens.get(intent.source)
        if (ctx.skill?.vfx?.length && src) {
          events.push([{ id: env.id, at, kind: 'vfx', cues: ctx.skill.vfx, scene: src.scene, source: intent.source, targets: intent.targets, point: intent.point, label: intent.skill }])
        }
        break
      }
      case 'token.claim': {
        const t = tokens.get(intent.token)
        if (!t) return
        const owner = intent.owner ?? from
        tokens.set(intent.token, { ...t, owner })
        // The sheet follows the token so the new owner can edit it.
        if (t.character) {
          const c = characters.get(t.character)
          if (c) characters.set(t.character, { ...c, owner })
        }
        break
      }
      case 'audio.play':
        events.push([{ id: env.id, at, kind: 'audio', asset: intent.asset, volume: intent.volume, by: from }])
        break
      case 'prop.add':
        props.set(intent.prop.id, intent.prop)
        break
      case 'prop.update': {
        const p = props.get(intent.prop)
        if (!p) return
        props.set(intent.prop, merge(p, { ...intent.patch, id: p.id }))
        break
      }
      case 'prop.remove':
        props.delete(intent.prop)
        break
      case 'note.upsert':
        notes.set(intent.note.id, intent.note)
        break
      case 'note.remove':
        notes.delete(intent.note)
        break
      case 'skill.upsert':
        customSkills.set(intent.skill.id, intent.skill)
        break
      case 'skill.remove':
        customSkills.delete(intent.skill)
        break
      case 'event.prune': {
        const keep = events.toArray().filter((e) => e.at >= intent.before).length
        const drop = events.length - keep
        if (drop > 0) events.delete(0, drop)
        break
      }
      case 'fog.reveal': {
        const f = fog.get(intent.scene) ?? { scene: intent.scene, revealed: [] }
        const set = new Set(f.revealed)
        for (const c of intent.cells) set.add(c)
        if (set.size !== f.revealed.length) fog.set(intent.scene, { ...f, scene: intent.scene, revealed: [...set] })
        break
      }
      case 'fog.reset':
        fog.set(intent.scene, { scene: intent.scene, revealed: [] })
        break
      case 'fog.revealAll': {
        const f = fog.get(intent.scene) ?? { scene: intent.scene, revealed: [] }
        if (!f.revealAll) fog.set(intent.scene, { ...f, revealAll: true })
        break
      }
    }
  }, from)
}

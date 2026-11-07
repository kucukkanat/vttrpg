/**
 * Applies a validated intent to the Yjs document. Runs only on the GM client
 * (and optimistically on the sender). Pure with respect to everything but `doc`.
 */
import * as Y from 'yjs'
import type { ChatMessage, FogState, GameEvent, InitiativeEntry, InitiativeState, Note, PlacedLight, Prefab, Prop, ResourceDelta, RollResult, Scene, Token, Wall } from '@/core/doc'
import type { TokenId } from '@/core/ids'
import type { SkillDef } from '@/core/pack'
import type { VfxCue } from '@/core/pack'
import type { IntentEnvelope } from '@/core/intents'

export interface ApplyContext {
  /** Resolved roll for 'roll' intents (the GM computes it from the seed). */
  roll?: RollResult
  /** Character patches + messages produced by the rules engine for 'skill.use'. */
  skill?: { patches: { character: string; data: Record<string, unknown> }[]; messages: string[]; vfx?: VfxCue[] }
}

/** A sheet value the engine tracks as a resource: a bare number or `{ current }`. */
function resourceValue(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (v && typeof v === 'object') {
    const c = (v as { current?: unknown }).current
    return typeof c === 'number' && Number.isFinite(c) ? c : undefined
  }
  return undefined
}

/**
 * Resource deltas per token from the engine's sheet patches, for floating numbers on the table.
 * Only keys that were and remain resource-shaped count; `tokensOf` maps a character to the
 * tokens that show it (the skill's source and targets first). Zero deltas are dropped.
 */
export function skillNumbers(
  patches: { character: string; data: Record<string, unknown> }[],
  before: (character: string) => Record<string, unknown> | undefined,
  tokensOf: (character: string) => TokenId[],
): ResourceDelta[] {
  const out: ResourceDelta[] = []
  for (const p of patches) {
    const prev = before(p.character)
    if (!prev) continue
    const tokens = tokensOf(p.character)
    if (!tokens.length) continue
    for (const [key, next] of Object.entries(p.data)) {
      const a = resourceValue(prev[key])
      const b = resourceValue(next)
      if (a === undefined || b === undefined || a === b) continue
      for (const token of tokens) out.push({ token, delta: b - a, resource: key })
    }
  }
  return out
}

// ----------------------------------------------------------------- initiative

export const EMPTY_INITIATIVE: InitiativeState = { active: false, round: 0, turn: 0, order: [] }

/** Highest score first; equal scores keep their given order. */
export function sortInitiative(order: InitiativeEntry[]): InitiativeEntry[] {
  return order
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.score - a.e.score || a.i - b.i)
    .map(({ e }) => e)
}

/** One turn on: past the end the round increments and the first combatant is up again. */
export function nextTurn(s: InitiativeState): InitiativeState {
  if (!s.active || s.order.length === 0) return s
  const turn = s.turn + 1
  return turn >= s.order.length ? { ...s, turn: 0, round: s.round + 1 } : { ...s, turn }
}

/**
 * The order replaced by `order`: the combatant whose turn it is keeps it when still listed;
 * otherwise the turn index is clamped (an empty order wraps it to 0).
 */
export function withOrder(s: InitiativeState, order: InitiativeEntry[]): InitiativeState {
  const current = s.order[s.turn]?.token
  const idx = current === undefined ? -1 : order.findIndex((e) => e.token === current)
  const turn = idx >= 0 ? idx : Math.min(s.turn, Math.max(0, order.length - 1))
  return { ...s, order, turn }
}

/**
 * A combatant dropped: turns before it shift down; removing the one whose turn it is hands the
 * turn to the next in line, wrapping into a new round past the end.
 */
export function withoutToken(s: InitiativeState, token: TokenId): InitiativeState {
  const idx = s.order.findIndex((e) => e.token === token)
  if (idx < 0) return s
  const order = s.order.filter((e) => e.token !== token)
  if (idx < s.turn) return { ...s, order, turn: s.turn - 1 }
  if (idx === s.turn && s.turn >= order.length) return { ...s, order, turn: 0, round: order.length ? s.round + 1 : s.round }
  return { ...s, order }
}

function readInitiative(map: Y.Map<unknown>): InitiativeState {
  const order = map.get('order')
  if (!Array.isArray(order)) return EMPTY_INITIATIVE
  return {
    active: map.get('active') === true,
    round: typeof map.get('round') === 'number' ? (map.get('round') as number) : 0,
    turn: typeof map.get('turn') === 'number' ? (map.get('turn') as number) : 0,
    order: order as InitiativeEntry[],
  }
}

function writeInitiative(map: Y.Map<unknown>, s: InitiativeState): void {
  map.set('active', s.active)
  map.set('round', s.round)
  map.set('turn', s.turn)
  map.set('order', s.order)
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
  const initiative = doc.getMap<unknown>('initiative')
  const walls = doc.getMap<Wall>('walls')
  const lights = doc.getMap<PlacedLight>('lights')
  const prefabs = doc.getMap<Prefab>('prefabs')

  doc.transact(() => {
    switch (intent.type) {
      case 'token.add':
        tokens.set(intent.token.id, intent.token)
        break
      case 'token.remove': {
        tokens.delete(intent.token)
        // A deleted token leaves the turn order too.
        const init = readInitiative(initiative)
        if (init.order.some((e) => e.token === intent.token)) writeInitiative(initiative, withoutToken(init, intent.token))
        break
      }
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
        const src = tokens.get(intent.source)
        // Tokens showing a sheet: the cast's own tokens first, then any other in the same scene.
        const involved = [intent.source, ...intent.targets].map((id) => tokens.get(id)).filter((t): t is Token => !!t)
        const tokensOf = (character: string): TokenId[] => {
          const own = involved.filter((t) => t.character === character).map((t) => t.id)
          if (own.length) return [...new Set(own)]
          const rest: TokenId[] = []
          tokens.forEach((t) => { if (t.character === character && (!src || t.scene === src.scene)) rest.push(t.id) })
          return rest
        }
        const numbers = skillNumbers(
          ctx.skill?.patches ?? [],
          (id) => (characters.get(id)?.data as Record<string, unknown> | undefined),
          tokensOf,
        )
        for (const p of ctx.skill?.patches ?? []) {
          const c = characters.get(p.character)
          if (c) characters.set(p.character, { ...c, data: { ...(c.data as object), ...p.data } })
        }
        for (const text of ctx.skill?.messages ?? []) {
          chat.push([{ id: crypto.randomUUID(), author: from, at, kind: 'system', text }])
        }
        if (src && (ctx.skill?.vfx?.length || numbers.length)) {
          const ev: Extract<GameEvent, { kind: 'vfx' }> = { id: env.id, at, kind: 'vfx', cues: ctx.skill?.vfx ?? [], scene: src.scene, source: intent.source, targets: intent.targets, point: intent.point, label: intent.skill }
          if (numbers.length) ev.numbers = numbers
          events.push([ev])
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
        // Revealing a cell the brush had hidden again takes it off the hidden list too.
        const hidden = f.hidden?.filter((c) => !intent.cells.includes(c))
        const hiddenChanged = !!f.hidden && hidden!.length !== f.hidden.length
        if (set.size !== f.revealed.length || hiddenChanged) {
          const next: FogState = { ...f, scene: intent.scene, revealed: [...set] }
          if (hidden?.length) next.hidden = hidden
          else delete next.hidden
          fog.set(intent.scene, next)
        }
        break
      }
      case 'fog.hide': {
        const f = fog.get(intent.scene)
        if (!f) return
        const drop = new Set(intent.cells)
        const revealed = f.revealed.filter((c) => !drop.has(c))
        const next: FogState = { ...f, revealed }
        // A fully revealed map keeps its flag; the painted cells are listed as exceptions.
        if (f.revealAll) next.hidden = [...new Set([...(f.hidden ?? []), ...intent.cells])]
        if (revealed.length !== f.revealed.length || (next.hidden?.length ?? 0) !== (f.hidden?.length ?? 0)) fog.set(intent.scene, next)
        break
      }
      case 'fog.reset':
        fog.set(intent.scene, { scene: intent.scene, revealed: [] })
        break
      case 'fog.revealAll': {
        const f = fog.get(intent.scene) ?? { scene: intent.scene, revealed: [] }
        if (!f.revealAll || f.hidden) {
          const next: FogState = { ...f, revealAll: true }
          delete next.hidden
          fog.set(intent.scene, next)
        }
        break
      }
      case 'wall.add':
        for (const w of intent.walls) walls.set(w.id, w)
        break
      case 'wall.update': {
        const w = walls.get(intent.wall)
        if (!w) return
        walls.set(intent.wall, merge(w, { ...intent.patch, id: w.id }))
        break
      }
      case 'wall.remove':
        for (const id of intent.walls) walls.delete(id)
        break
      case 'door.set': {
        const w = walls.get(intent.wall)
        if (!w?.door || w.door.open === intent.open) return
        walls.set(intent.wall, { ...w, door: { ...w.door, open: intent.open } })
        break
      }
      case 'light.add':
        lights.set(intent.light.id, intent.light)
        break
      case 'light.update': {
        const l = lights.get(intent.light)
        if (!l) return
        lights.set(intent.light, merge(l, { ...intent.patch, id: l.id }))
        break
      }
      case 'light.remove':
        lights.delete(intent.light)
        break
      case 'prefab.upsert':
        prefabs.set(intent.prefab.id, intent.prefab)
        break
      case 'prefab.remove':
        prefabs.delete(intent.prefab)
        break
      case 'initiative.start':
        writeInitiative(initiative, { active: true, round: 1, turn: 0, order: sortInitiative(intent.order) })
        break
      case 'initiative.set': {
        const init = readInitiative(initiative)
        if (!init.active) return
        writeInitiative(initiative, withOrder(init, intent.order))
        break
      }
      case 'initiative.next': {
        const init = readInitiative(initiative)
        if (!init.active) return
        if (intent.token && init.order[init.turn]?.token !== intent.token) return
        writeInitiative(initiative, nextTurn(init))
        break
      }
      case 'initiative.remove': {
        const init = readInitiative(initiative)
        if (!init.active) return
        writeInitiative(initiative, withoutToken(init, intent.token))
        break
      }
      case 'initiative.end':
        writeInitiative(initiative, EMPTY_INITIATIVE)
        break
    }
  }, from)
}

/**
 * Applies a validated intent to the Yjs document. Runs only on the GM client
 * (and optimistically on the sender). Pure with respect to everything but `doc`.
 */
import * as Y from 'yjs'
import type { ChatMessage, CombatLogEntry, ConditionEffect, DamageCard, DeclaredAction, FogState, GameEvent, InitiativeEntry, InitiativeState, Note, PlacedLight, Prefab, Prop, ResourceDelta, RollResult, Scene, Token, Wall } from '@/core/doc'
import type { TokenId } from '@/core/ids'
import type { SkillDef } from '@/core/pack'
import type { VfxCue } from '@/core/pack'
import type { IntentEnvelope } from '@/core/intents'
import { combatEntries, EMPTY_INITIATIVE, inCurrentSlot, nextTurn, sheetDeltas, slotRange, sortInitiative, withOrder, withoutToken } from './initiative'
import { DEFAULT_NAMES, endConcentration, pruneEffects, setEffect, startConcentration, tickEffects, updateMessage, type EffectsDoc, type PackNames } from './effects'

export interface ApplyContext {
  /** Resolved roll for 'roll' intents (the GM computes it from the seed). */
  roll?: RollResult
  /** Character patches + messages produced by the rules engine for 'skill.use'. */
  skill?: {
    patches: { character: string; data: Record<string, unknown> }[]
    messages: string[]
    vfx?: VfxCue[]
    /** Characters critically hit (bigger crit numbers on the table). */
    crits?: string[]
    /** Apply-damage card for what the skill dealt or healed, already applied (see `DamageCard`). */
    card?: { text: string; card: DamageCard }
    /** Conditions the skill added, with their durations, by token. */
    effects?: { token: TokenId; condition: string; effect: ConditionEffect }[]
    /** A concentration skill: the caster's previous concentration ends, this one starts. */
    concentration?: { skill: string; name: string }
    /** Concentrating tokens that took damage: a save prompt each. */
    checks?: { token: TokenId; dc: number }[]
    /** Concentrating tokens dropped to 0: their concentration ends. */
    drops?: TokenId[]
  }
  /** 'damage.apply': the sheet change, the card's new state and its follow-ups, resolved by the GM. */
  damage?: {
    card: DamageCard
    patch?: { character: string; data: Record<string, unknown> }
    notices: string[]
    numbers: ResourceDelta[]
    check?: { token: TokenId; dc: number }
    drop?: boolean
  }
  /** 'concentration.save': the resolved save; a failure ends the concentration. */
  concentration?: { roll: RollResult; label: string; kept: boolean }
  /** Pack names for duration and concentration notices. */
  pack?: PackNames
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
 * tokens that show it (the skill's source and targets first). Zero deltas are dropped. A loss on
 * a character in `crits` is marked `crit`; a resource that drops from above zero to zero or less
 * is marked `down` (the table draws both larger).
 */
export function skillNumbers(
  patches: { character: string; data: Record<string, unknown> }[],
  before: (character: string) => Record<string, unknown> | undefined,
  tokensOf: (character: string) => TokenId[],
  crits: readonly string[] = [],
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
      const crit = b < a && crits.includes(p.character)
      const down = a > 0 && b <= 0
      for (const token of tokens) out.push({ token, delta: b - a, resource: key, ...(crit ? { crit } : {}), ...(down ? { down } : {}) })
    }
  }
  return out
}

// ----------------------------------------------------------------- initiative

export { EMPTY_INITIATIVE, nextTurn, sortInitiative, withOrder, withoutToken } from './initiative'

function readInitiative(map: Y.Map<unknown>): InitiativeState {
  const order = map.get('order')
  if (!Array.isArray(order)) return EMPTY_INITIATIVE
  const s: InitiativeState = {
    active: map.get('active') === true,
    round: typeof map.get('round') === 'number' ? (map.get('round') as number) : 0,
    turn: typeof map.get('turn') === 'number' ? (map.get('turn') as number) : 0,
    order: order as InitiativeEntry[],
  }
  const declared = map.get('declared')
  if (declared && typeof declared === 'object') s.declared = declared as Record<string, DeclaredAction>
  const log = map.get('log')
  if (Array.isArray(log)) s.log = log as CombatLogEntry[]
  return s
}

function writeInitiative(map: Y.Map<unknown>, s: InitiativeState): void {
  map.set('active', s.active)
  map.set('round', s.round)
  map.set('turn', s.turn)
  map.set('order', s.order)
  if (s.declared && Object.keys(s.declared).length) map.set('declared', s.declared)
  else if (map.has('declared')) map.delete('declared')
  if (s.log?.length) map.set('log', s.log)
  else if (map.has('log')) map.delete('log')
}

/** `s` with `entries` appended to the combat log. */
function logged(s: InitiativeState, entries: CombatLogEntry[]): InitiativeState {
  return entries.length ? { ...s, log: [...(s.log ?? []), ...entries] } : s
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
  const fx: EffectsDoc = { tokens, characters, chat }
  const names = ctx.pack ?? DEFAULT_NAMES
  const prompt = (token: TokenId, dc: number) => {
    const name = tokens.get(token)?.name ?? 'Someone'
    chat.push([{ id: crypto.randomUUID(), author: from, at, kind: 'system', text: `${name} must make a concentration save (DC ${dc}).`, concentration: { token, dc } }])
  }
  const floatNumbers = (scene: Scene['id'] | undefined, numbers: ResourceDelta[]) => {
    if (!scene || !numbers.length) return
    events.push([{ id: crypto.randomUUID(), at, kind: 'vfx', cues: [], scene, targets: [...new Set(numbers.map((n) => n.token))], numbers }])
  }

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
      case 'character.upsert': {
        // A resource changed by hand mid-fight (the GM's HP buttons) still counts for the summary.
        const prev = characters.get(intent.character.id)?.data as Record<string, unknown> | undefined
        const init = readInitiative(initiative)
        if (prev && init.active) {
          const entries: CombatLogEntry[] = []
          tokens.forEach((t) => {
            if (t.character !== intent.character.id) return
            const numbers = sheetDeltas(prev, intent.character.data, t.id)
            entries.push(...combatEntries(init, numbers, (_, key) => resourceValue(prev[key])))
          })
          if (entries.length) writeInitiative(initiative, logged(init, entries))
        }
        characters.set(intent.character.id, intent.character as unknown as Record<string, unknown>)
        break
      }
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
            ...(intent.character ? { character: intent.character } : {}),
            ...(intent.visibility && intent.visibility !== 'public' ? { visibility: intent.visibility } : {}),
          },
        ])
        break
      case 'roll.reveal':
        updateMessage(chat, intent.message, (m) => {
          const next = { ...m }
          delete next.visibility
          return next
        })
        break
      case 'damage.apply': {
        const r = ctx.damage
        if (!r) return
        if (r.patch) {
          const c = characters.get(r.patch.character)
          if (c) {
            const prev = c.data as Record<string, unknown>
            const data = { ...prev, ...r.patch.data }
            // Damage applied from a card counts for the encounter summary too.
            const init = readInitiative(initiative)
            if (init.active) {
              const entries = combatEntries(init, sheetDeltas(prev, data, intent.token), (_, key) => resourceValue(prev[key]))
              if (entries.length) writeInitiative(initiative, logged(init, entries))
            }
            characters.set(r.patch.character, { ...c, data })
          }
        }
        updateMessage(chat, intent.message, (m) => ({ ...m, damage: r.card }))
        for (const text of r.notices) chat.push([{ id: crypto.randomUUID(), author: from, at, kind: 'system', text }])
        floatNumbers(tokens.get(intent.token)?.scene, r.numbers)
        if (r.drop) endConcentration(fx, intent.token, names, 'dropped to 0', at, from)
        else if (r.check) prompt(r.check.token, r.check.dc)
        break
      }
      case 'concentration.save': {
        const r = ctx.concentration
        if (!r) return
        chat.push([{ id: env.id, author: from, at, kind: 'roll', text: r.label, roll: r.roll }])
        updateMessage(chat, intent.message, (m) => (m.concentration ? { ...m, concentration: { ...m.concentration, result: r.kept ? 'kept' : 'lost' } } : m))
        if (!r.kept) endConcentration(fx, intent.token, names, 'failed the save', at, from)
        break
      }
      case 'concentration.end':
        endConcentration(fx, intent.token, names, 'ended', at, from)
        break
      case 'concentration.dismiss':
        updateMessage(chat, intent.message, (m) => (m.concentration ? { ...m, concentration: { ...m.concentration, result: 'dismissed' } } : m))
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
          ctx.skill?.crits,
        )
        // Mid-fight: log who hurt or healed whom (values read before the patches land).
        const init = readInitiative(initiative)
        const entries = combatEntries(init, numbers, (token, key) => {
          const c = tokens.get(token)?.character
          const data = c ? (characters.get(c)?.data as Record<string, unknown> | undefined) : undefined
          return data ? resourceValue(data[key]) : undefined
        }, intent.source)
        // A new concentration skill: remember what the caster held before this cast.
        const conc = ctx.skill?.concentration
        for (const p of ctx.skill?.patches ?? []) {
          const c = characters.get(p.character)
          if (c) characters.set(p.character, { ...c, data: { ...(c.data as object), ...p.data } })
        }
        for (const text of ctx.skill?.messages ?? []) {
          chat.push([{ id: crypto.randomUUID(), author: from, at, kind: 'system', text, channel: 'combat' }])
        }
        // The caster's declared action is now done.
        if (init.active) {
          let next = logged(init, entries)
          if (next.declared?.[intent.source]) {
            const { [intent.source]: _done, ...rest } = next.declared
            next = { ...next, declared: rest }
          }
          if (next !== init) writeInitiative(initiative, next)
        }
        for (const e of ctx.skill?.effects ?? []) setEffect(fx, e.token, e.condition, conc ? { ...e.effect, concentration: intent.source } : e.effect)
        if (conc) {
          const keep = new Set((ctx.skill?.effects ?? []).map((e) => `${e.token}:${e.condition}`))
          endConcentration(fx, intent.source, names, `now ${conc.name}`, at, from, keep)
          startConcentration(fx, intent.source, conc, names)
        }
        for (const id of new Set([intent.source, ...intent.targets])) pruneEffects(fx, id)
        if (ctx.skill?.card) chat.push([{ id: crypto.randomUUID(), author: from, at, kind: 'system', text: ctx.skill.card.text, damage: ctx.skill.card.card }])
        for (const id of ctx.skill?.drops ?? []) endConcentration(fx, id, names, 'dropped to 0', at, from)
        for (const c of ctx.skill?.checks ?? []) if (!ctx.skill?.drops?.includes(c.token)) prompt(c.token, c.dc)
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
      case 'audio.stop':
        events.push([intent.asset ? { id: env.id, at, kind: 'audio-stop', asset: intent.asset, by: from } : { id: env.id, at, kind: 'audio-stop', by: from }])
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
      case 'initiative.start': {
        const order = sortInitiative(intent.order)
        writeInitiative(initiative, { active: true, round: 1, turn: 0, order })
        if (order.length) { const [a, b] = slotRange(order, 0); for (let i = a; i <= b; i++) tickEffects(fx, order[i]!.token, 'start', names, at, from) }
        break
      }
      case 'initiative.set': {
        const init = readInitiative(initiative)
        if (!init.active) return
        writeInitiative(initiative, withOrder(init, intent.order))
        break
      }
      case 'initiative.next': {
        const init = readInitiative(initiative)
        if (!init.active) return
        if (intent.token && !inCurrentSlot(init, intent.token)) return
        const next = nextTurn(init)
        writeInitiative(initiative, next)
        // Durations count down as the turn passes: the end of this slot, then the start of the next.
        if (init.order.length) { const [a, b] = slotRange(init.order, init.turn); for (let i = a; i <= b; i++) tickEffects(fx, init.order[i]!.token, 'end', names, at, from) }
        if (next.order.length) { const [a, b] = slotRange(next.order, next.turn); for (let i = a; i <= b; i++) tickEffects(fx, next.order[i]!.token, 'start', names, at, from) }
        break
      }
      case 'initiative.remove': {
        const init = readInitiative(initiative)
        if (!init.active) return
        writeInitiative(initiative, withoutToken(init, intent.token))
        break
      }
      case 'initiative.end':
        if (intent.summary && readInitiative(initiative).active) {
          const rounds = intent.summary.rounds
          chat.push([{ id: env.id, author: from, at, kind: 'system', channel: 'combat', text: `Encounter over after ${rounds} ${rounds === 1 ? 'round' : 'rounds'}.`, summary: intent.summary }])
        }
        writeInitiative(initiative, EMPTY_INITIATIVE)
        break
      case 'initiative.declare': {
        const init = readInitiative(initiative)
        if (!init.active || !init.order.some((e) => e.token === intent.action.token)) return
        const action: DeclaredAction = { ...intent.action, at }
        if (action.skill === undefined) delete action.skill
        if (action.icon === undefined) delete action.icon
        writeInitiative(initiative, { ...init, declared: { ...init.declared, [action.token]: action } })
        break
      }
      case 'initiative.resolve': {
        const init = readInitiative(initiative)
        if (!init.declared?.[intent.token]) return
        const { [intent.token]: _done, ...rest } = init.declared
        writeInitiative(initiative, { ...init, declared: rest })
        break
      }
    }
  }, from)
}

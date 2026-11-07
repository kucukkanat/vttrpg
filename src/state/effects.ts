/**
 * Condition durations, concentration and chat cards on the Yjs document: the parts of `apply`
 * that walk several tokens at once. GM-side like the rest of `apply`; pure apart from `doc`.
 *
 * A token's conditions live in two lists (the token's own `conditions`, set by the GM, and its
 * sheet's `data.conditions`, written by skills); `Token.effects` holds the duration or
 * concentration link for either, keyed by condition id.
 */
import type * as Y from 'yjs'
import type { ChatMessage, ConditionEffect, Token } from '@/core/doc'
import type { PlayerPubkey, TokenId } from '@/core/ids'

export interface EffectsDoc {
  tokens: Y.Map<Token>
  characters: Y.Map<Record<string, unknown>>
  chat: Y.Array<ChatMessage>
}

/** Names for notices, from the pack (the GM passes them in `ApplyContext.pack`). */
export interface PackNames {
  conditionName(id: string): string
  /** Condition id a concentrating caster shows (`PackManifest.concentration.condition`). */
  concentration?: string
}

const plainName = (id: string) => id.replace(/[-_]+/g, ' ')
export const DEFAULT_NAMES: PackNames = { conditionName: plainName }

function system(d: EffectsDoc, text: string, at: number, author: PlayerPubkey): void {
  d.chat.push([{ id: crypto.randomUUID(), author, at, kind: 'system', text }])
}

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** True when the token or its sheet lists the condition. */
export function hasCondition(d: EffectsDoc, t: Token, id: string): boolean {
  if (t.conditions.includes(id)) return true
  const c = t.character ? d.characters.get(t.character) : undefined
  return !!c && listOf((c.data as Record<string, unknown> | undefined)?.conditions).includes(id)
}

/** Drop a condition from a token, its sheet and its effects. Returns whether anything was there. */
export function removeCondition(d: EffectsDoc, token: TokenId, id: string): boolean {
  const t = d.tokens.get(token)
  if (!t) return false
  let found = false
  const next: Token = { ...t }
  if (t.conditions.includes(id)) { next.conditions = t.conditions.filter((x) => x !== id); found = true }
  if (t.effects && id in t.effects) {
    const effects = { ...t.effects }
    delete effects[id]
    if (Object.keys(effects).length) next.effects = effects
    else delete next.effects
  }
  d.tokens.set(token, next)
  const c = t.character ? d.characters.get(t.character) : undefined
  if (c) {
    const data = (c.data ?? {}) as Record<string, unknown>
    const list = listOf(data.conditions)
    if (list.includes(id)) {
      d.characters.set(t.character!, { ...c, data: { ...data, conditions: list.filter((x) => x !== id) } })
      found = true
    }
  }
  return found
}

/** Set (or replace) the effect entry for a condition on a token. */
export function setEffect(d: EffectsDoc, token: TokenId, id: string, effect: ConditionEffect): void {
  const t = d.tokens.get(token)
  if (!t) return
  d.tokens.set(token, { ...t, effects: { ...(t.effects ?? {}), [id]: effect } })
}

/**
 * One turn boundary: every effect counting on `who`'s turn at this `phase` loses a turn; at zero
 * the condition ends with a notice. Effects without `remaining` never tick.
 */
export function tickEffects(d: EffectsDoc, who: TokenId, phase: 'start' | 'end', names: PackNames, at: number, author: PlayerPubkey): void {
  const ids: TokenId[] = []
  d.tokens.forEach((_t, id) => ids.push(id as TokenId))
  for (const id of ids) {
    const t = d.tokens.get(id)
    if (!t?.effects) continue
    const effects = { ...t.effects }
    const expired: string[] = []
    let changed = false
    for (const [cond, e] of Object.entries(t.effects)) {
      if (e.remaining === undefined || (e.tick ?? 'end') !== phase || (e.on ?? t.id) !== who) continue
      const remaining = e.remaining - 1
      changed = true
      if (remaining <= 0) expired.push(cond)
      else effects[cond] = { ...e, remaining }
    }
    if (!changed) continue
    d.tokens.set(id, { ...t, effects })
    for (const cond of expired) {
      removeCondition(d, id, cond)
      system(d, `${t.name} is no longer ${names.conditionName(cond)} (duration ended).`, at, author)
    }
  }
}

/**
 * End `caster`'s concentration: every condition held by it ends, the caster's concentration
 * condition goes, and one notice names the skill. `keep` lists `token:condition` pairs that a
 * new cast just re-applied and must survive. No-op when the caster holds nothing.
 */
export function endConcentration(
  d: EffectsDoc,
  caster: TokenId,
  names: PackNames,
  reason: string,
  at: number,
  author: PlayerPubkey,
  keep: ReadonlySet<string> = new Set(),
): void {
  const src = d.tokens.get(caster)
  const held: [TokenId, string][] = []
  d.tokens.forEach((t, id) => {
    for (const [cond, e] of Object.entries(t.effects ?? {})) if (e.concentration === caster) held.push([id as TokenId, cond])
  })
  if (!src?.concentrating && !held.length) return
  for (const [id, cond] of held) if (!keep.has(`${id}:${cond}`)) removeCondition(d, id, cond)
  const after = d.tokens.get(caster)
  if (after?.concentrating) {
    const next: Token = { ...after }
    delete next.concentrating
    d.tokens.set(caster, next)
    if (names.concentration) removeCondition(d, caster, names.concentration)
    system(d, `${after.name} is no longer concentrating on ${after.concentrating.name} (${reason}).`, at, author)
  }
}

/** Mark `caster` as concentrating on a skill and show the pack's concentration condition. */
export function startConcentration(d: EffectsDoc, caster: TokenId, skill: { skill: string; name: string }, names: PackNames): void {
  const t = d.tokens.get(caster)
  if (!t) return
  const conditions = names.concentration && !t.conditions.includes(names.concentration) ? [...t.conditions, names.concentration] : t.conditions
  d.tokens.set(caster, { ...t, conditions, concentrating: skill })
}

/** Effects whose condition is gone from both lists are dropped (a skill or the GM removed it). */
export function pruneEffects(d: EffectsDoc, token: TokenId): void {
  const t = d.tokens.get(token)
  if (!t?.effects) return
  const effects = Object.fromEntries(Object.entries(t.effects).filter(([cond]) => hasCondition(d, t, cond)))
  if (Object.keys(effects).length === Object.keys(t.effects).length) return
  const next: Token = { ...t, effects }
  if (!Object.keys(effects).length) delete next.effects
  d.tokens.set(token, next)
}

/** Replace chat message `id` with `fn(message)`; false when it is not there. */
export function updateMessage(chat: Y.Array<ChatMessage>, id: string, fn: (m: ChatMessage) => ChatMessage): boolean {
  const all = chat.toArray()
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].id !== id) continue
    chat.delete(i, 1)
    chat.insert(i, [fn(all[i])])
    return true
  }
  return false
}

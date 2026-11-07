/**
 * GM-side resolution for the combat intents the controller hands to `applyIntent`: skill cards,
 * durations and concentration links, apply-damage choices and concentration saves. Reads the
 * document mirror and the rules engine; returns the `ApplyContext` pieces. No side effects.
 */
import type { Character, ChatMessage, ConditionEffect, DamageCard, DamageTarget, ResourceDelta, RollAdvantage, RollResult, Token } from '@/core/doc'
import type { Intent } from '@/core/intents'
import type { TokenId } from '@/core/ids'
import { applyDamageChoice, changedKeys, resourceRef, type RulesEngine, type SkillCondition, type SkillDamage } from '@/rules'
import type { ApplyContext } from '@/state/apply'
import type { PackNames } from '@/state/effects'

export interface DocView {
  tokens: Record<string, Token>
  characters: Record<string, Character>
  chat: readonly ChatMessage[]
}

export function packNames(rules: RulesEngine | null): PackNames {
  const conditions = rules?.pack.conditions ?? []
  return {
    conditionName: (id) => conditions.find((c) => c.id === id)?.name ?? id.replace(/[-_]+/g, ' '),
    concentration: rules?.pack.manifest.concentration?.condition,
  }
}

/** Concentration save DC after `damage` from the pack's rule (5e: half the damage, at least 10). */
export function concentrationDc(rules: RulesEngine, character: Character, damage: number): number | undefined {
  const rule = rules.pack.manifest.concentration
  if (!rule) return undefined
  try {
    const v = rules.evaluateNow(rule.dc, character, { damage })
    return typeof v === 'number' ? v : undefined
  } catch {
    return undefined
  }
}

const damageResource = (rules: RulesEngine | null) => rules?.pack.manifest.damage?.resource ?? rules?.pack.resources[0]?.id ?? 'hp'

const sheetOf = (doc: DocView, token: Token | undefined): Character | undefined => (token?.character ? doc.characters[token.character] : undefined)

/** Current value of the damage resource on a sheet after `patch`. */
function hpAfter(rules: RulesEngine | null, data: Record<string, unknown>): number | undefined {
  return resourceRef(data, damageResource(rules)).current
}

/**
 * Card, durations and concentration for a resolved skill. `targets` are the token ids in the
 * order the engine saw them; `damage` / `conditions` index into it (-1 = the caster).
 */
export function skillExtras(
  rules: RulesEngine,
  doc: DocView,
  intent: Extract<Intent, { type: 'skill.use' }>,
  targets: TokenId[],
  result: { patches: { character: string; data: Record<string, unknown> }[]; damage?: SkillDamage[]; conditions?: SkillCondition[] },
): Omit<NonNullable<ApplyContext['skill']>, 'patches' | 'messages' | 'vfx'> {
  const skill = rules.allSkills().find((s) => s.id === intent.skill)
  const out: Omit<NonNullable<ApplyContext['skill']>, 'patches' | 'messages' | 'vfx'> = {}
  const tokenAt = (i: number) => (i < 0 ? intent.source : targets[i])

  // Durations. `on: source` counts the caster's turns ("until the end of your next turn").
  const effects: { token: TokenId; condition: string; effect: ConditionEffect }[] = []
  for (const c of result.conditions ?? []) {
    const token = tokenAt(c.target)
    if (!token) continue
    const effect: ConditionEffect = {}
    if (c.duration) {
      effect.remaining = c.duration.turns
      if (c.duration.tick) effect.tick = c.duration.tick
      if (c.duration.on === 'source' && token !== intent.source) effect.on = intent.source
    }
    if (c.duration || skill?.concentration) effects.push({ token, condition: c.condition, effect })
  }
  if (effects.length) out.effects = effects
  if (skill?.concentration && rules.pack.manifest.concentration) out.concentration = { skill: skill.id, name: skill.name }

  // The card: damage rows first; a pure heal skill gets a heal card.
  const entries = result.damage ?? []
  const hurt = entries.filter((d) => !d.heal)
  const shown = hurt.length ? hurt : entries.filter((d) => !d.temp)
  const byToken = new Map<TokenId, DamageTarget>()
  for (const d of shown) {
    const token = tokenAt(d.target)
    if (!token) continue
    const prev = byToken.get(token)
    const changes = [...(prev?.applied?.changes ?? []), ...d.changes]
    const amount = (prev?.amount ?? 0) + d.amount
    const final = (prev?.applied?.amount ?? 0) + d.final
    const t: DamageTarget = { token, amount, applied: { factor: d.heal ? -1 : 1, amount: final, changes } }
    if (d.note) t.applied!.note = d.note
    byToken.set(token, t)
  }
  if (byToken.size) {
    const list = [...byToken.values()]
    const type = shown.find((d) => d.type)?.type
    const heal = !hurt.length
    const card: DamageCard = { amount: list[0].amount ?? 0, targets: list }
    if (type) card.type = type
    if (heal) card.heal = true
    out.card = { text: `${skill?.name ?? intent.skill}: ${heal ? 'healing' : 'damage'}`, card }
  }

  // Concentrating targets that took damage save; at 0 they drop concentration.
  const checks: { token: TokenId; dc: number }[] = []
  const drops: TokenId[] = []
  for (const t of byToken.values()) {
    if (!t.applied || t.applied.factor === -1 || t.applied.amount <= 0) continue
    const tok = doc.tokens[t.token]
    if (!tok?.concentrating) continue
    const sheet = sheetOf(doc, tok)
    const patched = result.patches.find((p) => p.character === sheet?.id)
    const data = sheet ? { ...sheet.data, ...(patched?.data ?? {}) } : undefined
    if (data && hpAfter(rules, data) === 0) { drops.push(t.token); continue }
    const dc = sheet ? concentrationDc(rules, sheet, t.applied.amount) : undefined
    if (dc !== undefined) checks.push({ token: t.token, dc })
  }
  if (checks.length) out.checks = checks
  if (drops.length) out.drops = drops
  return out
}

/** Resolve an apply-damage click into the sheet change and the card's new state. */
export function damageContext(rules: RulesEngine | null, doc: DocView, intent: Extract<Intent, { type: 'damage.apply' }>): ApplyContext['damage'] {
  const message = doc.chat.find((m) => m.id === intent.message)
  const token = doc.tokens[intent.token]
  if (!message || !token) return undefined
  const base: DamageCard = message.damage ?? { amount: message.roll?.total ?? 0, targets: [] }
  const card: DamageCard = { ...base, targets: [...base.targets] }
  if (intent.damageType !== undefined && !message.damage) {
    if (intent.damageType) card.type = intent.damageType
    else delete card.type
  }
  const idx = card.targets.findIndex((t) => t.token === intent.token)
  const prev: DamageTarget = idx >= 0 ? card.targets[idx] : { token: intent.token }
  const amount = prev.amount ?? card.amount
  const factor = intent.factor === 0 ? 0 : card.heal && intent.factor === 1 ? -1 : intent.factor
  const sheet = sheetOf(doc, token)
  const model = rules?.pack.manifest.damage
  const notices: string[] = []
  const numbers: ResourceDelta[] = []
  let patch: { character: string; data: Record<string, unknown> } | undefined
  let applied: DamageTarget['applied']
  if (sheet) {
    const r = applyDamageChoice(sheet.data, {
      amount,
      factor,
      type: card.type,
      previous: prev.applied,
      model,
      resource: damageResource(rules),
      conditions: rules?.pack.conditions ?? [],
      tokenConditions: token.conditions,
    })
    applied = r.applied
    const data = changedKeys(sheet.data, r.data)
    if (Object.keys(data).length) patch = { character: sheet.id, data }
    // Net change against the sheet as it was, for one floating number per resource.
    const net = new Map<string, number>()
    for (const c of prev.applied?.changes ?? []) net.set(c.key, (net.get(c.key) ?? 0) - c.delta)
    for (const c of applied?.changes ?? []) net.set(c.key, (net.get(c.key) ?? 0) + c.delta)
    for (const [resource, delta] of net) if (delta) numbers.push({ token: intent.token, delta, resource })
  } else if (factor !== 0) {
    applied = { factor, amount: factor === -1 ? amount : Math.floor(amount * factor), changes: [] }
  }
  notices.push(noticeFor(token.name, applied, card.type, !!prev.applied, !sheet))
  const target: DamageTarget = { token: intent.token }
  if (prev.amount !== undefined) target.amount = prev.amount
  if (applied) target.applied = applied
  if (idx >= 0) card.targets[idx] = target
  else card.targets.push(target)

  const out: NonNullable<ApplyContext['damage']> = { card, notices, numbers }
  if (patch) out.patch = patch
  if (token.concentrating && applied && applied.factor !== -1 && applied.amount > 0 && sheet && rules) {
    const after = { ...sheet.data, ...(patch?.data ?? {}) }
    if (hpAfter(rules, after) === 0) out.drop = true
    else {
      const dc = concentrationDc(rules, sheet, applied.amount)
      if (dc !== undefined) out.check = { token: intent.token, dc }
    }
  }
  return out
}

function noticeFor(name: string, applied: DamageTarget['applied'], type: string | undefined, redo: boolean, sheetless: boolean): string {
  const tail = sheetless ? ' (no sheet tracked)' : ''
  if (!applied) return `${name}: damage undone.`
  if (applied.factor === -1) return `${name} recovers up to ${applied.amount}${tail}.`
  const scale = applied.factor === 0.5 ? ' (half)' : applied.factor === 2 ? ' (double)' : ''
  const note = applied.note ? `, ${applied.note}` : ''
  return `${name} ${redo ? 'now takes' : 'takes'} ${applied.amount}${type ? ` ${type}` : ''} damage${scale}${note}${tail}.`
}

/** Roll a concentration save from a prompt; null without a rule or a prompt. */
export async function concentrationContext(
  rules: RulesEngine,
  doc: DocView,
  intent: Extract<Intent, { type: 'concentration.save' }>,
): Promise<ApplyContext['concentration']> {
  const rule = rules.pack.manifest.concentration
  const message = doc.chat.find((m) => m.id === intent.message)
  const token = doc.tokens[intent.token]
  if (!rule || !message?.concentration || message.concentration.result || !token) return undefined
  const character = sheetOf(doc, token) ?? rules.blankCharacter(token.id, token.name)
  const roll: RollResult = await rules.roll(rule.save, intent.seed, { character, dc: message.concentration.dc, advantage: intent.advantage satisfies RollAdvantage | undefined })
  const kept = roll.outcome?.success === true
  return { roll, kept, label: `${token.name} · Concentration save (DC ${message.concentration.dc})` }
}

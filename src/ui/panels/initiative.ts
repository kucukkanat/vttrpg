/**
 * Pure helpers behind the Initiative panel and its HUD chip: which sheet formula a pack uses for
 * initiative, rolling the opening order for a scene, and the words on the chip. Nothing here
 * touches the document; the panel dispatches the result as `initiative.*` intents.
 */
import type { Character, ChatMessage, EncounterSummary, EncounterSummaryRow, InitiativeEntry, InitiativeState, Token } from '@/core/doc'
import type { CharacterId, PlayerPubkey, TokenId } from '@/core/ids'
import type { SheetField } from '@/core/pack'
import type { LoadedPack, RulesEngine } from '@/rules'
import { rollFromSeed } from '@/dice/fair'
import { currentSlot, slotRange, sortInitiative } from '@/state/initiative'

/** The dice everyone rolls when the pack declares no initiative of its own. */
export const DEFAULT_INITIATIVE_FORMULA = 'd20'

function* fields(list: SheetField[]): Generator<SheetField> {
  for (const f of list) {
    yield f
    if (f.kind === 'list') yield* fields(f.item)
  }
}

/**
 * The formula a pack rolls for initiative: a sheet roll field labelled "Initiative" (D&D 5e has
 * `d20 + initiative`), else `d20 + <attribute>` for an attribute with id `initiative`, else null
 * when the pack leaves it to the table (Mausritter).
 */
export function initiativeFormula(pack: LoadedPack | null | undefined): string | null {
  if (!pack) return null
  for (const section of pack.sheet.sections) {
    for (const f of fields(section.fields)) {
      if (f.kind === 'roll' && /\binitiative\b/i.test(f.label)) return f.formula
    }
  }
  if (pack.attributes.some((a) => a.id === 'initiative')) return 'd20 + initiative'
  return null
}

/** The seed one combatant's roll is derived from; distinct per token, reproducible from the intent's seed. */
export const seedFor = (seed: string, token: TokenId): string => `${seed}:${token}`

/**
 * Combatants for a new encounter: the visible tokens of `scene` that have a sheet, in token order.
 * Hidden tokens stay out so their names are not shown to players; the GM can add them by hand.
 */
export function combatants(tokens: Record<TokenId, Token>, scene: string | null): Token[] {
  if (!scene) return []
  return Object.values(tokens).filter((t) => t.scene === scene && !!t.character && !t.hidden)
}

/** "Goblin 3" -> "Goblin", "Goblin #12" -> "Goblin": the name copies of one creature share. */
export function nameStem(name: string): string {
  return name.trim().replace(/\s*#?\d+$/, '').trim() || name.trim()
}

/**
 * The group a token joins under group initiative: copies of one unowned creature (same name stem)
 * roll once and act together. Player tokens (owned) always act alone; null means no group.
 */
export function groupKey(token: Pick<Token, 'name' | 'owner'>): string | null {
  if (token.owner) return null
  const stem = nameStem(token.name).toLowerCase()
  return stem ? `npc:${stem}` : null
}

/** One roll for a token: the pack formula against its sheet, else the default die; 0 when nothing rolls. */
async function rollOne(t: Token, characters: Record<CharacterId, Character>, rules: RulesEngine | null, formula: string | null, seed: string): Promise<number> {
  const s = seedFor(seed, t.id)
  const character = t.character ? characters[t.character] : undefined
  try {
    if (formula && rules && character) return (await rules.roll(formula, s, { character })).total
    return (await rollFromSeed(DEFAULT_INITIATIVE_FORMULA, s)).total
  } catch {
    try {
      return (await rollFromSeed(DEFAULT_INITIATIVE_FORMULA, s)).total
    } catch {
      return 0
    }
  }
}

/**
 * Roll a score per token. With a pack formula the roll runs against each token's sheet through
 * the rules engine (so `initiative` and `dex_mod` resolve); without one, or for a token whose
 * sheet is missing, everyone rolls the default die. Scores that cannot be rolled fall back to 0.
 * With `group`, copies of one creature (see `groupKey`, two or more of them) roll once, on the
 * first copy's sheet, and share the result and a slot. `known` holds scores already rolled (from
 * a sheet) that are used instead of a fresh roll.
 */
export async function rollInitiative(
  tokens: Token[],
  characters: Record<CharacterId, Character>,
  rules: RulesEngine | null,
  seed: string,
  opts: { group?: boolean; known?: ReadonlyMap<TokenId, number> } = {},
): Promise<InitiativeEntry[]> {
  const formula = initiativeFormula(rules?.pack)
  const keys = new Map<TokenId, string>()
  if (opts.group) {
    const count = new Map<string, number>()
    for (const t of tokens) { const k = groupKey(t); if (k) count.set(k, (count.get(k) ?? 0) + 1) }
    for (const t of tokens) { const k = groupKey(t); if (k && count.get(k)! > 1) keys.set(t.id, k) }
  }
  const shared = new Map<string, number>()
  const out: InitiativeEntry[] = []
  for (const t of tokens) {
    const k = keys.get(t.id)
    let score: number
    if (k && shared.has(k)) score = shared.get(k)!
    else {
      score = opts.known?.get(t.id) ?? (await rollOne(t, characters, rules, formula, seed))
      if (k) shared.set(k, score)
    }
    out.push(k ? { token: t.id, score, group: k } : { token: t.id, score })
  }
  return out
}

/** Roll one combatant joining a running encounter, the same way Start rolls (pack formula on its sheet). */
export async function rollLateJoin(token: Token, characters: Record<CharacterId, Character>, rules: RulesEngine | null, seed: string): Promise<number> {
  return rollOne(token, characters, rules, initiativeFormula(rules?.pack), seed)
}

/**
 * `order` with a late joiner slotted in by score. When the order already has a group of its
 * kind (the fourth goblin arrives) it joins that group's slot and score instead.
 */
export function lateJoin(order: InitiativeEntry[], token: Token, score: number): InitiativeEntry[] {
  if (order.some((e) => e.token === token.id)) return order
  const k = groupKey(token)
  const mates = k ? order.filter((e) => e.group === k) : []
  if (k && mates.length) {
    const last = order.lastIndexOf(mates[mates.length - 1]!)
    const next = order.slice()
    next.splice(last + 1, 0, { token: token.id, score: mates[0]!.score, group: k })
    return next
  }
  return withScore([...order, { token: token.id, score }], token.id, score)
}

/**
 * The entry at `idx` joins the slot above it: same group, same score, placed at the end of that
 * slot. Unchanged when there is nothing above or it already shares that slot.
 */
export function joinAbove(order: InitiativeEntry[], idx: number): InitiativeEntry[] {
  if (idx <= 0 || idx >= order.length) return order
  const [aStart, aEnd] = slotRange(order, idx - 1)
  const lead = order[aStart]!
  const me = order[idx]!
  if (me.group !== undefined && me.group === lead.group) return order
  const group = lead.group ?? `g:${lead.token}`
  const rest = order.filter((_, i) => i !== idx).map((e, i) => (i >= aStart && i <= aEnd ? { ...e, group } : e))
  rest.splice(aEnd + 1, 0, { token: me.token, score: lead.score, group })
  return dropLoneGroups(rest)
}

/** `token` acts alone again, right after the slot it left. */
export function leaveGroup(order: InitiativeEntry[], token: TokenId): InitiativeEntry[] {
  const idx = order.findIndex((e) => e.token === token)
  if (idx < 0 || order[idx]!.group === undefined) return order
  const [, end] = slotRange(order, idx)
  const next = order.slice()
  next.splice(idx, 1)
  next.splice(end, 0, { token, score: order[idx]!.score })
  return dropLoneGroups(next)
}

/** A group left with one member is no group. */
function dropLoneGroups(order: InitiativeEntry[]): InitiativeEntry[] {
  const size = new Map<string, number>()
  for (const e of order) if (e.group !== undefined) size.set(e.group, (size.get(e.group) ?? 0) + 1)
  return order.map((e) => (e.group !== undefined && size.get(e.group)! < 2 ? { token: e.token, score: e.score } : e))
}

/** `order` with the entry at `from` moved to `to` (clamped); same array when nothing moves. */
export function moveEntry(order: InitiativeEntry[], from: number, to: number): InitiativeEntry[] {
  const target = Math.max(0, Math.min(order.length - 1, to))
  if (from < 0 || from >= order.length || target === from) return order
  const next = order.slice()
  const [e] = next.splice(from, 1)
  next.splice(target, 0, e)
  return next
}

/**
 * `order` with `token` scored `score` (its whole group with it); the list is re-sorted by score
 * the way `initiative.start` sorts it.
 */
export function withScore(order: InitiativeEntry[], token: TokenId, score: number): InitiativeEntry[] {
  const group = order.find((e) => e.token === token)?.group
  const next = order.map((e) => (e.token === token || (group !== undefined && e.group === group) ? { ...e, score } : e))
  return sortInitiative(next)
}

/** The combatant whose turn it is, or undefined between encounters. */
export function currentEntry(s: InitiativeState | null): InitiativeEntry | undefined {
  if (!s || !s.active) return undefined
  return s.order[s.turn]
}

/**
 * What the viewer may call a combatant: the token's name, or "Someone" for a hidden token when
 * the viewer is a player (the GM sees every name). A token that left the document reads "Gone".
 */
export function combatantName(token: Token | undefined, isGm: boolean): string {
  if (!token) return 'Gone'
  return token.hidden && !isGm ? 'Someone' : token.name
}

/** Possessive for the toast and chip: "Pip's turn", "Boss's turn", "Mice's turn". */
export function possessive(name: string): string {
  return `${name}'s`
}

/**
 * What the viewer calls a slot: the combatant's name, or for a group the shared name and its
 * size ("Goblin ×3"). Players do not count hidden members; a slot of only hidden ones is "Someone".
 */
export function slotName(slot: readonly InitiativeEntry[], tokens: Record<TokenId, Token>, isGm: boolean): string {
  if (slot.length <= 1) return combatantName(slot[0] ? tokens[slot[0].token] : undefined, isGm)
  const seen = slot.map((e) => tokens[e.token]).filter((t): t is Token => !!t && (isGm || !t.hidden))
  if (seen.length === 0) return 'Someone'
  if (seen.length === 1) return seen[0]!.name
  return `${nameStem(seen[0]!.name)} ×${seen.length}`
}

/** The chip text: "Round 2 · Pip's turn"; null while no encounter runs. */
export function turnLabel(s: InitiativeState | null, tokens: Record<TokenId, Token>, isGm: boolean): string | null {
  const slot = currentSlot(s)
  if (!s || !slot.length) return null
  return `Round ${s.round} · ${possessive(slotName(slot, tokens, isGm))} turn`
}

/** Whether `pubkey` should react to `token`'s turn: its owner and the GM do, nobody else. */
export function concernsViewer(token: Token | undefined, pubkey: PlayerPubkey | string, isGm: boolean): boolean {
  if (isGm) return true
  return !!token && token.owner === pubkey
}

// ------------------------------------------------------- initiative rolled from a sheet

/** A chat roll that is an initiative roll made from a sheet: its character and total. */
export function sheetInitiativeRoll(m: ChatMessage): { character: CharacterId; total: number } | null {
  if (m.kind !== 'roll' || !m.character || !m.roll) return null
  if (!/\binitiative\b/i.test(m.text)) return null
  return { character: m.character, total: m.roll.total }
}

/**
 * Initiative rolled from sheets shortly before an encounter starts (players rolling their own),
 * by token: the latest roll per character within `windowMs` of `now`, mapped to that sheet's
 * tokens in `scene`. Start uses these instead of rolling again.
 */
export function recentSheetInitiative(
  chat: readonly ChatMessage[],
  tokens: Record<TokenId, Token>,
  scene: string | null,
  now: number,
  windowMs = 3 * 60_000,
): Map<TokenId, number> {
  const byCharacter = new Map<string, number>()
  for (const m of chat) {
    if (now - m.at > windowMs || m.at > now) continue
    const r = sheetInitiativeRoll(m)
    if (r) byCharacter.set(r.character, r.total)
  }
  const out = new Map<TokenId, number>()
  if (!byCharacter.size) return out
  for (const t of Object.values(tokens)) {
    if (t.scene !== scene || !t.character) continue
    const v = byCharacter.get(t.character)
    if (v !== undefined) out.set(t.id, v)
  }
  return out
}

/**
 * The order after a sheet's initiative roll lands mid-fight: combatants showing that sheet take
 * the score (their group with them); when none of its tokens in `scene` is in the order yet, the
 * first one joins (late join). Null when nothing changes.
 */
export function withSheetInitiative(
  s: InitiativeState | null,
  tokens: Record<TokenId, Token>,
  scene: string | null,
  character: CharacterId,
  total: number,
): { order: InitiativeEntry[]; joined?: TokenId; updated: TokenId[] } | null {
  if (!s || !s.active) return null
  const own = Object.values(tokens).filter((t) => t.character === character && t.scene === scene)
  if (!own.length) return null
  const listed = own.filter((t) => s.order.some((e) => e.token === t.id))
  if (listed.length) {
    if (listed.every((t) => s.order.find((e) => e.token === t.id)!.score === total)) return null
    let order = s.order
    for (const t of listed) order = withScore(order, t.id, total)
    return { order, updated: listed.map((t) => t.id) }
  }
  const joiner = own.find((t) => !t.hidden) ?? own[0]!
  return { order: lateJoin(s.order, joiner, total), joined: joiner.id, updated: [] }
}

// ------------------------------------------------------------ end-of-encounter summary

/**
 * Damage dealt and taken, healing done and knockouts per combatant, from the encounter's log.
 * Only changes to `resource` (the pack's primary one) count when given, so spent spell slots and
 * other costs are not mistaken for damage. Healing with no source (a hand edit) counts for the
 * one healed. Rows follow the turn order, then anyone else logged. Null between encounters.
 */
export function encounterSummary(
  s: InitiativeState | null,
  tokens: Record<TokenId, Token>,
  resource?: string,
  isDown?: (token: TokenId) => boolean,
): EncounterSummary | null {
  if (!s || !s.active) return null
  const rows = new Map<TokenId, EncounterSummaryRow>()
  const row = (id: TokenId) => {
    let r = rows.get(id)
    if (!r) {
      const t = tokens[id]
      r = { token: id, name: t?.name ?? 'Gone', dealt: 0, taken: 0, healed: 0, kos: 0 }
      if (t?.hidden) r.hidden = true
      rows.set(id, r)
    }
    return r
  }
  for (const e of s.order) row(e.token)
  for (const l of s.log ?? []) {
    if (resource && l.resource !== resource) continue
    const target = row(l.target)
    if (l.delta < 0) {
      target.taken += -l.delta
      if (l.source && l.source !== l.target) {
        row(l.source).dealt += -l.delta
        if (l.ko) row(l.source).kos += 1
      }
    } else (l.source ? row(l.source) : target).healed += l.delta
  }
  if (isDown) for (const r of rows.values()) if (isDown(r.token)) r.down = true
  return { rounds: Math.max(1, s.round), rows: [...rows.values()] }
}

/** Whether anything happened worth reporting (some damage, healing or a knockout). */
export function summaryHasNews(summary: EncounterSummary | null): boolean {
  return !!summary && summary.rows.some((r) => r.dealt || r.taken || r.healed || r.kos)
}

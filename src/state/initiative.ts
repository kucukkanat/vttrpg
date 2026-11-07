/**
 * Pure initiative state transitions, group aware. A "slot" is one turn in the order: a single
 * combatant, or a run of adjacent entries sharing a `group` (group initiative: they share one
 * score and act together). `turn` always points at the first entry of a slot.
 *
 * Also the combat log the GM keeps during an encounter (who changed whose resources, knockouts),
 * which the end-of-encounter summary is computed from.
 */
import type { CombatLogEntry, InitiativeEntry, InitiativeState, ResourceDelta } from '@/core/doc'
import type { TokenId } from '@/core/ids'

export const EMPTY_INITIATIVE: InitiativeState = { active: false, round: 0, turn: 0, order: [] }

/** Index range `[start, end]` of the slot holding entry `i`. */
export function slotRange(order: readonly InitiativeEntry[], i: number): [number, number] {
  const g = order[i]?.group
  if (g === undefined) return [i, i]
  let start = i
  let end = i
  while (start > 0 && order[start - 1]!.group === g) start--
  while (end < order.length - 1 && order[end + 1]!.group === g) end++
  return [start, end]
}

/** Entries of the slot whose turn it is; empty between encounters. */
export function currentSlot(s: InitiativeState | null | undefined): InitiativeEntry[] {
  if (!s || !s.active || !s.order[s.turn]) return []
  const [a, b] = slotRange(s.order, s.turn)
  return s.order.slice(a, b + 1)
}

/** Whether `token` acts in the current slot (alone or as part of its group). */
export function inCurrentSlot(s: InitiativeState | null | undefined, token: TokenId | string): boolean {
  return currentSlot(s).some((e) => e.token === token)
}

/**
 * Highest score first; equal scores keep their given order. Group members stay together, at the
 * place of the group's first member, so a tie with an outsider cannot split a group.
 */
export function sortInitiative(order: InitiativeEntry[]): InitiativeEntry[] {
  const lead = new Map<string, number>()
  order.forEach((e, i) => { if (e.group !== undefined && !lead.has(e.group)) lead.set(e.group, i) })
  return order
    .map((e, i) => ({ e, i, k: e.group !== undefined ? lead.get(e.group)! : i }))
    .sort((a, b) => b.e.score - a.e.score || a.k - b.k || a.i - b.i)
    .map(({ e }) => e)
}

/** One slot on: past the end the round increments and the first slot is up again. */
export function nextTurn(s: InitiativeState): InitiativeState {
  if (!s.active || s.order.length === 0) return s
  const [, end] = slotRange(s.order, s.turn)
  const turn = end + 1
  return turn >= s.order.length ? { ...s, turn: 0, round: s.round + 1 } : { ...s, turn }
}

/** `turn` moved back to the start of its slot (a no-op without groups). */
function atSlotStart(s: InitiativeState): InitiativeState {
  if (!s.order[s.turn]) return s
  const [start] = slotRange(s.order, s.turn)
  return start === s.turn ? s : { ...s, turn: start }
}

/**
 * The order replaced by `order`: the combatant whose turn it is keeps it when still listed;
 * otherwise the turn index is clamped (an empty order wraps it to 0).
 */
export function withOrder(s: InitiativeState, order: InitiativeEntry[]): InitiativeState {
  const current = s.order[s.turn]?.token
  const idx = current === undefined ? -1 : order.findIndex((e) => e.token === current)
  const turn = idx >= 0 ? idx : Math.min(s.turn, Math.max(0, order.length - 1))
  return atSlotStart({ ...s, order, turn })
}

/**
 * A combatant dropped: turns before it shift down; removing the one whose turn it is hands the
 * turn to the next in line (a group-mate first), wrapping into a new round past the end. Its
 * declared action goes with it.
 */
export function withoutToken(s: InitiativeState, token: TokenId): InitiativeState {
  const idx = s.order.findIndex((e) => e.token === token)
  if (idx < 0) return s
  const order = s.order.filter((e) => e.token !== token)
  let next: InitiativeState
  if (idx < s.turn) next = { ...s, order, turn: s.turn - 1 }
  else if (idx === s.turn && s.turn >= order.length) next = { ...s, order, turn: 0, round: order.length ? s.round + 1 : s.round }
  else next = { ...s, order }
  if (next.declared && token in next.declared) {
    const { [token]: _gone, ...rest } = next.declared
    next = { ...next, declared: rest }
  }
  return atSlotStart(next)
}

/** A sheet value tracked as a resource: a bare number or `{ current }`. */
export function resourceNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (v && typeof v === 'object') {
    const c = (v as { current?: unknown }).current
    return typeof c === 'number' && Number.isFinite(c) ? c : undefined
  }
  return undefined
}

/**
 * Log entries for resource changes during an encounter. `before(token, resource)` is the value
 * before the change (for the knockout check); only combatants in the order are logged.
 */
export function combatEntries(
  s: InitiativeState,
  numbers: readonly ResourceDelta[],
  before: (token: TokenId, resource: string) => number | undefined,
  source?: TokenId,
): CombatLogEntry[] {
  if (!s.active) return []
  const fighting = new Set(s.order.map((e) => e.token))
  const out: CombatLogEntry[] = []
  for (const n of numbers) {
    if (!fighting.has(n.token) || !n.delta) continue
    const e: CombatLogEntry = { target: n.token, resource: n.resource, delta: n.delta, round: s.round }
    if (source && fighting.has(source)) e.source = source
    const b = before(n.token, n.resource)
    if (b !== undefined && b > 0 && b + n.delta <= 0) e.ko = true
    out.push(e)
  }
  return out
}

/** Resource deltas between two versions of a sheet (keys that were and remain resource-shaped). */
export function sheetDeltas(prev: Record<string, unknown>, next: Record<string, unknown>, token: TokenId): ResourceDelta[] {
  const out: ResourceDelta[] = []
  for (const [key, v] of Object.entries(next)) {
    const a = resourceNumber(prev[key])
    const b = resourceNumber(v)
    if (a === undefined || b === undefined || a === b) continue
    out.push({ token, delta: b - a, resource: key })
  }
  return out
}

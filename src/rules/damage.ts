/**
 * Damage math behind skill damage rows and apply-damage cards, driven by the pack's optional
 * `damage` model (`PackManifest.damage`): damage types, resistances / vulnerabilities /
 * immunities from sheet lists and active conditions, and temporary points spent first.
 * Pure: sheet data in, a new copy and the changes out.
 */
import type { AppliedDamage, DamageFactor } from '@/core/doc'
import type { ConditionDef, DamageModel } from '@/core/pack'
import { getPath, setPath } from './expr'

type Data = Record<string, unknown>

/** Where a resource lives in sheet data: `hp` is `{ current, max }` or a plain number; `a.b` is a path. */
export function resourceRef(data: Data, id: string): { path: string[]; current: number | undefined; max: number | undefined } {
  if (id.includes('.')) {
    const path = id.split('.')
    const current = getPath(data, path)
    const max = path[path.length - 1] === 'current' ? getPath(data, [...path.slice(0, -1), 'max']) : undefined
    return { path, current: typeof current === 'number' ? current : undefined, max: typeof max === 'number' ? max : undefined }
  }
  const v = data[id]
  if (typeof v === 'number') return { path: [id], current: v, max: undefined }
  const current = getPath(v, ['current'])
  const max = getPath(v, ['max'])
  return {
    path: [id, 'current'],
    current: typeof current === 'number' ? current : undefined,
    max: typeof max === 'number' ? max : undefined,
  }
}

export interface DamageTraits {
  resist: Set<string>
  vulnerable: Set<string>
  immune: Set<string>
}

const idList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().toLowerCase()) : []

/**
 * Resistances, vulnerabilities and immunities of a sheet: the model's sheet lists plus those of
 * every active condition (`data.conditions` and `extraConditions`, the token's own list).
 */
export function damageTraits(data: Data, model: DamageModel | undefined, conditions: readonly ConditionDef[], extraConditions: readonly string[] = []): DamageTraits {
  const t: DamageTraits = { resist: new Set(), vulnerable: new Set(), immune: new Set() }
  if (model?.resist) for (const id of idList(data[model.resist])) t.resist.add(id)
  if (model?.vulnerable) for (const id of idList(data[model.vulnerable])) t.vulnerable.add(id)
  if (model?.immune) for (const id of idList(data[model.immune])) t.immune.add(id)
  const active = new Set([...idList(data.conditions), ...extraConditions])
  for (const c of conditions) {
    if (!active.has(c.id)) continue
    for (const id of c.resist ?? []) t.resist.add(id)
    for (const id of c.vulnerable ?? []) t.vulnerable.add(id)
    for (const id of c.immune ?? []) t.immune.add(id)
  }
  return t
}

/**
 * The amount after traits, in SRD order: immunity zeroes it, resistance halves (rounding down),
 * vulnerability doubles. An untyped amount only meets `all` traits.
 */
export function adjustForTraits(amount: number, type: string | undefined, traits: DamageTraits): { amount: number; note?: string } {
  const has = (set: Set<string>) => set.has('all') || (type !== undefined && set.has(type.toLowerCase()))
  if (has(traits.immune)) return { amount: 0, note: 'immune' }
  const notes: string[] = []
  let n = amount
  if (has(traits.resist)) { n = Math.floor(n / 2); notes.push('resistant') }
  if (has(traits.vulnerable)) { n *= 2; notes.push('vulnerable') }
  return notes.length ? { amount: n, note: notes.join(', ') } : { amount: n }
}

/** Resource key a damage change is recorded under (the top-level sheet key). */
const keyOf = (id: string) => id.split('.')[0]

function bump(data: Data, id: string, delta: number): number {
  const ref = resourceRef(data, id)
  if (ref.current === undefined || delta === 0) return 0
  let next = Math.max(0, ref.current + delta)
  if (ref.max !== undefined && delta > 0) next = Math.min(ref.max, next)
  setPath(data, ref.path, next)
  return next - ref.current
}

/**
 * Damage taken by a sheet: temporary points (`model.temp`) absorb first, the rest comes off
 * `resource`. Mutates `data`; returns what changed. Unknown resources change nothing.
 */
export function takeDamage(data: Data, resource: string, amount: number, model?: DamageModel): { key: string; delta: number }[] {
  const changes: { key: string; delta: number }[] = []
  let rest = Math.max(0, Math.floor(amount))
  if (model?.temp && resource === model.resource && rest > 0) {
    const temp = resourceRef(data, model.temp).current ?? 0
    const absorbed = Math.min(temp, rest)
    if (absorbed > 0) {
      changes.push({ key: keyOf(model.temp), delta: bump(data, model.temp, -absorbed) })
      rest -= absorbed
    }
  }
  if (rest > 0) {
    const delta = bump(data, resource, -rest)
    if (delta) changes.push({ key: keyOf(resource), delta })
  }
  return changes
}

/** Healing up to the resource's max. Temporary points do not heal; granting them keeps the higher value (they do not stack). */
export function heal(data: Data, resource: string, amount: number, model?: DamageModel): { key: string; delta: number }[] {
  const n = Math.max(0, Math.floor(amount))
  if (model?.temp && resource === model.temp) {
    const ref = resourceRef(data, resource)
    const current = ref.current ?? 0
    if (n <= current) return []
    setPath(data, ref.current === undefined ? [resource] : ref.path, n)
    return [{ key: keyOf(resource), delta: n - current }]
  }
  const delta = bump(data, resource, n)
  return delta ? [{ key: keyOf(resource), delta }] : []
}

/** Undo recorded changes (clamped to 0 and the max, so a healed-past value never overflows). */
export function revert(data: Data, changes: readonly { key: string; delta: number }[], model?: DamageModel): void {
  for (const c of changes) {
    const id = model && c.key === keyOf(model.resource) ? model.resource : c.key
    bump(data, id, -c.delta)
  }
}

/**
 * One apply-damage choice on a sheet: undo `previous` (if any), then apply the card's amount at
 * `factor` (`-1` heals, `0` only undoes). Returns the new data and what this choice did.
 */
export function applyDamageChoice(
  data: Data,
  opts: {
    amount: number
    factor: DamageFactor | 0
    type?: string
    previous?: AppliedDamage
    model?: DamageModel
    resource?: string
    conditions: readonly ConditionDef[]
    tokenConditions?: readonly string[]
  },
): { data: Data; applied?: AppliedDamage } {
  const out = structuredClone(data)
  const resource = opts.resource ?? opts.model?.resource ?? 'hp'
  if (opts.previous) revert(out, opts.previous.changes, opts.model)
  if (opts.factor === 0) return { data: out }
  if (opts.factor === -1) {
    const amount = Math.max(0, Math.floor(opts.amount))
    return { data: out, applied: { factor: -1, amount, changes: heal(out, resource, amount, opts.model) } }
  }
  const scaled = Math.floor(Math.max(0, opts.amount) * opts.factor)
  const adjusted = adjustForTraits(scaled, opts.type, damageTraits(out, opts.model, opts.conditions, opts.tokenConditions))
  const applied: AppliedDamage = { factor: opts.factor, amount: adjusted.amount, changes: takeDamage(out, resource, adjusted.amount, opts.model) }
  if (adjusted.note) applied.note = adjusted.note
  return { data: out, applied }
}

/** Top-level sheet keys that differ between two data objects, with their new values. */
export function changedKeys(before: Data, after: Data): Data {
  const out: Data = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[key] = after[key]
  return out
}

/**
 * Pure model for the skill editor: the form state (all inputs are strings so typing is never
 * blocked), conversion to and from `SkillDef`, slug generation and validation. Validation runs the
 * same `guardSkill` the pack loader uses plus `parseExpression` on every DSL expression, so a
 * skill the editor accepts is one a pack folder would load.
 */
import type { TargetShape } from '@/core/geometry'
import type { SkillId } from '@/core/ids'
import type { Effect, SkillDef, VfxCue } from '@/core/pack'
import type { LoadedPack } from '@/rules'
import { guardSkill, parseExpression } from '@/rules'

export type TargetKind = TargetShape['kind']
export type EffectKind = Effect['kind']
export type VfxPreset = VfxCue['preset']
export type VfxAnchor = NonNullable<VfxCue['from']>

export const TARGET_KINDS: TargetKind[] = ['self', 'single', 'radius', 'cone', 'line']
export const EFFECT_KINDS: EffectKind[] = ['roll', 'damage', 'heal', 'condition', 'move', 'message']
export const VFX_PRESETS: VfxPreset[] = ['hit', 'projectile', 'ring', 'aura', 'beam', 'shake', 'rain', 'sound']
export const VFX_ANCHORS: VfxAnchor[] = ['source', 'target', 'point']

export interface CostForm {
  resource: string
  amount: string
}

export type EffectForm =
  | { kind: 'roll'; formula: string; vs: string; label: string }
  | { kind: 'damage'; formula: string; resource: string }
  | { kind: 'heal'; formula: string; resource: string }
  | { kind: 'condition'; add: string[]; remove: string[] }
  | { kind: 'move'; cells: string }
  | { kind: 'message'; text: string }

export interface VfxForm {
  at: string
  preset: VfxPreset
  from: VfxAnchor | ''
  to: VfxAnchor | ''
  color: string
  duration: string
  asset: string
}

export interface TargetForm {
  kind: TargetKind
  range: string
  radius: string
  angle: string
  width: string
}

export interface SkillForm {
  id: string
  /** Until the id is edited by hand it follows the name (new skills only). */
  idFollowsName: boolean
  name: string
  description: string
  icon: string
  cost: CostForm[]
  target: TargetForm
  effects: EffectForm[]
  vfx: VfxForm[]
}

/** Field errors keyed by dotted path (`name`, `cost.0.amount`, `effects.2.formula`, `vfx.1.at`). */
export type FormErrors = Record<string, string>

export interface Validation {
  errors: FormErrors
  /** Problems that do not belong to one field (from the pack guard). */
  general: string[]
  /** The skill when there are no errors at all. */
  skill: SkillDef | null
}

// ------------------------------------------------------------------- slugs

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** "Hazel's Fire Ball!" -> "hazels-fire-ball". Empty when nothing survives. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** `base`, or `base-2`, `base-3`, ... when `taken` already has it. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  const root = base || 'skill'
  if (!set.has(root)) return root
  for (let n = 2; ; n++) if (!set.has(`${root}-${n}`)) return `${root}-${n}`
}

// -------------------------------------------------------------------- forms

export function emptyTarget(kind: TargetKind = 'single'): TargetForm {
  return { kind, range: '1', radius: '1', angle: '60', width: '1' }
}

export function emptyEffect(kind: EffectKind): EffectForm {
  switch (kind) {
    case 'roll': return { kind, formula: 'd20', vs: '', label: '' }
    case 'damage': return { kind, formula: 'd6', resource: 'hp' }
    case 'heal': return { kind, formula: 'd6', resource: 'hp' }
    case 'condition': return { kind, add: [], remove: [] }
    case 'move': return { kind, cells: '1' }
    case 'message': return { kind, text: '{source.name} uses the skill on {target.name}.' }
  }
}

export function emptyVfx(preset: VfxPreset = 'hit'): VfxForm {
  const anchored = preset === 'projectile' || preset === 'beam'
  return { at: '0', preset, from: anchored ? 'source' : preset === 'shake' || preset === 'sound' ? '' : 'target', to: anchored ? 'target' : '', color: '', duration: '', asset: '' }
}

export function emptyForm(): SkillForm {
  return {
    id: '',
    idFollowsName: true,
    name: '',
    description: '',
    icon: '',
    cost: [],
    target: emptyTarget('single'),
    effects: [emptyEffect('message')],
    vfx: [emptyVfx('hit')],
  }
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

export function formFromSkill(skill: SkillDef): SkillForm {
  const t = skill.target
  const target = emptyTarget(t.kind)
  if ('range' in t) target.range = str(t.range)
  if (t.kind === 'radius') target.radius = str(t.radius)
  if (t.kind === 'cone') target.angle = str(t.angle)
  if (t.kind === 'line') target.width = str(t.width)
  return {
    id: skill.id,
    idFollowsName: false,
    name: skill.name,
    description: skill.description,
    icon: skill.icon ?? '',
    cost: (skill.cost ?? []).map((c) => ({ resource: c.resource, amount: c.amount })),
    target,
    effects: skill.effects.map((e): EffectForm => {
      switch (e.kind) {
        case 'roll': return { kind: 'roll', formula: e.formula, vs: e.vs ?? '', label: e.label ?? '' }
        case 'damage': return { kind: 'damage', formula: e.formula, resource: e.resource }
        case 'heal': return { kind: 'heal', formula: e.formula, resource: e.resource }
        case 'condition': return { kind: 'condition', add: [...(e.add ?? [])], remove: [...(e.remove ?? [])] }
        case 'move': return { kind: 'move', cells: str(e.cells) }
        case 'message': return { kind: 'message', text: e.text }
      }
    }),
    vfx: skill.vfx.map((c) => ({
      at: str(c.at),
      preset: c.preset,
      from: c.from ?? '',
      to: c.to ?? '',
      color: c.color ?? '',
      duration: c.duration === undefined ? '' : str(c.duration),
      asset: c.asset ?? '',
    })),
  }
}

/** A copy of a skill ready to edit: "(copy)" name and an id that follows the name until edited. */
/**
 * Form that replaces a pack skill: same id, so saving overrides it in every sheet instead of
 * adding a second copy next to it. The id stays fixed while the name is edited.
 */
export function overrideForm(skill: SkillDef): SkillForm {
  const form = formFromSkill(skill)
  form.idFollowsName = false
  return form
}

export function duplicateForm(skill: SkillDef, taken: Iterable<string>): SkillForm {
  const form = formFromSkill(skill)
  form.name = `${skill.name} (copy)`
  form.id = uniqueSlug(slugify(form.name), taken)
  form.idFollowsName = true
  return form
}

const num = (s: string): number | undefined => {
  const t = s.trim()
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Build the `SkillDef` the form describes without validating it. Empty optional strings are
 * dropped; numbers that do not parse are left out so the guard reports them.
 */
export function skillFromForm(form: SkillForm): SkillDef {
  const t = form.target
  const range = num(t.range)
  let target: TargetShape
  switch (t.kind) {
    case 'self': target = { kind: 'self' }; break
    case 'single': target = { kind: 'single', range: range as number }; break
    case 'radius': target = { kind: 'radius', range: range as number, radius: num(t.radius) as number }; break
    case 'cone': target = { kind: 'cone', range: range as number, angle: num(t.angle) as number }; break
    case 'line': target = { kind: 'line', range: range as number, width: num(t.width) as number }; break
  }
  const effects = form.effects.map((e): Effect => {
    switch (e.kind) {
      case 'roll': {
        const out: Effect = { kind: 'roll', formula: e.formula.trim() }
        if (e.vs.trim()) out.vs = e.vs.trim()
        if (e.label.trim()) out.label = e.label.trim()
        return out
      }
      case 'damage': return { kind: 'damage', formula: e.formula.trim(), resource: e.resource.trim() }
      case 'heal': return { kind: 'heal', formula: e.formula.trim(), resource: e.resource.trim() }
      case 'condition': {
        const out: Effect = { kind: 'condition' }
        if (e.add.length) out.add = [...e.add]
        if (e.remove.length) out.remove = [...e.remove]
        return out
      }
      case 'move': return { kind: 'move', cells: num(e.cells) as number }
      case 'message': return { kind: 'message', text: e.text }
    }
  })
  const vfx = form.vfx.map((c): VfxCue => {
    const out: VfxCue = { at: num(c.at) as number, preset: c.preset }
    if (c.from) out.from = c.from
    if (c.to) out.to = c.to
    if (c.color.trim()) out.color = c.color.trim()
    const d = num(c.duration)
    if (d !== undefined) out.duration = d
    if (c.asset.trim()) out.asset = c.asset.trim()
    return out
  })
  const skill: SkillDef = {
    id: form.id.trim() as SkillId,
    name: form.name.trim(),
    description: form.description.trim(),
    target,
    effects,
    vfx,
  }
  if (form.icon.trim()) skill.icon = form.icon.trim()
  if (form.cost.length) skill.cost = form.cost.map((c) => ({ resource: c.resource.trim(), amount: c.amount.trim() }))
  // Drop any `undefined` left by unparsable numbers so JSON output stays clean.
  return JSON.parse(JSON.stringify(skill)) as SkillDef
}

// --------------------------------------------------------------- validation

function exprError(src: string): string | null {
  if (src.trim() === '') return 'required'
  try {
    parseExpression(src)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function validateForm(form: SkillForm, pack: Pick<LoadedPack, 'conditions'> | null): Validation {
  const errors: FormErrors = {}
  const put = (key: string, msg: string | null | undefined) => {
    if (msg && !errors[key]) errors[key] = msg
  }
  const needNumber = (key: string, s: string, opts: { min?: number; integer?: boolean } = {}) => {
    const n = num(s)
    if (n === undefined) return put(key, s.trim() === '' ? 'required' : 'must be a number')
    if (opts.integer && !Number.isInteger(n)) return put(key, 'must be a whole number')
    if (opts.min !== undefined && n < opts.min) return put(key, `must be at least ${opts.min}`)
  }

  const id = form.id.trim()
  if (!id) put('id', 'required')
  else if (!SLUG_RE.test(id)) put('id', 'lowercase letters, digits and dashes only')
  if (!form.name.trim()) put('name', 'required')
  if (!form.description.trim()) put('description', 'required')

  form.cost.forEach((c, i) => {
    if (!c.resource.trim()) put(`cost.${i}.resource`, 'pick a resource')
    put(`cost.${i}.amount`, exprError(c.amount))
  })

  const t = form.target
  if (t.kind !== 'self') needNumber('target.range', t.range, { min: 0 })
  if (t.kind === 'radius') needNumber('target.radius', t.radius, { min: 0 })
  if (t.kind === 'cone') needNumber('target.angle', t.angle, { min: 1 })
  if (t.kind === 'line') needNumber('target.width', t.width, { min: 0 })

  form.effects.forEach((e, i) => {
    const k = `effects.${i}`
    switch (e.kind) {
      case 'roll':
        put(`${k}.formula`, exprError(e.formula))
        if (e.vs.trim()) put(`${k}.vs`, exprError(e.vs))
        break
      case 'damage':
      case 'heal':
        put(`${k}.formula`, exprError(e.formula))
        if (!e.resource.trim()) put(`${k}.resource`, 'pick a resource')
        break
      case 'condition':
        if (!e.add.length && !e.remove.length) put(`${k}.add`, 'pick at least one condition to add or remove')
        if (pack) {
          const known = new Set(pack.conditions.map((c) => c.id))
          const unknown = [...e.add, ...e.remove].filter((c) => !known.has(c))
          if (unknown.length) put(`${k}.add`, `unknown condition: ${unknown.join(', ')}`)
        }
        break
      case 'move':
        needNumber(`${k}.cells`, e.cells, { integer: true })
        break
      case 'message': {
        if (!e.text.trim()) put(`${k}.text`, 'required')
        const open = (e.text.match(/\{/g) ?? []).length
        const close = (e.text.match(/\}/g) ?? []).length
        if (open !== close) put(`${k}.text`, 'unbalanced { }')
        for (const m of e.text.matchAll(/\{([^}]*)\}/g)) {
          const err = exprError(m[1])
          if (err) {
            put(`${k}.text`, `{${m[1]}}: ${err}`)
            break
          }
        }
        break
      }
    }
  })

  form.vfx.forEach((c, i) => {
    const k = `vfx.${i}`
    needNumber(`${k}.at`, c.at, { min: 0 })
    if (c.duration.trim()) needNumber(`${k}.duration`, c.duration, { min: 0 })
    if (c.color.trim() && !HEX_COLOR.test(c.color.trim())) put(`${k}.color`, 'hex colour like #ff7a1a')
    if (c.preset === 'sound' && !c.asset.trim()) put(`${k}.asset`, 'sound cues need an asset')
  })

  let skill: SkillDef | null = null
  const general: string[] = []
  if (Object.keys(errors).length === 0) {
    try {
      skill = guardSkill(skillFromForm(form), 'skill')
    } catch (e) {
      general.push((e as Error).message.replace(/^pack: skill: /, ''))
    }
  }
  return { errors, general, skill }
}

// --------------------------------------------------------------------- JSON

export function skillToJson(skill: SkillDef): string {
  return JSON.stringify(skill, null, 2)
}

/** Parse pasted JSON into a skill; the error message is meant for the UI. */
export function skillFromJson(text: string): { skill: SkillDef } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { error: `invalid JSON: ${(e as Error).message}` }
  }
  try {
    return { skill: guardSkill(raw, 'json') }
  } catch (e) {
    return { error: (e as Error).message.replace(/^pack: json: /, '') }
  }
}

/** Human readable one-liner for the list. */
export function describeTarget(t: TargetShape): string {
  switch (t.kind) {
    case 'self': return 'self'
    case 'single': return `single, range ${t.range}`
    case 'radius': return `burst ${t.radius}, range ${t.range}`
    case 'cone': return `cone ${t.angle}°, range ${t.range}`
    case 'line': return `line ${t.width} wide, range ${t.range}`
  }
}

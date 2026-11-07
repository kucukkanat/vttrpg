/**
 * Pack loader: fetches `pack.json` and the files it lists, validates each with
 * hand-written guards and checks that every DSL expression parses.
 */
import type {
  AttributeDef,
  ChargenSchema,
  ConditionDef,
  Effect,
  PackManifest,
  ResourceDef,
  RollResolution,
  SheetField,
  SheetSchema,
  SkillDef,
  VfxCue,
} from '@/core/pack'
import { CONDITION_CATEGORIES } from '@/core/pack'
import type { TargetShape } from '@/core/geometry'
import type { LoadedPack } from './index'
import { parse, usesDice } from './expr'

export class PackError extends Error {
  constructor(file: string, message: string) {
    super(`pack: ${file}: ${message}`)
    this.name = 'PackError'
  }
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)
const opt = <T>(v: unknown, g: (x: unknown) => x is T): boolean => v === undefined || g(v)

/** Joins a file path onto the pack base URL. Keeps absolute URLs untouched. */
export function resolvePackUrl(baseUrl: string, file: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(file) || file.startsWith('/')) return file
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'
  return base + file.replace(/^\.\//, '')
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export async function loadPack(baseUrl: string, fetchImpl?: FetchLike): Promise<LoadedPack> {
  const fetcher: FetchLike = fetchImpl ?? ((url) => globalThis.fetch(url))
  const read = async (file: string): Promise<unknown> => {
    const url = resolvePackUrl(baseUrl, file)
    let res
    try {
      res = await fetcher(url)
    } catch (e) {
      throw new PackError(file, `fetch failed (${(e as Error).message})`)
    }
    if (!res.ok) throw new PackError(file, `HTTP ${res.status} at ${url}`)
    try {
      return await res.json()
    } catch {
      throw new PackError(file, 'invalid JSON')
    }
  }

  const manifest = guardManifest(await read('pack.json'))
  // A pack's display font lives in the pack folder; hand the theme hook a URL it can load.
  const font = manifest.theme?.displayFont
  if (font?.src) manifest.theme = { ...manifest.theme, displayFont: { ...font, src: resolvePackUrl(baseUrl, font.src) } }
  const f = manifest.files
  const [attributes, resources, conditions, sheet] = await Promise.all([
    read(f.attributes).then((v) => guardAttributes(v, f.attributes)),
    read(f.resources).then((v) => guardResources(v, f.resources)),
    read(f.conditions).then((v) => guardConditions(v, f.conditions)),
    read(f.sheet).then((v) => guardSheet(v, f.sheet)),
  ])
  const skills = await Promise.all((f.skills ?? []).map((file) => read(file).then((v) => guardSkill(v, file))))
  const chargen = f.chargen ? guardChargen(await read(f.chargen), f.chargen) : undefined

  const ids = new Set<string>()
  for (const s of skills) {
    if (ids.has(s.id)) throw new PackError('pack.json', `duplicate skill id "${s.id}"`)
    ids.add(s.id)
  }
  if (manifest.resolution?.kind === 'roll-under') expr(manifest.resolution.die, 'pack.json', 'resolution.die')

  return { manifest, attributes, resources, conditions, sheet, skills, chargen }
}

// ------------------------------------------------------------------- guards

function expr(src: unknown, file: string, where: string): string {
  if (!isStr(src)) throw new PackError(file, `${where} must be an expression string`)
  try {
    parse(src)
  } catch (e) {
    throw new PackError(file, `${where}: ${(e as Error).message}`)
  }
  return src
}

const isHex = (v: unknown): v is string => isStr(v) && /^#[0-9a-f]{6}$/i.test(v)
function guardTheme(v: unknown): boolean {
  if (!isRec(v)) return false
  if (!opt(v.accent, isHex) || !opt(v.accentFg, isHex) || !opt(v.frameTint, isHex)) return false
  const f = v.displayFont
  return f === undefined || (isRec(f) && isStr(f.family) && opt(f.src, isStr) && opt(f.weight, isStr))
}

function guardResolution(v: unknown): v is RollResolution {
  if (!isRec(v)) return false
  if (v.kind === 'roll-under') return isStr(v.die)
  return v.kind === 'd20-vs-dc'
}

export function guardManifest(v: unknown): PackManifest {
  const file = 'pack.json'
  if (!isRec(v)) throw new PackError(file, 'not an object')
  if (!isStr(v.id) || !v.id) throw new PackError(file, '"id" required')
  if (!isStr(v.name)) throw new PackError(file, '"name" required')
  if (!isStr(v.version)) throw new PackError(file, '"version" required')
  if (!opt(v.description, isStr) || !opt(v.license, isStr)) throw new PackError(file, 'description/license must be strings')
  if (!isRec(v.grid) || !['square', 'hex', 'none'].includes(v.grid.type as string) || !isNum(v.grid.cellSize))
    throw new PackError(file, '"grid" must be { type: square|hex|none, cellSize: number }')
  if (v.theme !== undefined && !guardTheme(v.theme))
    throw new PackError(file, '"theme" must be { accent?, accentFg?, frameTint?: "#rrggbb", displayFont?: { family, src?, weight? } }')
  if (v.resolution !== undefined && !guardResolution(v.resolution))
    throw new PackError(file, '"resolution" must be { kind: "roll-under", die } or { kind: "d20-vs-dc" }')
  if (v.damage !== undefined) guardDamageModel(v.damage, file)
  if (v.concentration !== undefined) {
    const c = v.concentration
    if (!isRec(c) || !isStr(c.condition) || !c.condition) throw new PackError(file, '"concentration" needs a "condition" id')
    expr(c.save, file, 'concentration.save')
    expr(c.dc, file, 'concentration.dc')
  }
  const files = v.files
  if (!isRec(files)) throw new PackError(file, '"files" required')
  for (const k of ['attributes', 'resources', 'conditions', 'sheet'])
    if (!isStr(files[k])) throw new PackError(file, `files.${k} required`)
  if (!opt(files.chargen, isStr)) throw new PackError(file, 'files.chargen must be a string')
  if (!opt(files.skills, isStrArr)) throw new PackError(file, 'files.skills must be a list of paths')
  return v as unknown as PackManifest
}

function guardDamageModel(v: unknown, file: string): void {
  if (!isRec(v) || !isStr(v.resource) || !v.resource) throw new PackError(file, '"damage" needs a "resource"')
  for (const k of ['temp', 'resist', 'vulnerable', 'immune'])
    if (!opt(v[k], isStr)) throw new PackError(file, `damage.${k} must be a sheet key`)
  if (v.types !== undefined) {
    if (!Array.isArray(v.types)) throw new PackError(file, 'damage.types must be a list')
    v.types.forEach((t, i) => {
      if (!isRec(t) || !isStr(t.id) || !t.id || !isStr(t.name)) throw new PackError(file, `damage.types[${i}]: "id" and "name" required`)
    })
  }
}

function guardArray(v: unknown, file: string): Rec[] {
  if (!Array.isArray(v)) throw new PackError(file, 'must be a JSON array')
  return v.map((x, i) => {
    if (!isRec(x)) throw new PackError(file, `entry ${i} is not an object`)
    return x
  })
}

function guardIdName(x: Rec, file: string, i: number): void {
  if (!isStr(x.id) || !x.id) throw new PackError(file, `entry ${i}: "id" required`)
  if (!isStr(x.name)) throw new PackError(file, `entry ${i} (${x.id}): "name" required`)
}

export function guardAttributes(v: unknown, file: string): AttributeDef[] {
  return guardArray(v, file).map((x, i) => {
    guardIdName(x, file, i)
    if (!opt(x.abbr, isStr) || !opt(x.min, isNum) || !opt(x.max, isNum)) throw new PackError(file, `${x.id}: bad abbr/min/max`)
    if (x.derived !== undefined && usesDice(parse(expr(x.derived, file, `${x.id}.derived`))))
      throw new PackError(file, `${x.id}.derived must not roll dice`)
    return x as unknown as AttributeDef
  })
}

export function guardResources(v: unknown, file: string): ResourceDef[] {
  return guardArray(v, file).map((x, i) => {
    guardIdName(x, file, i)
    expr(x.max, file, `${x.id}.max`)
    if (x.resetOn !== undefined && !['rest', 'longRest', 'session', 'never'].includes(x.resetOn as string))
      throw new PackError(file, `${x.id}: bad resetOn`)
    return x as unknown as ResourceDef
  })
}

export function guardConditions(v: unknown, file: string): ConditionDef[] {
  return guardArray(v, file).map((x, i) => {
    guardIdName(x, file, i)
    if (!isStr(x.description)) throw new PackError(file, `${x.id}: "description" required`)
    if (!opt(x.icon, isStr)) throw new PackError(file, `${x.id}: icon must be a string`)
    if (x.modifiers !== undefined && !(isRec(x.modifiers) && Object.values(x.modifiers).every(isNum)))
      throw new PackError(file, `${x.id}: modifiers must map attribute ids to numbers`)
    if (x.category !== undefined && !(CONDITION_CATEGORIES as readonly unknown[]).includes(x.category))
      throw new PackError(file, `${x.id}: category must be one of ${CONDITION_CATEGORIES.join(', ')}`)
    for (const k of ['resist', 'immune', 'vulnerable'])
      if (!opt(x[k], isStrArr)) throw new PackError(file, `${x.id}: ${k} must be a list of damage type ids`)
    return x as unknown as ConditionDef
  })
}

function guardField(x: unknown, file: string, where: string): SheetField {
  if (!isRec(x) || !isStr(x.kind)) throw new PackError(file, `${where}: field needs a "kind"`)
  if (!isStr(x.label)) throw new PackError(file, `${where}: "label" required`)
  const needBind = () => {
    if (!isStr(x.bind) || !x.bind) throw new PackError(file, `${where}: "bind" required`)
  }
  switch (x.kind) {
    case 'number':
      needBind()
      if (!opt(x.readonly, isBool)) throw new PackError(file, `${where}: readonly must be boolean`)
      break
    case 'text':
      needBind()
      if (!opt(x.multiline, isBool)) throw new PackError(file, `${where}: multiline must be boolean`)
      break
    case 'resource':
      needBind()
      break
    case 'inventory-grid':
      needBind()
      if (!isNum(x.cols) || !isNum(x.rows) || x.cols < 1 || x.rows < 1) throw new PackError(file, `${where}: cols/rows required`)
      if (!opt(x.slotLabels, isStrArr)) throw new PackError(file, `${where}: slotLabels must be strings`)
      if (Array.isArray(x.slotLabels) && x.slotLabels.length > x.cols * x.rows)
        throw new PackError(file, `${where}: more slotLabels than slots`)
      break
    case 'list':
      needBind()
      if (!Array.isArray(x.item)) throw new PackError(file, `${where}: "item" fields required`)
      x.item.forEach((f, i) => guardField(f, file, `${where}.item[${i}]`))
      break
    case 'roll':
      expr(x.formula, file, `${where}.formula`)
      break
    case 'computed':
      expr(x.expr, file, `${where}.expr`)
      break
    default:
      throw new PackError(file, `${where}: unknown field kind "${x.kind}"`)
  }
  return x as unknown as SheetField
}

export function guardSheet(v: unknown, file: string): SheetSchema {
  if (!isRec(v) || !Array.isArray(v.sections)) throw new PackError(file, '"sections" array required')
  v.sections.forEach((s, i) => {
    if (!isRec(s) || !isStr(s.title)) throw new PackError(file, `section ${i}: "title" required`)
    if (!opt(s.columns, isNum)) throw new PackError(file, `section ${i}: columns must be a number`)
    if (!Array.isArray(s.fields)) throw new PackError(file, `section "${s.title}": "fields" required`)
    s.fields.forEach((f, j) => guardField(f, file, `section "${s.title}" field ${j}`))
  })
  return v as unknown as SheetSchema
}

function guardTarget(v: unknown, file: string): TargetShape {
  if (!isRec(v) || !isStr(v.kind)) throw new PackError(file, '"target" needs a kind')
  const range = () => {
    if (!isNum(v.range)) throw new PackError(file, `target ${v.kind}: "range" required`)
  }
  switch (v.kind) {
    case 'self':
      break
    case 'single':
      range()
      break
    case 'radius':
      range()
      if (!isNum(v.radius)) throw new PackError(file, 'target radius: "radius" required')
      break
    case 'cone':
      range()
      if (!isNum(v.angle)) throw new PackError(file, 'target cone: "angle" required')
      break
    case 'line':
      range()
      if (!isNum(v.width)) throw new PackError(file, 'target line: "width" required')
      break
    default:
      throw new PackError(file, `unknown target kind "${v.kind}"`)
  }
  return v as unknown as TargetShape
}

function guardEffect(v: unknown, file: string, i: number): Effect {
  const where = `effects[${i}]`
  if (!isRec(v) || !isStr(v.kind)) throw new PackError(file, `${where}: needs a kind`)
  switch (v.kind) {
    case 'roll':
      expr(v.formula, file, `${where}.formula`)
      if (v.vs !== undefined) expr(v.vs, file, `${where}.vs`)
      if (!opt(v.label, isStr)) throw new PackError(file, `${where}: label must be a string`)
      break
    case 'damage':
    case 'heal':
      expr(v.formula, file, `${where}.formula`)
      if (!isStr(v.resource) || !v.resource) throw new PackError(file, `${where}: "resource" required`)
      if (!opt(v.type, isStr)) throw new PackError(file, `${where}: type must be a damage type id`)
      break
    case 'condition':
      if (!opt(v.add, isStrArr) || !opt(v.remove, isStrArr)) throw new PackError(file, `${where}: add/remove must be id lists`)
      if (v.duration !== undefined) {
        const d = v.duration
        if (!isRec(d) || !isNum(d.turns) || d.turns < 1 || !Number.isInteger(d.turns)) throw new PackError(file, `${where}: duration needs whole "turns" >= 1`)
        if (d.tick !== undefined && d.tick !== 'start' && d.tick !== 'end') throw new PackError(file, `${where}: duration.tick must be start or end`)
        if (d.on !== undefined && d.on !== 'source' && d.on !== 'target') throw new PackError(file, `${where}: duration.on must be source or target`)
      }
      break
    case 'move':
      if (!isNum(v.cells)) throw new PackError(file, `${where}: "cells" required`)
      break
    case 'message':
      if (!isStr(v.text)) throw new PackError(file, `${where}: "text" required`)
      for (const m of v.text.matchAll(/\{([^}]*)\}/g)) expr(m[1], file, `${where}.text {${m[1]}}`)
      break
    default:
      throw new PackError(file, `${where}: unknown effect kind "${v.kind}"`)
  }
  return v as unknown as Effect
}

const VFX_PRESETS = ['hit', 'projectile', 'ring', 'rain', 'aura', 'beam', 'shake', 'sound']
const VFX_ANCHORS = ['source', 'target', 'point']

function guardVfx(v: unknown, file: string, i: number): VfxCue {
  const where = `vfx[${i}]`
  if (!isRec(v)) throw new PackError(file, `${where}: not an object`)
  if (!isNum(v.at)) throw new PackError(file, `${where}: "at" (ms) required`)
  if (!isStr(v.preset) || !VFX_PRESETS.includes(v.preset)) throw new PackError(file, `${where}: unknown preset`)
  for (const k of ['from', 'to'])
    if (v[k] !== undefined && !(isStr(v[k]) && VFX_ANCHORS.includes(v[k] as string)))
      throw new PackError(file, `${where}: ${k} must be source|target|point`)
  if (!opt(v.color, isStr) || !opt(v.duration, isNum) || !opt(v.asset, isStr))
    throw new PackError(file, `${where}: bad color/duration/asset`)
  return v as unknown as VfxCue
}

export function guardSkill(v: unknown, file: string): SkillDef {
  if (!isRec(v)) throw new PackError(file, 'not an object')
  guardIdName(v, file, 0)
  if (!isStr(v.description)) throw new PackError(file, '"description" required')
  if (!opt(v.icon, isStr)) throw new PackError(file, 'icon must be a string')
  if (!opt(v.concentration, isBool)) throw new PackError(file, 'concentration must be true or false')
  if (v.cost !== undefined) {
    if (!Array.isArray(v.cost)) throw new PackError(file, '"cost" must be a list')
    v.cost.forEach((c, i) => {
      if (!isRec(c) || !isStr(c.resource)) throw new PackError(file, `cost[${i}]: "resource" required`)
      expr(c.amount, file, `cost[${i}].amount`)
    })
  }
  guardTarget(v.target, file)
  if (!Array.isArray(v.effects)) throw new PackError(file, '"effects" must be a list')
  v.effects.forEach((e, i) => guardEffect(e, file, i))
  if (!Array.isArray(v.vfx)) throw new PackError(file, '"vfx" must be a list')
  v.vfx.forEach((c, i) => guardVfx(c, file, i))
  return v as unknown as SkillDef
}

export function guardChargen(v: unknown, file: string): ChargenSchema {
  if (!isRec(v) || !Array.isArray(v.steps)) throw new PackError(file, '"steps" array required')
  const tables = v.tables ?? {}
  if (!isRec(tables)) throw new PackError(file, '"tables" must be an object')
  for (const [id, t] of Object.entries(tables)) {
    if (!isRec(t) || !isStr(t.die)) throw new PackError(file, `table "${id}": "die" required`)
    if (t.die !== 'd66') expr(t.die, file, `table "${id}".die`)
    if (!isRec(t.rows) || Object.keys(t.rows).length === 0) throw new PackError(file, `table "${id}": "rows" required`)
    for (const [k, row] of Object.entries(t.rows)) {
      if (!/^\d+(-\d+)?$/.test(k)) throw new PackError(file, `table "${id}": row key "${k}" must be a number or range`)
      if (!isRec(row)) throw new PackError(file, `table "${id}": row ${k} is not an object`)
    }
  }
  v.steps.forEach((s, i) => {
    if (!isRec(s) || !isStr(s.id) || !isStr(s.title)) throw new PackError(file, `step ${i}: "id" and "title" required`)
    if (s.assign !== undefined) {
      if (!isRec(s.assign)) throw new PackError(file, `step ${s.id}: "assign" must be an object`)
      for (const [k, e] of Object.entries(s.assign)) expr(e, file, `step ${s.id}.assign.${k}`)
    }
    if (s.table !== undefined && !(isStr(s.table) && s.table in tables))
      throw new PackError(file, `step ${s.id}: unknown table "${String(s.table)}"`)
    if (s.choose !== undefined) {
      if (!isRec(s.choose) || !isStr(s.choose.bind) || !isStrArr(s.choose.options) || s.choose.options.length === 0)
        throw new PackError(file, `step ${s.id}: "choose" needs bind and options`)
    }
    if (s.set !== undefined && !isRec(s.set)) throw new PackError(file, `step ${s.id}: "set" must be an object`)
  })
  return v as unknown as ChargenSchema
}

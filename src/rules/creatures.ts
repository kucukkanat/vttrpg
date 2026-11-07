/**
 * Creature support driven by pack data: picking a character's sheet layout, loading the
 * compendium snapshots on demand, and compiling stat-block actions into ordinary skills with the
 * pack's action templates. Nothing here knows a game system.
 */
import type { Character } from '@/core/doc'
import type { CreatureActionTemplate, CreatureDocument, CreatureEntry, SheetSchema, SkillDef } from '@/core/pack'
import type { SkillId } from '@/core/ids'
import type { LoadedPack } from './index'
import { getPath } from './expr'
import { guardSkill, resolvePackUrl, type FetchLike } from './load'

/** The layout that renders `character`: its `sheet` id when the pack has it, else the main sheet. */
export function sheetFor(pack: Pick<LoadedPack, 'sheet' | 'sheets'>, character: Pick<Character, 'sheet'> | undefined): SheetSchema {
  const id = character?.sheet
  return (id && pack.sheets?.[id]) || pack.sheet
}

export interface CreatureCompendium {
  documents: CreatureDocument[]
  creatures: CreatureEntry[]
}

const compendiumCache = new WeakMap<LoadedPack, Promise<CreatureCompendium>>()

/**
 * Every creature in the pack's snapshot files, each tagged with its document key. Fetched once per
 * loaded pack; an empty compendium for packs without creatures. A failed fetch is not cached.
 */
export function loadCreatures(pack: LoadedPack, fetchImpl?: FetchLike): Promise<CreatureCompendium> {
  const cached = compendiumCache.get(pack)
  if (cached) return cached
  const files = pack.manifest.creatures?.files ?? []
  const fetcher: FetchLike = fetchImpl ?? ((url) => globalThis.fetch(url))
  const p = Promise.all(files.map(async (file) => {
    const res = await fetcher(resolvePackUrl(pack.baseUrl ?? '', file))
    if (!res.ok) throw new Error(`creatures: HTTP ${res.status} for ${file}`)
    const body = (await res.json()) as { document?: CreatureDocument; creatures?: CreatureEntry[] }
    if (!body.document || !Array.isArray(body.creatures)) throw new Error(`creatures: ${file} is not a creature file`)
    return body as { document: CreatureDocument; creatures: CreatureEntry[] }
  })).then((parts) => ({
    documents: parts.map((p) => p.document),
    creatures: parts.flatMap((p) => p.creatures.filter((c) => c && typeof c.key === 'string' && typeof c.name === 'string' && c.data && typeof c.data === 'object')),
  }))
  compendiumCache.set(pack, p)
  p.catch(() => compendiumCache.delete(pack))
  return p
}

/** Skill ids compiled for a creature start with this, so a template's skills can be found and replaced. */
export function creatureSkillPrefix(ref: string): string {
  return `creature:${ref}:`
}

/** Values pasted into formulas at compile time must be plain words or numbers. */
const LITERAL = /^[A-Za-z0-9_.-]+$/

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== ''
}

function substitute(src: string, action: Record<string, unknown>, path: string): string | null {
  let bad = false
  const out = src.replace(/\$\{([A-Za-z0-9_]+)(?:\|([^}]*))?\}/g, (_m, field: string, def: string | undefined) => {
    const v = present(action[field]) ? String(action[field]) : def
    if (v === undefined || !LITERAL.test(v)) { bad = true; return '' }
    return v
  })
  return bad ? null : out.replace(/\$\./g, `${path}.`)
}

function fill(value: unknown, action: Record<string, unknown>, path: string): unknown {
  if (typeof value === 'string') {
    const s = substitute(value, action, path)
    if (s === null) throw new Error('missing field')
    return s
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, action, path))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = fill(v, action, path)
    return out
  }
  return value
}

function numericTarget(target: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(target)) out[k] = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v
  return out
}

function compileOne(tpl: CreatureActionTemplate, action: Record<string, unknown>, path: string, id: string, owner: string): SkillDef | null {
  if ((tpl.requires ?? []).some((f) => !present(action[f]))) return null
  try {
    const skill = {
      id: id as SkillId,
      name: typeof action.name === 'string' && action.name.trim() ? action.name.trim() : 'Action',
      description: typeof action.desc === 'string' ? action.desc : '',
      ...(tpl.icon ? { icon: tpl.icon } : {}),
      ...(tpl.cost ? { cost: fill(tpl.cost, action, path) } : {}),
      target: numericTarget(fill(tpl.target, action, path) as Record<string, unknown>),
      effects: fill(tpl.effects, action, path),
      vfx: fill(tpl.vfx, action, path),
      onlyListed: true,
    }
    return guardSkill(skill, `${owner}: ${skill.name}`)
  } catch {
    return null
  }
}

/**
 * One skill per stat-block action that has a template, in sheet order. `ref` identifies the
 * creature (`pack:<key>` or `game:<id>`) and prefixes the ids; formulas read the action through
 * its sheet path, so a sheet edit (to-hit, damage) applies without recompiling.
 */
export function compileActionSkills(pack: Pick<LoadedPack, 'creatureActions'>, ref: string, data: Record<string, unknown>): SkillDef[] {
  const t = pack.creatureActions
  if (!t) return []
  const list = getPath(data, t.list.split('.'))
  if (!Array.isArray(list)) return []
  const out: SkillDef[] = []
  list.forEach((item, i) => {
    if (!item || typeof item !== 'object') return
    const action = item as Record<string, unknown>
    const kind = action[t.kindField]
    const tpl = typeof kind === 'string' ? t.templates[kind] : undefined
    if (!tpl) return
    const skill = compileOne(tpl, action, `${t.list}.${i}`, `${creatureSkillPrefix(ref)}${i}`, ref)
    if (skill) out.push(skill)
  })
  return out
}

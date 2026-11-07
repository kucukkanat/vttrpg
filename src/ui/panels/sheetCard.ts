/**
 * Pure helpers for the character card (`CharacterCard`): what the card shows is read off the pack's
 * sheet schema and attribute list, so it works for any pack without per-system code.
 */
import type { Character } from '@/core/doc'
import type { AttributeDef, SheetField, SheetSchema } from '@/core/pack'
import { getPath } from '@/rules/expr'
import { isItem } from '@/rules/scope'

export interface SheetRoll {
  label: string
  formula: string
}

type Compute = (expr: string) => unknown

function safe(compute: Compute | undefined, expr: string): unknown {
  if (!compute) return undefined
  try { return compute(expr) } catch { return undefined }
}

function read(character: Pick<Character, 'name' | 'data'>, bind: string): unknown {
  if (bind === 'name') return character.name
  return getPath(character.data, bind.split('.'))
}

/** Every roll button on the sheet, in sheet order (roll fields nested in lists are per-item and skipped). */
export function sheetRolls(schema: SheetSchema): SheetRoll[] {
  const out: SheetRoll[] = []
  for (const s of schema.sections) for (const f of s.fields) if (f.kind === 'roll') out.push({ label: f.label, formula: f.formula })
  return out
}

/** Identifiers in a formula (dotted paths kept whole), with quoted strings removed first. */
export function formulaIdentifiers(formula: string): string[] {
  const stripped = formula.replace(/'[^']*'|"[^"]*"/g, ' ')
  return stripped.match(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g) ?? []
}

/**
 * Whether `formula` reads attribute `id`: the attribute itself, its `<id>_mod` modifier, or a path
 * segment such as `save_prof.str`.
 */
export function referencesAttribute(formula: string, id: string): boolean {
  return formulaIdentifiers(formula).some((ident) => ident.split('.').some((seg) => seg === id || seg === `${id}_mod`))
}

/**
 * The roll an attribute tile triggers: one that references the attribute, preferring a save, then a
 * roll whose label starts with the abbreviation or name ("STR check"), then the first match. Null
 * when the sheet has no roll for it, so the tile is display-only.
 */
export function tileRoll(schema: SheetSchema, attr: Pick<AttributeDef, 'id' | 'name' | 'abbr'>): SheetRoll | null {
  const hits = sheetRolls(schema).filter((r) => referencesAttribute(r.formula, attr.id))
  if (!hits.length) return null
  const save = hits.find((r) => /\bsave\b/i.test(r.label))
  if (save) return save
  const prefixes = [attr.abbr, attr.name].filter((p): p is string => !!p).map((p) => p.toLowerCase())
  const named = hits.find((r) => prefixes.some((p) => r.label.toLowerCase().startsWith(p)))
  return named ?? hits[0]!
}

/**
 * Subtitle under the name: values of the identity section's single-line text fields (other than the
 * name), in sheet order, joined with a middle dot. The identity section is the one titled "Identity",
 * else the first one.
 */
export function cardSubtitle(schema: SheetSchema, character: Pick<Character, 'name' | 'data'>, max = 3): string {
  const section = schema.sections.find((s) => /identity/i.test(s.title)) ?? schema.sections[0]
  if (!section) return ''
  const parts: string[] = []
  for (const f of section.fields) {
    if (parts.length >= max) break
    if (f.kind !== 'text' || f.multiline || f.bind === 'name') continue
    const v = read(character, f.bind)
    const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
    if (s) parts.push(s)
  }
  return parts.join(' · ')
}

/** The character's level when the sheet has a `level` number, for the header badge. */
export function cardLevel(character: Pick<Character, 'data'>): number | null {
  const v = character.data.level
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export interface AttributeTile {
  id: string
  abbr: string
  name: string
  value: number | null
  /** Maximum when the sheet stores the attribute as `{ current, max }` and it is reduced (Mausritter). */
  max: number | null
  /** The `<id>_mod` modifier when the pack derives one (D&D). */
  mod: number | null
  roll: SheetRoll | null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** One tile per pack attribute that has an abbreviation (the headline stats). */
export function attributeTiles(
  schema: SheetSchema,
  attributes: readonly AttributeDef[],
  character: Pick<Character, 'name' | 'data'>,
  compute?: Compute,
): AttributeTile[] {
  return attributes.filter((a) => a.abbr).map((a) => {
    const raw = character.data[a.id]
    let value: number | null = null
    let max: number | null = null
    if (raw && typeof raw === 'object') {
      value = num((raw as { current?: unknown }).current)
      max = num((raw as { max?: unknown }).max)
    } else value = num(raw)
    if (value === null && a.derived) value = num(safe(compute, a.id))
    const modDef = attributes.find((d) => d.id === `${a.id}_mod` && d.derived)
    const mod = modDef ? num(safe(compute, modDef.id)) : null
    return { id: a.id, abbr: a.abbr!, name: a.name, value, max: max !== null && max !== value ? max : null, mod, roll: tileRoll(schema, a) }
  })
}

export function formatMod(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`
}

function allFields(schema: SheetSchema): { field: SheetField; section: string }[] {
  return schema.sections.flatMap((s) => s.fields.map((field) => ({ field, section: s.title })))
}

function itemName(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  if (!v || typeof v !== 'object') return null
  const o = v as { name?: unknown; qty?: unknown }
  if (typeof o.name !== 'string' || !o.name.trim()) return null
  return typeof o.qty === 'number' && o.qty > 1 ? `${o.name.trim()} ×${o.qty}` : o.name.trim()
}

export interface SummaryLine {
  label: string
  text: string
}

/**
 * One line per carried-items field: inventory grids (items with slots used / total) and lists in an
 * equipment, inventory or gear section. Empty fields are left out.
 */
export function inventorySummary(schema: SheetSchema, character: Pick<Character, 'name' | 'data'>): SummaryLine[] {
  const out: SummaryLine[] = []
  for (const { field, section } of allFields(schema)) {
    if (field.kind === 'inventory-grid') {
      const raw = read(character, field.bind)
      const slots = Array.isArray(raw) ? raw.slice(0, field.cols * field.rows) : []
      const names = slots.filter(isItem).map((i) => i.name.trim()).filter(Boolean)
      if (!names.length) continue
      const used = slots.filter((s) => s !== null && s !== undefined).length
      out.push({ label: field.label, text: `${names.join(', ')} (${used}/${field.cols * field.rows})` })
    } else if (field.kind === 'list' && /equip|invent|gear|item/i.test(`${section} ${field.label} ${field.bind}`)) {
      const raw = read(character, field.bind)
      const names = (Array.isArray(raw) ? raw : []).map(itemName).filter((n): n is string => !!n)
      if (names.length) out.push({ label: field.label, text: names.join(', ') })
    }
  }
  return out
}

/** First non-empty line of the sheet's multiline notes, if any. */
export function notesSummary(schema: SheetSchema, character: Pick<Character, 'name' | 'data'>): string {
  for (const { field } of allFields(schema)) {
    if (field.kind !== 'text' || !field.multiline) continue
    const v = read(character, field.bind)
    const line = typeof v === 'string' ? v.split('\n').map((l) => l.trim()).find(Boolean) : undefined
    if (line) return line
  }
  return ''
}

/** "Mira Thistlewood" -> "MT", "Bob" -> "BO". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase()
}

export type SheetMode = 'card' | 'edit'
export const SHEET_MODE_KEY = 'vttrpg.sheet.mode'

export function loadSheetMode(): SheetMode {
  try { return localStorage.getItem(SHEET_MODE_KEY) === 'edit' ? 'edit' : 'card' } catch { return 'card' }
}

export function saveSheetMode(mode: SheetMode): void {
  try { localStorage.setItem(SHEET_MODE_KEY, mode) } catch { /* private mode, quota */ }
}

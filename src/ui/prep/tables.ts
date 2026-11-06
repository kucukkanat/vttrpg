/**
 * Rolling on a pack's chargen tables outside chargen (rumours, backgrounds, details) and turning
 * the row into a chat line. Pure apart from the dice, which come from the rules engine.
 */
import type { RulesEngine } from '@/rules'

export interface TableRoll {
  table: string
  die: string
  key: string
  row: Record<string, unknown> | null
}

/** Exact key first, then "a-b" range keys. Mirrors the rules engine's lookup. */
export function lookupRow<T>(rows: Record<string, T>, key: string): T | undefined {
  if (rows[key] !== undefined) return rows[key]
  const n = Number(key)
  if (!Number.isFinite(n)) return undefined
  for (const [k, row] of Object.entries(rows)) {
    const m = /^(\d+)-(\d+)$/.exec(k)
    if (m && n >= Number(m[1]) && n <= Number(m[2])) return row
  }
  return undefined
}

/** Flatten a table row to "label: value" parts; item lists become their names. */
export function describeRow(row: Record<string, unknown>): string {
  const parts: string[] = []
  const walk = (prefix: string, v: unknown) => {
    if (v === null || v === undefined) return
    if (Array.isArray(v)) {
      const names = v.map((x) => (x && typeof x === 'object' && 'name' in x ? String((x as { name: unknown }).name) : typeof x === 'object' ? '' : String(x))).filter(Boolean)
      if (names.length) parts.push(`${prefix}: ${names.join(', ')}`)
      return
    }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(prefix ? `${prefix}.${k}` : k, x)
      return
    }
    parts.push(`${prefix}: ${String(v)}`)
  }
  for (const [k, v] of Object.entries(row)) walk(k, v)
  return parts.join('; ')
}

/** Roll `table` with the pack's dice and return the row. d66 is two d6 read as tens and units. */
export async function rollTable(rules: RulesEngine, table: string, seed: string): Promise<TableRoll> {
  const def = rules.pack.chargen?.tables[table]
  if (!def) throw new Error(`unknown table "${table}"`)
  let key: string
  if (def.die === 'd66') {
    const r = await rules.roll('2d6', seed)
    key = `${r.dice[0]?.value ?? 1}${r.dice[1]?.value ?? 1}`
  } else {
    const r = await rules.roll(def.die, seed)
    key = String(r.total)
  }
  return { table, die: def.die, key, row: lookupRow(def.rows, key) ?? null }
}

export function tableTitle(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Chat line for a table roll. */
export function formatTableRoll(r: TableRoll): string {
  const head = `${tableTitle(r.table)} (${r.die} = ${r.key})`
  return r.row ? `${head}: ${describeRow(r.row)}` : `${head}: no entry`
}

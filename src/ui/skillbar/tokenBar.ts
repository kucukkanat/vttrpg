/**
 * Pure helpers for the token bar: the sheet's save rolls (shown as chips) and HP adjustment.
 */

/** A roll button from the pack's sheet. */
export interface SheetRoll {
  label: string
  formula: string
}

/** Every `{ kind: 'roll' }` field in a sheet schema, in document order (walks sections, groups, lists). */
export function sheetRolls(schema: unknown): SheetRoll[] {
  const out: SheetRoll[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return }
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (o.kind === 'roll' && typeof o.formula === 'string' && typeof o.label === 'string') {
      out.push({ label: o.label, formula: o.formula })
      return
    }
    for (const x of Object.values(o)) walk(x)
  }
  walk(schema)
  return out
}

/** The sheet's saving throws ("STR save", "Save vs poison"): the rolls the token bar offers. */
export function sheetSaves(schema: unknown): SheetRoll[] {
  return sheetRolls(schema).filter((r) => /\bsave\b/i.test(r.label))
}

/** "STR save" -> "STR", "Save vs poison" stays. Short labels keep the chips small. */
export function saveChipLabel(label: string): string {
  const m = /^(\S+)\s+save$/i.exec(label.trim())
  return m ? m[1]! : label
}

/**
 * Sheet data with resource `id` moved by `delta`, clamped to 0..max. Handles the `{ current, max }`
 * shape and a bare number (no upper clamp without a max). Null when the sheet does not track it.
 */
export function adjustResource(data: Record<string, unknown>, id: string, delta: number, max?: number): Record<string, unknown> | null {
  const v = data[id]
  if (typeof v === 'number') {
    const next = Math.max(0, max !== undefined ? Math.min(max, v + delta) : v + delta)
    return { ...data, [id]: next }
  }
  if (v && typeof v === 'object' && typeof (v as { current?: unknown }).current === 'number') {
    const o = v as { current: number; max?: unknown }
    const top = typeof o.max === 'number' ? o.max : max
    const next = Math.max(0, top !== undefined ? Math.min(top, o.current + delta) : o.current + delta)
    return { ...data, [id]: { ...o, current: next } }
  }
  return null
}

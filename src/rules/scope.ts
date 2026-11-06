/**
 * Builds the identifier scope for a character: sheet data paths, bare
 * attribute/resource ids resolving to their `current` value, condition
 * modifiers applied to attributes, and derived helpers (`name`, `weapon`,
 * `armor`) that the pack's skills can rely on.
 */
import type { Character } from '@/core/doc'
import type { LoadedPack } from './index'
import { getPath, type Scope } from './expr'

export interface InventoryItem {
  name: string
  /** Grid cells occupied (1 or 2); size-2 items span two adjacent cells in one row. */
  size?: number
  /** Preferred slot zone; matched against the sheet's slot labels (case-insensitive substring). */
  slot?: string
  /** Dice formula rolled by the attack skill, e.g. "d6". */
  damage?: string
  /** Damage reduction while worn. */
  armor?: number
  /** Usage marks left, for consumables. */
  usage?: number
  [k: string]: unknown
}

/** Marker stored in the second cell of a size-2 item. */
export interface Continuation {
  continuationOf: number
}

export type InventorySlot = InventoryItem | Continuation | null

export const isContinuation = (v: unknown): v is Continuation =>
  typeof v === 'object' && v !== null && 'continuationOf' in v
export const isItem = (v: unknown): v is InventoryItem =>
  typeof v === 'object' && v !== null && !isContinuation(v) && typeof (v as InventoryItem).name === 'string'

export const UNARMED: InventoryItem = { name: 'Unarmed', damage: 'd4' }

/** The grid array declared by the sheet's first inventory-grid field. */
export function inventoryField(pack: LoadedPack): { bind: string; cols: number; rows: number; slotLabels: string[] } {
  for (const s of pack.sheet.sections)
    for (const f of s.fields)
      if (f.kind === 'inventory-grid') return { bind: f.bind, cols: f.cols, rows: f.rows, slotLabels: f.slotLabels ?? [] }
  return { bind: 'inventory', cols: 2, rows: 5, slotLabels: [] }
}

export function inventoryOf(data: Record<string, unknown>, pack: LoadedPack): InventorySlot[] {
  const v = data[inventoryField(pack).bind]
  return Array.isArray(v) ? (v as InventorySlot[]) : []
}

/** Sum of attribute modifiers from the character's active conditions. */
export function conditionModifier(data: Record<string, unknown>, pack: LoadedPack, attr: string): number {
  const active = data.conditions
  if (!Array.isArray(active)) return 0
  let total = 0
  for (const id of active) {
    const def = pack.conditions.find((c) => c.id === id)
    total += def?.modifiers?.[attr] ?? 0
  }
  return total
}

export function characterScope(c: Character, pack: LoadedPack): Scope {
  const data = c.data
  const attrIds = new Set(pack.attributes.map((a) => a.id))
  return (path) => {
    if (path.length === 0) return undefined
    let v = getPath(data, path)
    const root = path[0]
    // Bare id of a { current, max } object reads as its current value.
    if (path.length === 1 && v && typeof v === 'object' && 'current' in (v as object)) v = (v as { current: unknown }).current
    if (v === undefined) {
      if (root === 'name' && path.length === 1) return c.name
      if (root === 'armor') return path.length === 1 ? totalArmor(data, pack) : undefined
      if (root === 'weapon') return getPath(equippedWeapon(data, pack), path.slice(1))
      return undefined
    }
    if (attrIds.has(root) && typeof v === 'number' && (path.length === 1 || (path.length === 2 && path[1] === 'current')))
      return v + conditionModifier(data, pack, root)
    return v
  }
}

export function totalArmor(data: Record<string, unknown>, pack: LoadedPack): number {
  let total = 0
  for (const slot of inventoryOf(data, pack)) if (isItem(slot) && typeof slot.armor === 'number') total += slot.armor
  return total
}

/** First carried item with a damage formula (paws come first in the grid), else unarmed. */
export function equippedWeapon(data: Record<string, unknown>, pack: LoadedPack): InventoryItem {
  for (const slot of inventoryOf(data, pack)) if (isItem(slot) && typeof slot.damage === 'string') return slot
  return UNARMED
}

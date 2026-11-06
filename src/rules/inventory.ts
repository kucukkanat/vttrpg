/**
 * Slot-grid inventory placement. The grid is a flat array of `cols * rows`
 * cells; labeled cells (paws, body) are zones that items can prefer via their
 * `slot` hint, unlabeled cells are general storage. Size-2 items take two
 * adjacent cells of one row.
 */
import { isContinuation, isItem, type InventoryItem, type InventorySlot } from './scope'

export interface GridSpec {
  cols: number
  rows: number
  slotLabels: string[]
}

export function emptyGrid(spec: GridSpec): InventorySlot[] {
  return new Array<InventorySlot>(spec.cols * spec.rows).fill(null)
}

function zoneMatches(spec: GridSpec, index: number, hint: string | undefined): boolean {
  const label = spec.slotLabels[index]
  if (hint === undefined) return label === undefined
  return label !== undefined && label.toLowerCase().includes(hint.toLowerCase())
}

function fits(grid: InventorySlot[], spec: GridSpec, index: number, size: number, hint: string | undefined): boolean {
  if (index + size > grid.length) return false
  const row = Math.floor(index / spec.cols)
  for (let k = 0; k < size; k++) {
    const i = index + k
    if (grid[i] !== null && grid[i] !== undefined) return false
    if (Math.floor(i / spec.cols) !== row) return false
    if (!zoneMatches(spec, i, hint)) return false
  }
  return true
}

/**
 * Places an item into the first fitting cells: its preferred zone first, then
 * general storage, then anywhere. Returns the index used or -1 when full.
 */
export function placeItem(grid: InventorySlot[], spec: GridSpec, item: InventoryItem): number {
  const size = item.size === 2 ? 2 : 1
  const attempts: ((i: number) => boolean)[] = []
  if (item.slot !== undefined) attempts.push((i) => fits(grid, spec, i, size, item.slot))
  attempts.push((i) => fits(grid, spec, i, size, undefined))
  attempts.push((i) => fitsAnywhere(grid, spec, i, size))
  for (const ok of attempts) {
    for (let i = 0; i < grid.length; i++) {
      if (!ok(i)) continue
      grid[i] = { ...item }
      for (let k = 1; k < size; k++) grid[i + k] = { continuationOf: i }
      return i
    }
  }
  return -1
}

function fitsAnywhere(grid: InventorySlot[], spec: GridSpec, index: number, size: number): boolean {
  if (index + size > grid.length) return false
  const row = Math.floor(index / spec.cols)
  for (let k = 0; k < size; k++) {
    const i = index + k
    if (grid[i] !== null && grid[i] !== undefined) return false
    if (Math.floor(i / spec.cols) !== row) return false
  }
  return true
}

/** Places each item in turn; items that do not fit are returned. */
export function placeItems(grid: InventorySlot[], spec: GridSpec, items: unknown[]): InventoryItem[] {
  const overflow: InventoryItem[] = []
  for (const raw of items) {
    if (!isItem(raw)) continue
    if (placeItem(grid, spec, raw) < 0) overflow.push(raw)
  }
  return overflow
}

/** Items only (no continuation markers or empty cells). */
export function listItems(grid: InventorySlot[]): InventoryItem[] {
  return grid.filter((s): s is InventoryItem => isItem(s) && !isContinuation(s))
}

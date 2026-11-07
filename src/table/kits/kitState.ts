/**
 * Local, never-synced state of the Kit tools: the kit and pieces in hand, the tool, the turn, the
 * level being built and the cutaway. The Kit tab drives it; the table's KitTool acts on it. While
 * a kit tool is active the build tool is `kit` (buildState.ts), so the prop keys, box-select and
 * the other build tools stand down.
 */
import { create } from 'zustand'
import type { KitSlot } from '@/core/kits'
import { useBuildUi } from '../build/buildState'

export type KitTool =
  /** Drag a rectangle of floor. */
  | 'floor'
  /** Drag along cell edges; joins pick corner, tee and cross pieces. Shift (or `outline`): a room outline. */
  | 'wall'
  /** Click a wall edge to put a door or window in it. */
  | 'door'
  | 'window'
  /** Click a cell: stairs up to the next level. */
  | 'stair'
  /** Click: one roof piece; drag a rectangle: roof the room. */
  | 'roof'
  /** Click a vertex: a pillar (or another vertex piece). */
  | 'pillar'
  /** Drag a rectangle or click a piece to remove it. */
  | 'erase'
  /** Click a piece to take it in hand. */
  | 'pick'

/** The manifest slot a tool places. */
export const TOOL_SLOT: Partial<Record<KitTool, KitSlot>> = {
  floor: 'floor', door: 'door', window: 'window', stair: 'stair', roof: 'roof', pillar: 'pillar',
}

/** The tool that places pieces of a slot. */
export function toolForSlot(slot: KitSlot): KitTool {
  switch (slot) {
    case 'floor': return 'floor'
    case 'wall': return 'wall'
    case 'door': return 'door'
    case 'window': return 'window'
    case 'stair': return 'stair'
    case 'roof': return 'roof'
    default: return 'pillar'
  }
}

export interface KitUiState {
  /** Kit in hand (manifest id). */
  kit: string
  /** The piece picked for each slot (piece ids of `kit`); unset slots use the kit's defaults. */
  pieces: Partial<Record<KitSlot, string>>
  /** A decor wall picked from the palette: the wall tool places it on one edge instead of painting. */
  wallPiece: string | null
  tool: KitTool | null
  /** Quarter turns of the piece in hand (R). */
  rot: number
  /** The level being built on. */
  level: number
  /** Highest level drawn; null follows the selected token (or the build level while building). */
  cutaway: number | null
  /** Wall tool draws a room outline on every drag. */
  outline: boolean
  set(partial: Partial<Omit<KitUiState, 'set'>>): void
}

export const useKitUi = create<KitUiState>((set) => ({
  kit: 'kaykit-dungeon',
  pieces: {},
  wallPiece: null,
  tool: null,
  rot: 0,
  level: 0,
  cutaway: null,
  outline: false,
  set: (partial) => set(partial),
}))

/** Pick a kit tool (the same one again puts it away). The build tool follows. */
export function setKitTool(tool: KitTool | null): void {
  const s = useKitUi.getState()
  const next = s.tool === tool ? null : tool
  s.set({ tool: next })
  useBuildUi.getState().set({ tool: next ? 'kit' : useBuildUi.getState().tool === 'kit' ? null : useBuildUi.getState().tool })
}

/** True while a kit tool owns the board. */
export function kitToolActive(): boolean {
  return useBuildUi.getState().tool === 'kit' && useKitUi.getState().tool !== null
}

/** Build one level up or down (PgUp / PgDn, the scene bar's ▲ ▼); a cutaway set by hand follows. */
export function stepLevel(by: number): void {
  const s = useKitUi.getState()
  const level = Math.max(0, Math.min(31, s.level + by))
  s.set({ level, ...(s.cutaway !== null ? { cutaway: level } : {}) })
}

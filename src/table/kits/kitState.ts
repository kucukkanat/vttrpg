/**
 * Local, never-synced state of the Kit tools: the kit and pieces in hand, the tool, the turn, the
 * level being built and the cutaway. The Kit tab drives it; the table's KitTool acts on it. While
 * a kit tool is active the build tool is `kit` (buildState.ts), so the prop keys, box-select and
 * the other build tools stand down.
 */
import { create } from 'zustand'
import type { KitManifest, KitPiece, KitSlot } from '@/core/kits'
import { useBuildUi } from '../build/buildState'
import { isPlainWall } from './autoJoin'

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

/** The kit tool a piece arms: its slot's tool; a plain corner joins walls, so it arms the wall tool. */
export function toolForPiece(manifest: KitManifest, piece: KitPiece): KitTool {
  return piece.slot === 'corner' && isPlainWall({ piece, manifest }) ? 'wall' : toolForSlot(piece.slot)
}

/**
 * Arm the kit paint tool with `piece` (a Library kit card or the Kit palette): the kit and the
 * piece go in hand and the slot's tool is picked, never toggled off. A decor wall is placed one
 * edge at a time; a plain wall paints joined runs.
 */
export function armKitPiece(manifest: KitManifest, piece: KitPiece): KitTool {
  const s = useKitUi.getState()
  const plain = isPlainWall({ piece, manifest })
  const sameKit = s.kit === manifest.id
  const pieces = { ...(sameKit ? s.pieces : {}), [piece.slot]: piece.id }
  const wallPiece = piece.slot === 'wall' ? (plain ? null : piece.id) : sameKit ? s.wallPiece : null
  const tool = toolForPiece(manifest, piece)
  s.set({ kit: manifest.id, pieces, wallPiece, tool })
  useBuildUi.getState().set({ tool: 'kit' })
  return tool
}

/** True when `piece` is what the active kit tool places. */
export function pieceInHand(s: Pick<KitUiState, 'kit' | 'pieces' | 'wallPiece'>, active: KitTool | null, manifest: KitManifest, piece: KitPiece): boolean {
  if (!active || s.kit !== manifest.id) return false
  if (active === 'wall') return s.wallPiece ? s.wallPiece === piece.id : false
  const slot = TOOL_SLOT[active]
  if (!slot || (piece.slot !== slot && !(active === 'pillar' && piece.slot === 'corner'))) return false
  return (s.pieces[piece.slot] ?? '') === piece.id
}

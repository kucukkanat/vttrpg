/**
 * Local, never-synced state of the GM's build tools (the Build panel drives it, `BuildLayer`
 * inside the canvas acts on it). Kept apart from `tableState` so the table's own UI state stays
 * small; the HUD's ruler and ping and the build tools exclude each other.
 */
import { create } from 'zustand'
import type { PrefabId, SceneId } from '@/core/ids'
import type { WallSegment } from '../walls'
import { DEFAULT_SCATTER_RANGE, DEFAULT_SNAP_CELLS, NO_SCATTER, rollScatter, type HeldModel, type ScatterRoll } from './placement'

export type BuildTool =
  /** Drag to draw a wall; ends snap to cell corners and to existing wall ends. */
  | 'wall'
  /** Same, drawing a door. Tap a door on the table to open or close it. */
  | 'door'
  /** Tap or drag over walls and doors to remove them (imported walls too). */
  | 'erase'
  /** Fog brush: paint cells explored, or back into fog. */
  | 'fog-reveal'
  | 'fog-hide'
  /** Tap to place a light. */
  | 'light'
  /** Drag a rectangle; its props and walls become a prefab. */
  | 'prefab-capture'
  /** Tap to stamp `stamp.prefab` (R turns it). */
  | 'prefab-stamp'
  /** Holding a model from the library: its ghost follows the cursor, a click stamps one (`held`). */
  | 'place'
  /** The eyedropper: the next prop clicked on the board is picked up, with its turn and scale. */
  | 'eyedropper'
  /** A grid kit tool (kits/kitState.ts says which). */
  | 'kit'

/** Walls proposed by detection, waiting for the GM to accept or discard them. */
export interface WallProposal {
  scene: SceneId
  walls: WallSegment[]
}

export interface BuildUiState {
  tool: BuildTool | null
  /** Fog brush radius in cells (0 = one cell). */
  brush: number
  /** New lights get these. */
  lightRadius: number
  lightColor: string
  stamp: { prefab: PrefabId; turns: number } | null
  /** Draw every wall over the table even with no tool active (GM). */
  showWalls: boolean
  proposal: WallProposal | null
  /** GM: publish the camera so table displays can follow it. */
  shareView: boolean
  /** The model in hand while `tool` is 'place'. */
  held: HeldModel | null
  /** The held model's turn, radians (R / wheel: 15°, Shift: 90°). */
  yaw: number
  /** Snap step in cells; 0 is free placement. Alt held is always free. */
  snapCells: number
  /** Scatter: every stamp gets a random turn and a scale within ±`scatterRange`. */
  scatter: boolean
  scatterRange: number
  /** The scatter of the next stamp, so the ghost shows exactly what a click places. */
  roll: ScatterRoll
  /** A library card being dragged over the board (HTML drag and drop). */
  dragging: HeldModel | null
  set(partial: Partial<Omit<BuildUiState, 'set'>>): void
}

export const useBuildUi = create<BuildUiState>((set) => ({
  tool: null,
  brush: 1,
  lightRadius: 6,
  lightColor: '#ffb35c',
  stamp: null,
  showWalls: false,
  proposal: null,
  shareView: false,
  held: null,
  yaw: 0,
  snapCells: DEFAULT_SNAP_CELLS,
  scatter: false,
  scatterRange: DEFAULT_SCATTER_RANGE,
  roll: NO_SCATTER,
  dragging: null,
  set: (partial) => set(partial),
}))

/** Pick a tool (the same one again puts it away). Picking any tool puts the HUD's ruler or ping away. */
export function toggleBuildTool(tool: BuildTool): void {
  const s = useBuildUi.getState()
  s.set({ tool: s.tool === tool ? null : tool })
}

/** The next scatter roll (or none while scatter is off). */
export function nextRoll(s: Pick<BuildUiState, 'scatter' | 'scatterRange'> = useBuildUi.getState()): ScatterRoll {
  return s.scatter ? rollScatter(Math.random, s.scatterRange) : NO_SCATTER
}

/**
 * Take a model in hand: the ghost follows the cursor until Esc, right-click or another tool.
 * A card starts unturned; the eyedropper passes the prop's own turn.
 */
export function pickUpModel(held: HeldModel, yaw = 0): void {
  const s = useBuildUi.getState()
  s.set({ tool: 'place', held, yaw, roll: nextRoll(s) })
}

/** Put the held model down (Esc, right-click). */
export function putDownModel(): void {
  const s = useBuildUi.getState()
  if (s.tool === 'place' || s.tool === 'eyedropper') s.set({ tool: null })
}

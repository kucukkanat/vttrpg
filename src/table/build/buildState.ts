/**
 * Local, never-synced state of the GM's build tools (the Build panel drives it, `BuildLayer`
 * inside the canvas acts on it). Kept apart from `tableState` so the table's own UI state stays
 * small; the HUD's ruler and ping and the build tools exclude each other.
 */
import { create } from 'zustand'
import type { PrefabId, SceneId } from '@/core/ids'
import type { WallSegment } from '../walls'

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
  set: (partial) => set(partial),
}))

/** Pick a tool (the same one again puts it away). Picking any tool puts the HUD's ruler or ping away. */
export function toggleBuildTool(tool: BuildTool): void {
  const s = useBuildUi.getState()
  s.set({ tool: s.tool === tool ? null : tool })
}

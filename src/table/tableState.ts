/**
 * Local, never-synced UI state of the table (hover, drag ghost, camera toggles). Separate from
 * the game store so it never leaks into the shared document.
 */
import { create } from 'zustand'
import type { CameraMode } from '@/core/doc'
import type { TokenId } from '@/core/ids'

export interface DragGhost {
  token: TokenId
  /** Snapped world position of the ghost. */
  x: number
  z: number
}

export interface TableUiState {
  hovered: TokenId | null
  /** Token under a pressed pointer, before it has moved far enough to count as a drag. */
  grab: TokenId | null
  drag: DragGhost | null
  firstPerson: boolean
  /** Local override of the scene's camera mode (C key); null follows the scene. */
  cameraOverride: CameraMode | null
  showGrid: boolean
  set(partial: Partial<Omit<TableUiState, 'set'>>): void
}

export const useTableUi = create<TableUiState>((set) => ({
  hovered: null,
  grab: null,
  drag: null,
  firstPerson: false,
  cameraOverride: null,
  showGrid: true,
  set: (partial) => set(partial),
}))

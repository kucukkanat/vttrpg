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

/** Derived highlights while a skill is being aimed; written by the targeting layer, read by tokens. */
export interface TargetingUi {
  source: TokenId
  /** Tokens inside the previewed shape. */
  inside: ReadonlySet<TokenId>
  /** Tokens the shape could reach at all; the rest render dimmed. */
  inRange: ReadonlySet<TokenId>
  /** For 'single': the token under the pointer. */
  hovered: TokenId | null
  /** Touch: the pick waiting for the confirm button. */
  candidate: { targets: TokenId[]; point: { x: number; y: number; z: number } } | null
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
  /** Cells the local viewer can currently see; null when fog is off (everything visible). */
  visible: ReadonlySet<string> | null
  /** Non-null while the host is aiming a skill on the table. */
  targeting: TargetingUi | null
  set(partial: Partial<Omit<TableUiState, 'set'>>): void
}

export const useTableUi = create<TableUiState>((set) => ({
  hovered: null,
  grab: null,
  drag: null,
  firstPerson: false,
  cameraOverride: null,
  showGrid: true,
  visible: null,
  targeting: null,
  set: (partial) => set(partial),
}))

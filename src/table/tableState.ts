/**
 * Local, never-synced UI state of the table (hover, drag ghost, camera toggles, edit mode).
 * Separate from the game store so it never leaks into the shared document.
 */
import { create } from 'zustand'
import type { CameraMode } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import type { PropId, SceneId, TokenId } from '@/core/ids'
import type { Selection } from '@/state/store'
import type { GizmoMode, NodeBase } from './editing'
import type { WallSegment } from './walls'

export interface DragGhost {
  token: TokenId
  /** Snapped world position of the ghost. */
  x: number
  z: number
}

/**
 * A move the player made while the GM was away: the intent sits in the connection's queue and
 * the token stays at the dragged spot with a ghost look until the document catches up (the GM
 * applied it) or the queue drops it. `from` is the committed position when the move was queued,
 * so any later change to the document position ends the pending state.
 */
export interface PendingMove {
  x: number
  z: number
  from: { x: number; z: number }
  /** Local clock (ms) after which the ghost snaps back on its own. */
  until: number
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

/**
 * Transform of the selected object while a gizmo handle or prop drag is in progress. Renderers
 * show it instead of the committed document values; the intent is sent on release.
 * `position` has the same meaning as the stored one (token/prop position, node local position,
 * scene offset); `elevation` only applies to tokens.
 */
export interface EditPreview {
  target: Selection
  position: Vec3
  rotationY: number
  scale: number
  elevation?: number
}

export interface TableUiState {
  hovered: TokenId | null
  /** Token under a pressed pointer, before it has moved far enough to count as a drag. */
  grab: TokenId | null
  drag: DragGhost | null
  /** Moves queued behind an away GM, by token (see `PendingMove`). */
  pending: Record<TokenId, PendingMove>
  firstPerson: boolean
  /** Local override of the scene's camera mode (C key); null follows the scene. */
  cameraOverride: CameraMode | null
  showGrid: boolean
  /** Cells the local viewer can currently see; null when fog is off (everything visible). */
  visible: ReadonlySet<string> | null
  /** Non-null while the host is aiming a skill on the table. */
  targeting: TargetingUi | null
  /** GM edit mode: gizmo on the selection, scene nodes selectable. */
  editMode: boolean
  /** Snap gizmo translation / rotation / scale to steps (Alt held = free). */
  snap: boolean
  gizmoMode: GizmoMode
  /** A gizmo handle or a prop is being dragged: camera controls stay off. */
  editDrag: boolean
  editPreview: EditPreview | null
  /** Base (un-overridden) local transform of the selected scene node, for the panel. */
  nodeBase: ({ name: string } & NodeBase) | null
  /** Footprints of solid props, merged into the line-of-sight walls. */
  propWalls: Record<PropId, WallSegment[]>
  /**
   * One-shot request to frame the camera on a token ("Find me", claim). `n` makes repeated requests
   * for the same token distinct; the camera rig clears it once handled.
   */
  focusRequest?: { id: TokenId; n: number }
  focusToken(id: TokenId): void
  /**
   * What the camera rig is actually doing, for the HUD: `mode` is the effective mode (token mode
   * falls back to orbit without a token to follow), `canFollow` whether a follow target exists.
   * Null while no table is mounted.
   */
  cameraActive: { mode: CameraMode; canFollow: boolean } | null
  /** Scenes whose model failed to load on this client, with the reason; cleared when a load succeeds. */
  sceneErrors: Record<SceneId, string>
  set(partial: Partial<Omit<TableUiState, 'set' | 'focusToken'>>): void
}

export const useTableUi = create<TableUiState>((set) => ({
  hovered: null,
  grab: null,
  drag: null,
  pending: {} as Record<TokenId, PendingMove>,
  firstPerson: false,
  cameraOverride: null,
  showGrid: true,
  visible: null,
  targeting: null,
  editMode: false,
  snap: true,
  gizmoMode: 'translate',
  editDrag: false,
  editPreview: null,
  nodeBase: null,
  propWalls: {} as Record<PropId, WallSegment[]>,
  focusToken: (id) => set((s) => ({ focusRequest: { id, n: (s.focusRequest?.n ?? 0) + 1 } })),
  cameraActive: null,
  sceneErrors: {} as Record<SceneId, string>,
  set: (partial) => set(partial),
}))

/** Ask the camera rig to frame `id` (orbit: glide the view onto it; token mode: it is followed already). */
export function focusToken(id: TokenId): void {
  useTableUi.getState().focusToken(id)
}

/** Marks `token` as moved-but-waiting; the controller calls this after the connection queued the move. */
export function setPendingMove(token: TokenId, move: PendingMove): void {
  useTableUi.setState((s) => ({ pending: { ...s.pending, [token]: move } }))
}

/** Ends the pending state of `token` (document caught up, queue expired, or nothing to clear). */
export function clearPendingMove(token: TokenId): void {
  useTableUi.setState((s) => {
    if (!(token in s.pending)) return s
    const pending = { ...s.pending }
    delete pending[token]
    return { pending }
  })
}

/** Record (or with `error` null, clear) a scene model load failure for the Scenes list and the table banner. */
export function setSceneError(scene: SceneId, error: string | null): void {
  const { sceneErrors, set } = useTableUi.getState()
  if (error === null ? !(scene in sceneErrors) : sceneErrors[scene] === error) return
  const next = { ...sceneErrors }
  if (error === null) delete next[scene]
  else next[scene] = error
  set({ sceneErrors: next })
}

/**
 * Non-reactive values the canvas publishes for hosts (where the camera looks, where the scene
 * is), so a panel can place a new prop somewhere sensible without subscribing to the render loop.
 */
export const tableRuntime: { cameraTarget: Vec3 | null; sceneCenter: Vec3 | null; floorY: number } = {
  cameraTarget: null,
  sceneCenter: null,
  floorY: 0,
}

/** Where a newly added object should appear: the camera target, else the scene centre. */
export function placementPoint(): Vec3 {
  const p = tableRuntime.cameraTarget ?? tableRuntime.sceneCenter ?? { x: 0, y: tableRuntime.floorY, z: 0 }
  return { x: p.x, y: tableRuntime.floorY, z: p.z }
}

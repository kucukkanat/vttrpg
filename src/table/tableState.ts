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
import type { PropPose } from './build/groupTransform'
import type { TransformEntry } from './build/transformKeys'
import type { ScreenRect } from './build/boxSelect'
import type { WallSegment } from './walls'

export interface DragGhost {
  token: TokenId
  /** Snapped world position of the ghost. */
  x: number
  z: number
  /** Committed position of the token when the drag started; other selected tokens follow by the same delta. */
  from: { x: number; z: number }
}

/** A token context menu request: which token, and where on screen (viewport pixels) it was asked for. */
export interface ContextMenuRequest {
  token: TokenId
  x: number
  y: number
  /** Opened by a long-press: a radial ring of big buttons around the finger instead of the list. */
  radial?: boolean
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
  /** Template colour (telegraph.ts); tokens inside ring in it. Absent: the hostile red-orange. */
  color?: string
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
  /** Props: the per-axis scale the preview shows (`scale` is its uniform handle value). */
  scaleVec?: Vec3
  elevation?: number
}

/**
 * The fade between scenes, for everyone on the table (`SceneTransition`):
 * - `out`: the table fades to black with the next scene's name over it;
 * - `swap`: black; the next scene is mounted and loading;
 * - `in`: the new scene has loaded and the black fades away.
 * `to` is the scene being shown next; `name` its title for the overlay. Null when nothing is in flight.
 */
export interface SceneTransition {
  to: SceneId
  name: string
  phase: SceneTransitionPhase
}
export type SceneTransitionPhase = 'out' | 'swap' | 'in'

/** What moves the transition on; see `stepSceneTransition`. */
export type SceneTransitionEvent =
  /** The scene to show changed (live scene switched, preview started or ended). */
  | { type: 'change'; to: SceneId; name: string }
  /** The fade to black finished: the table can swap scenes unseen. */
  | { type: 'covered' }
  /** `scene` finished loading (or failed, so its error banner should show). */
  | { type: 'loaded'; scene: SceneId }
  /** The fade back in finished. */
  | { type: 'revealed' }
/** Floor tools from the HUD: 'ruler' measures distances, 'ping' arms one ping for the next tap. */
export type TableTool = 'ruler' | 'ping'

export interface TableUiState {
  hovered: TokenId | null
  /** Token under a pressed pointer, before it has moved far enough to count as a drag. */
  grab: TokenId | null
  drag: DragGhost | null
  /** Right-click / long-press menu on a token (shell/ContextMenu.tsx renders it); null when closed. */
  contextMenu: ContextMenuRequest | null
  /** Touch "Select" mode: taps add tokens to the selection instead of replacing it. */
  multiSelect: boolean
  /** Moves queued behind an away GM, by token (see `PendingMove`). */
  pending: Record<TokenId, PendingMove>
  /** Eyes: first person from the selected (or own) token; otherwise the camera orbits the table. */
  firstPerson: boolean
  /**
   * Tactical view: the orbit camera looks straight down and turns in 45° steps (`tacticalTurn`).
   * Toggled by the HUD, the T key, or by zooming out against the orbit camera's limit.
   */
  tactical: boolean
  /** Tactical view heading in 45° steps from the default (south) heading; Q / E turn it. */
  tacticalTurn: number
  showGrid: boolean
  /** Cells the local viewer can currently see; null when fog is off (everything visible). */
  visible: ReadonlySet<string> | null
  /** Non-null while the host is aiming a skill on the table. */
  targeting: TargetingUi | null
  /** Active floor tool (HUD buttons, M key); null while the pointer selects and drags as usual. */
  tool: TableTool | null
  /** GM edit mode: gizmo on the selection, scene nodes selectable. */
  editMode: boolean
  /** Snap gizmo translation / rotation / scale to steps (Alt held = free). */
  snap: boolean
  /** What typed numbers and the highlighted gizmo handle act on; Tab cycles it (props). */
  gizmoMode: GizmoMode
  /**
   * The GM's Edit toggle is on (the shell publishes it; ui/shell/editMode.ts): props can be
   * selected and moved, a prop selection gets the gizmo and the power keys, and dragging empty
   * board draws a selection box (mouse). Off, props ignore the GM's pointer (propPointer.ts).
   * Always false for players.
   */
  buildMode: boolean
  /** Advanced gizmo for props: 3-axis rings, per-axis scale, numeric inspector (A, edit bar). */
  advanced: boolean
  /** Axes of the advanced gizmo: the world's, or the primary prop's own. */
  gizmoSpace: 'world' | 'local'
  /** A number being typed after X / Y / Z (power keys); null otherwise. */
  transformEntry: TransformEntry | null
  /** Poses the selected props show while a group transform is in progress (committed on release). */
  propPreview: Record<PropId, PropPose> | null
  /** Box select in progress: the rectangle in pixels relative to the table's top-left corner. */
  boxSelect: ScreenRect | null
  /** Prop menu (right-click, long-press): which prop and where on screen (viewport pixels). */
  propMenu: { prop: PropId; x: number; y: number; radial?: boolean } | null
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
   * One-shot request to glide the orbit camera to a pose (GM "pull everyone", a display following
   * the GM); `pose` null frames the whole scene. The camera rig clears it once handled.
   */
  viewRequest?: { n: number; pose: { pos: Vec3; target: Vec3 } | null }
  /**
   * What the camera rig is actually doing, for the HUD: `mode` is the effective mode (token mode
   * falls back to orbit without a token to follow), `canFollow` whether a follow target exists.
   * Null while no table is mounted.
   */
  cameraActive: { mode: CameraMode; canFollow: boolean } | null
  /** Scenes whose model failed to load on this client, with the reason; cleared when a load succeeds. */
  sceneErrors: Record<SceneId, string>
  /** The fade between scenes in progress on this client; null when the table is settled. */
  transition: SceneTransition | null
  /**
   * GM only, never synced: the scene this client shows instead of the live one, so the GM can look
   * at a scene before switching everyone to it. Cleared when it goes live or is removed.
   */
  previewScene: SceneId | null
  /**
   * Reach of a skill chip the pointer is on (hover, focus, or a finger held on it): a ring of
   * `cells` around `source` on the floor (`RangePreview`); 0 highlights just the token. Null otherwise.
   */
  previewRange: { source: TokenId; cells: number } | null
  set(partial: Partial<Omit<TableUiState, 'set' | 'focusToken'>>): void
}

export const useTableUi = create<TableUiState>((set) => ({
  hovered: null,
  grab: null,
  drag: null,
  contextMenu: null,
  multiSelect: false,
  pending: {} as Record<TokenId, PendingMove>,
  firstPerson: false,
  tactical: false,
  tacticalTurn: 0,
  showGrid: true,
  visible: null,
  targeting: null,
  tool: null,
  editMode: false,
  snap: true,
  gizmoMode: 'translate',
  buildMode: false,
  advanced: false,
  gizmoSpace: 'world',
  transformEntry: null,
  propPreview: null,
  boxSelect: null,
  propMenu: null,
  editDrag: false,
  editPreview: null,
  nodeBase: null,
  propWalls: {} as Record<PropId, WallSegment[]>,
  focusToken: (id) => set((s) => ({ focusRequest: { id, n: (s.focusRequest?.n ?? 0) + 1 } })),
  cameraActive: null,
  sceneErrors: {} as Record<SceneId, string>,
  transition: null,
  previewScene: null,
  previewRange: null,
  set: (partial) => set(partial),
}))

/**
 * The scene transition state machine, as a pure step so it can be tested without timers:
 * null --change--> out --covered--> swap --loaded(to)--> in --revealed--> null.
 * A `change` while a fade is running retargets it: during `out` and `swap` the fade keeps going
 * towards the new scene; during `in` the table fades out again. Events that do not apply to the
 * current phase (a stale `loaded` for another scene, a late `revealed`) leave the state as it is,
 * and the same object comes back when nothing changed so subscribers do not re-render.
 */
export function stepSceneTransition(t: SceneTransition | null, e: SceneTransitionEvent): SceneTransition | null {
  switch (e.type) {
    case 'change': {
      const phase: SceneTransitionPhase = t === null || t.phase === 'in' ? 'out' : t.phase
      if (t && t.to === e.to && t.name === e.name && t.phase === phase) return t
      return { to: e.to, name: e.name, phase }
    }
    case 'covered':
      return t?.phase === 'out' ? { ...t, phase: 'swap' } : t
    case 'loaded':
      return t?.phase === 'swap' && t.to === e.scene ? { ...t, phase: 'in' } : t
    case 'revealed':
      return t?.phase === 'in' ? null : t
  }
}

/** Feed an event to the running scene transition (see `stepSceneTransition`). */
export function sceneTransitionEvent(e: SceneTransitionEvent): void {
  useTableUi.setState((s) => {
    const next = stepSceneTransition(s.transition, e)
    return next === s.transition ? s : { transition: next }
  })
}

/** Drop any transition in flight (the table has nothing to show, or was unmounted). */
export function clearSceneTransition(): void {
  if (useTableUi.getState().transition) useTableUi.setState({ transition: null })
}

/** GM: look at `scene` on this client only (null: back to the live scene). */
export function setPreviewScene(scene: SceneId | null): void {
  if (useTableUi.getState().previewScene !== scene) useTableUi.setState({ previewScene: scene })
}

export interface GroupMoveTarget {
  token: TokenId
  x: number
  z: number
}

/**
 * Where the other selected tokens land when `drag` commits: each keeps its offset from the dragged
 * token, i.e. moves by the same delta (unsnapped; callers snap with the grid). Empty unless the
 * dragged token is itself part of the selection. Tokens in other scenes and the dragged token are left out.
 */
export function groupMoveTargets(
  drag: DragGhost,
  tokens: Readonly<Record<TokenId, { id: TokenId; scene: string; position: { x: number; z: number } }>>,
  selected: readonly TokenId[],
): GroupMoveTarget[] {
  if (!selected.includes(drag.token)) return []
  const leader = tokens[drag.token]
  if (!leader) return []
  const dx = drag.x - drag.from.x
  const dz = drag.z - drag.from.z
  const out: GroupMoveTarget[] = []
  for (const id of selected) {
    if (id === drag.token) continue
    const t = tokens[id]
    if (!t || t.scene !== leader.scene) continue
    out.push({ token: id, x: t.position.x + dx, z: t.position.z + dz })
  }
  return out
}

/** Ask the camera rig to frame `id` (orbit: glide the view onto it; token mode: it is followed already). */
export function focusToken(id: TokenId): void {
  useTableUi.getState().focusToken(id)
}

/** Ask the camera rig to glide to `pose` (null: frame the whole scene). Leaves first person first. */
export function requestView(pose: { pos: Vec3; target: Vec3 } | null): void {
  useTableUi.setState((s) => ({ firstPerson: false, viewRequest: { n: (s.viewRequest?.n ?? 0) + 1, pose } }))
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
export const tableRuntime: {
  cameraTarget: Vec3 | null; cameraPosition: Vec3 | null; sceneCenter: Vec3 | null; floorY: number
  /** Where the pointer last crossed the floor plane over the table (paste lands here); null when off the table. */
  cursorFloor: Vec3 | null
} = {
  cameraTarget: null,
  cameraPosition: null,
  sceneCenter: null,
  floorY: 0,
  cursorFloor: null,
}

/** Where a newly added object should appear: the camera target, else the scene centre. */
export function placementPoint(): Vec3 {
  const p = tableRuntime.cameraTarget ?? tableRuntime.sceneCenter ?? { x: 0, y: tableRuntime.floorY, z: 0 }
  return { x: p.x, y: tableRuntime.floorY, z: p.z }
}

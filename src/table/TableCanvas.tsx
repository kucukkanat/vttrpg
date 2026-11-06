/**
 * The table: a <Canvas> showing the active scene from the store with grid, tokens, cameras,
 * lighting and fog of war. Emits intents and presence through callbacks; never touches
 * networking or rules.
 *
 * Keys: G grid, C camera mode (local override), F first person (token mode), Esc deselect.
 * Mouse: drag a token to move it (snaps to cells), click / right-click selects, drag empty
 * space to orbit, wheel to zoom, right-drag to pan. Touch: one finger drags a token or orbits,
 * two fingers pan, pinch zooms, long-press selects.
 * Targeting (`props.targeting`): see TargetingLayer. Esc cancels.
 * Edit mode (`tableState.editMode`, GM): the selection gets a gizmo (EditGizmo), scene nodes are
 * selectable, G / R / S pick translate / rotate / scale, Delete removes the selected prop.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Box3, Vector3 } from 'three'
import type { AssetRef } from '@/core/assets'
import type { CameraMode, Scene, Token } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { PlayerPubkey, SceneId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import type { Presence } from '@/core/presence'
import { useGame } from '@/state/store'
import { CameraRig } from './CameraRig'
import { canControl, defaultResolveAsset, TableContext, useTable, type TableContextValue, type ViewerInfo } from './context'
import { EditGizmo } from './EditGizmo'
import { sceneTransformMatrix, transformWalls } from './editing'
import { FogOverlay } from './FogOverlay'
import { cellKey, worldToCell, type Bounds2 } from './grid'
import { GridOverlay } from './GridOverlay'
import { Props } from './PropMesh'
import { disposeScene, loadSceneModel, type LoadedScene, type SceneValidationReport } from './sceneLoader'
import { SceneModel } from './SceneModel'
import { tableRuntime, useTableUi } from './tableState'
import { describeShape, TargetingLayer, type TargetingProps } from './TargetingLayer'
import { DragGhostMesh, TokenMesh } from './TokenMesh'
import * as vfx from './vfx'
import type { WallSegment } from './walls'

export interface TableCanvasProps {
  onIntent(intent: Intent): void
  onPresence(p: Partial<Presence>): void
  /**
   * Resolve an asset reference to a fetchable URL (object URL or https). Hosts pass their
   * asset resolver; without one the first entry of `ref.sources` is used.
   */
  resolveAsset?(ref: AssetRef): Promise<string>
  /** The local player. Omit for an all-seeing GM view (dev stories). */
  viewer?: ViewerInfo
  /** Camera mode override; defaults to the active scene's `cameraMode`. */
  cameraMode?: CameraMode
  /** Grid overlay, default on. The G key toggles it locally. */
  showGrid?: boolean
  /** Called with the loader's validation report when the scene model finishes loading. */
  onSceneLoaded?(report: SceneValidationReport): void
  /**
   * Aim a skill: the shape previews on the floor under the pointer, tokens inside light up, a tap
   * (or touch drag + confirm) calls `onPick`; Esc, Cancel or a tap on the source calls `onCancel`.
   */
  targeting?: TargetingProps
  className?: string
  style?: CSSProperties
}

// Stable objects: R3F re-applies `camera` / `gl` props whenever the object identity changes.
const CAMERA_OPTS = { fov: 50, near: 0.05, far: 500, position: [8, 8, 8] as [number, number, number] }
const GL_OPTS = { antialias: true, powerPreference: 'high-performance' as const }
const CANVAS_STYLE = { touchAction: 'none' } as const

export function TableCanvas(props: TableCanvasProps) {
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const scene = useGame((s) => (sceneId ? s.scenes[sceneId] : undefined))
  if (!sceneId || !scene) {
    return <div className={props.className} style={{ padding: 16, ...props.style }}>No active scene.</div>
  }
  return <TableInner key={sceneId} sceneId={sceneId} scene={scene} {...props} />
}

function TableInner({ sceneId, scene, onIntent, onPresence, resolveAsset, viewer, cameraMode, showGrid, onSceneLoaded, targeting, className, style }: TableCanvasProps & { sceneId: SceneId; scene: Scene }) {
  const resolve = resolveAsset ?? defaultResolveAsset
  /** Events older than the canvas are never replayed. */
  const mountedAt = useRef(Date.now()).current
  const events = useGame((s) => s.events)
  const [url, setUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<LoadedScene | null>(null)
  const [error, setError] = useState<string | null>(null)
  const uiSet = useTableUi((s) => s.set)
  const gridOn = useTableUi((s) => s.showGrid)
  const cameraOverride = useTableUi((s) => s.cameraOverride)
  const propWalls = useTableUi((s) => s.propWalls)
  const setSelection = useGame((s) => s.setSelection)
  const gm = !viewer || viewer.isGm

  useEffect(() => { uiSet({ showGrid: showGrid ?? true }) }, [showGrid, uiSet])
  useEffect(() => {
    uiSet({ cameraOverride: null, firstPerson: false, drag: null, grab: null, hovered: null, editDrag: false, editPreview: null, nodeBase: null, propWalls: {} })
  }, [sceneId, uiSet])
  // Edit mode is a GM tool; a player view never shows it.
  useEffect(() => { if (!gm) uiSet({ editMode: false }) }, [gm, uiSet])

  // Resolve the scene model to a URL. Keyed on the content hash, not the object: the store
  // recreates `scene` on every document sync and the model must not reload for a chat message.
  const model = scene.model
  const modelKey = model ? `${model.sha256}|${model.sources.join(',')}` : ''
  const modelRef = useRef(model)
  modelRef.current = model
  const resolveRef = useRef(resolve)
  resolveRef.current = resolve
  useEffect(() => {
    let live = true
    setUrl(null)
    setLoaded(null)
    setError(null)
    const m = modelRef.current
    if (!m) return // image-based or empty scene: nothing to load, the placeholder floor is used
    resolveRef.current(m).then((u) => { if (live) setUrl(u) }, (e: unknown) => { if (live) setError(`asset: ${String(e)}`) })
    return () => { live = false }
  }, [modelKey])

  const handleLoaded = useCallback((s: LoadedScene) => { setLoaded(s); onSceneLoaded?.(s.report) }, [onSceneLoaded])

  // Keyboard shortcuts.
  const cancelTargeting = targeting?.onCancel
  // The pick unmounts the targeting layer between pointerup and click, so that click would count
  // as a miss and drop the selection. Ignore misses briefly after targeting ends.
  const wasTargeting = useRef(false)
  const ignoreMissUntil = useRef(0)
  useEffect(() => {
    if (wasTargeting.current && !targeting) ignoreMissUntil.current = performance.now() + 500
    wasTargeting.current = !!targeting
  }, [targeting])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const ui = useTableUi.getState()
      if (e.key === 'Escape' && cancelTargeting) { cancelTargeting(); return }
      if (e.metaKey || e.ctrlKey) return
      switch (e.key) {
        // In edit mode G / R / S pick the gizmo mode (Blender habits); otherwise G toggles the grid.
        case 'g': case 'G': if (ui.editMode) ui.set({ gizmoMode: 'translate' }); else ui.set({ showGrid: !ui.showGrid }); break
        case 'r': case 'R': if (ui.editMode) ui.set({ gizmoMode: 'rotate' }); break
        case 's': case 'S': if (ui.editMode) ui.set({ gizmoMode: 'scale' }); break
        case 'f': case 'F': ui.set({ firstPerson: !ui.firstPerson }); break
        case 'c': case 'C': {
          const current = ui.cameraOverride ?? cameraMode ?? scene.cameraMode
          ui.set({ cameraOverride: current === 'orbit' ? 'token' : 'orbit' })
          break
        }
        case 'Delete': case 'Backspace': {
          const sel = useGame.getState().selection
          if (sel?.kind === 'prop' && gm) { e.preventDefault(); onIntent({ type: 'prop.remove', prop: sel.id }); setSelection(null) }
          break
        }
        case 'Escape': setSelection(null); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cameraMode, scene.cameraMode, setSelection, cancelTargeting, gm, onIntent])

  const grid: GridSpec = scene.grid
  // The scene's in-game transform moves the floor, the bounds and the walls along with the model.
  const transform = scene.transform
  const floorY = (loaded?.floorY ?? 0) * (transform?.scale ?? 1) + (transform?.offset.y ?? 0)
  const bounds3 = useMemo(() => {
    const b = (loaded?.bounds ?? new Box3(new Vector3(-8, 0, -8), new Vector3(8, 3, 8))).clone()
    return transform ? b.applyMatrix4(sceneTransformMatrix(transform)) : b
  }, [loaded, transform])
  const bounds2: Bounds2 = useMemo(() => {
    const pad = grid.cellSize * 0.5
    return { minX: bounds3.min.x - pad, minZ: bounds3.min.z - pad, maxX: bounds3.max.x + pad, maxZ: bounds3.max.z + pad }
  }, [bounds3, grid.cellSize])
  const walls = useMemo(
    () => [...transformWalls(loaded?.walls ?? [], transform), ...Object.values(propWalls).flat()],
    [loaded, transform, propWalls],
  )
  useEffect(() => {
    const c = bounds3.getCenter(new Vector3())
    tableRuntime.sceneCenter = { x: c.x, y: floorY, z: c.z }
    tableRuntime.floorY = floorY
  }, [bounds3, floorY])
  const weatherBounds = useMemo(
    () => ({ min: [bounds3.min.x, bounds3.min.y, bounds3.min.z] as [number, number, number], max: [bounds3.max.x, bounds3.max.y, bounds3.max.z] as [number, number, number] }),
    [bounds3],
  )

  const ctx: TableContextValue = useMemo(
    () => ({ sceneId, scene, grid, floorY, loaded, viewer: viewer ?? null, onIntent, onPresence, resolveAsset: resolve }),
    [sceneId, scene, grid, floorY, loaded, viewer, onIntent, onPresence, resolve],
  )

  const mode: CameraMode = cameraOverride ?? cameraMode ?? scene.cameraMode

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320, background: '#0b0b10', ...style }}>
      <Canvas
        shadows="percentage"
        dpr={[1, 1.5]}
        camera={CAMERA_OPTS}
        gl={GL_OPTS}
        style={CANVAS_STYLE}
        onPointerMissed={(e) => { if (e.button === 0 && !targeting && performance.now() > ignoreMissUntil.current) setSelection(null) }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <color attach="background" args={['#0b0b10']} />
        <TableContext.Provider value={ctx}>
          {url && <SceneLoaderBridge url={url} onLoaded={handleLoaded} onError={setError} />}
          <Lighting darkness={scene.darkness} />
          {loaded ? <SceneModel loaded={loaded} /> : <PlaceholderFloor bounds={bounds2} />}
          {gridOn && <GridOverlay grid={grid} bounds={bounds2} floorY={floorY} />}
          <Props sceneId={sceneId} />
          <Tokens sceneId={sceneId} viewer={viewer ?? null} />
          <FogOverlay bounds={bounds2} walls={walls} />
          {targeting && <TargetingLayer key={`${targeting.source}:${targeting.shape.kind}`} targeting={targeting} bounds={bounds2} />}
          <vfx.VfxLayer events={events} since={mountedAt} cellSize={grid.cellSize} />
          <vfx.WeatherLayer kind={scene.weather ?? 'none'} bounds={weatherBounds} />
          <EditGizmo />
          <CameraRigFromStore mode={mode} sceneId={sceneId} viewer={viewer ?? null} bounds={bounds3} floorY={floorY} cellSize={grid.cellSize} walls={walls} />
          <CameraShake cellSize={grid.cellSize} />
        </TableContext.Provider>
      </Canvas>
      {!loaded && !error && <Overlay>Loading scene…</Overlay>}
      {error && <Overlay tone="error">{error}</Overlay>}
      {targeting && <TargetingBar targeting={targeting} />}
    </div>
  )
}

/**
 * HTML controls for targeting: what is being aimed, Cancel, and on touch the Confirm button for
 * the staged pick. Big hit areas; sits at the bottom of the table above the canvas.
 */
function TargetingBar({ targeting }: { targeting: TargetingProps }) {
  const candidate = useTableUi((s) => s.targeting?.candidate ?? null)
  const uiSet = useTableUi((s) => s.set)
  const btn: CSSProperties = {
    minHeight: 44, minWidth: 96, padding: '0 18px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(40,40,48,0.92)', color: '#f3ead8', fontSize: 15, fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation',
  }
  const confirm = () => {
    if (!candidate) return
    const t = useTableUi.getState().targeting
    uiSet({ targeting: t ? { ...t, candidate: null } : null })
    targeting.onPick(candidate)
  }
  const n = candidate?.targets.length ?? 0
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 'max(12px, env(safe-area-inset-bottom, 0px))', display: 'flex', justifyContent: 'center',
      gap: 10, padding: '0 12px', pointerEvents: 'none', flexWrap: 'wrap',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 14, background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)', pointerEvents: 'auto', maxWidth: '100%',
      }}>
        <span style={{ color: '#f3ead8', fontSize: 14, padding: '0 6px', opacity: 0.9 }}>
          {candidate ? (n === 0 ? 'No one in the area' : `${n} target${n === 1 ? '' : 's'}`) : describeShape(targeting.shape)}
        </span>
        {candidate && (
          <button type="button" style={{ ...btn, background: '#e0a458', color: '#1a1612', borderColor: '#e0a458' }} onClick={confirm}>
            Confirm
          </button>
        )}
        <button type="button" style={btn} onClick={() => targeting.onCancel()}>Cancel</button>
      </div>
    </div>
  )
}

type ShakeEvent = { intensity?: number; duration?: number } | undefined
type ShakeBus = {
  on?(event: string, handler: (e: ShakeEvent) => void): unknown
  off?(event: string, handler: (e: ShakeEvent) => void): unknown
  addEventListener?(event: string, handler: (e: Event) => void): void
  removeEventListener?(event: string, handler: (e: Event) => void): void
}

/**
 * Subscribe to camera shakes from the vfx module's bus when it exports one. The vfx layer is
 * built in parallel; until `vfxBus` lands this is a no-op, so the import stays typed-optional.
 */
function subscribeShake(handler: (e: ShakeEvent) => void): () => void {
  const bus = (vfx as Record<string, unknown>).vfxBus as ShakeBus | undefined
  if (!bus) return () => {}
  if (typeof bus.on === 'function') {
    const off = bus.on('shake', handler)
    return () => { if (typeof off === 'function') off(); else bus.off?.('shake', handler) }
  }
  if (typeof bus.addEventListener === 'function') {
    const h = (e: Event) => handler((e as CustomEvent<ShakeEvent>).detail)
    bus.addEventListener('shake', h)
    return () => bus.removeEventListener?.('shake', h)
  }
  return () => {}
}

/** Brief camera jitter on `shake`; the offset is removed before the controls run and re-applied after the rig. */
function CameraShake({ cellSize }: { cellSize: number }) {
  const camera = useThree((s) => s.camera)
  const st = useRef({ until: 0, duration: 1, intensity: 0, offset: new Vector3() })
  useEffect(() => subscribeShake((e) => {
    const now = performance.now()
    const duration = Math.max(50, e?.duration ?? 300)
    st.current.until = Math.max(st.current.until, now + duration)
    st.current.duration = duration
    st.current.intensity = Math.max(st.current.intensity, e?.intensity ?? 1)
  }), [])
  useFrame(() => { camera.position.sub(st.current.offset); st.current.offset.set(0, 0, 0) }, -10)
  useFrame(() => {
    const s = st.current
    const now = performance.now()
    if (now >= s.until) { s.intensity = 0; return }
    const k = (s.until - now) / s.duration
    const amp = 0.06 * cellSize * s.intensity * k
    s.offset.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp)
    camera.position.add(s.offset)
  })
  return null
}

/** Loads the GLB inside the canvas so the renderer is available for KTX2 detection. */
function SceneLoaderBridge({ url, onLoaded, onError }: { url: string; onLoaded(s: LoadedScene): void; onError(msg: string): void }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    let live = true
    let result: LoadedScene | null = null
    loadSceneModel(url, { renderer: gl }).then(
      (s) => { if (live) { result = s; onLoaded(s) } else disposeScene(s) },
      (e: unknown) => { if (live) onError(`scene: ${e instanceof Error ? e.message : String(e)}`) },
    )
    return () => { live = false; if (result) disposeScene(result) }
  }, [url, gl, onLoaded, onError])
  return null
}

function Lighting({ darkness }: { darkness: number }) {
  const d = Math.min(1, Math.max(0, darkness))
  return (
    <>
      <ambientLight intensity={0.12 + 0.9 * (1 - d)} color="#cfd6ff" />
      <hemisphereLight intensity={0.1 + 0.6 * (1 - d)} color="#f3ead8" groundColor="#2b241c" />
    </>
  )
}

function PlaceholderFloor({ bounds }: { bounds: Bounds2 }) {
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxZ - bounds.minZ
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2]} receiveShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial color="#3a3630" roughness={1} />
    </mesh>
  )
}

function Tokens({ sceneId, viewer }: { sceneId: SceneId; viewer: ViewerInfo | null }) {
  const tokens = useGame((s) => s.tokens)
  const presence = useGame((s) => s.presence)
  const visible = useTableUi((s) => s.visible)
  const { grid } = useTable()
  // Players only see tokens standing in cells they can see (their own always).
  const list = useMemo(() => Object.values(tokens).filter((t) => {
    if (t.scene !== sceneId) return false
    if (!visible || !viewer || viewer.isGm || canControl(viewer, t)) return true
    return visible.has(cellKey(worldToCell(grid, t.position.x, t.position.z)))
  }), [tokens, sceneId, visible, viewer, grid])
  const ghosts = useMemo(
    () => Object.values(presence).filter((p) => p.dragging && p.pubkey !== viewer?.pubkey && tokens[p.dragging.token]?.scene === sceneId),
    [presence, tokens, sceneId, viewer],
  )
  return (
    <>
      {list.map((t) => <TokenMesh key={t.id} token={t} />)}
      {ghosts.map((p) => (
        <DragGhostMesh key={p.pubkey} token={tokens[p.dragging!.token]!} x={p.dragging!.position.x} z={p.dragging!.position.z} color={p.color} />
      ))}
    </>
  )
}

/** Picks the token the shoulder camera follows: selected, else owned, else the first in the scene. */
function CameraRigFromStore({ mode, sceneId, viewer, bounds, floorY, cellSize, walls }: { mode: CameraMode; sceneId: SceneId; viewer: ViewerInfo | null; bounds: Box3; floorY: number; cellSize: number; walls: readonly WallSegment[] }) {
  const tokens = useGame((s) => s.tokens)
  const selectedId = useGame((s) => s.selectedToken)
  const follow: Token | null = useMemo(() => {
    const inScene = Object.values(tokens).filter((t) => t.scene === sceneId)
    const selected = selectedId ? inScene.find((t) => t.id === selectedId) : undefined
    if (selected) return selected
    const owned = viewer ? inScene.find((t) => t.owner === viewer.pubkey) : undefined
    return owned ?? inScene[0] ?? null
  }, [tokens, sceneId, selectedId, viewer])
  return <CameraRig mode={mode} follow={follow} bounds={bounds} floorY={floorY} cellSize={cellSize} walls={walls} />
}

function Overlay({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div style={{
      position: 'absolute', left: 12, bottom: 12, padding: '6px 10px', borderRadius: 6, fontSize: 13,
      background: tone === 'error' ? 'rgba(120,30,30,0.85)' : 'rgba(0,0,0,0.55)', color: '#f3ead8', pointerEvents: 'none',
    }}>{children}</div>
  )
}

export type { ViewerInfo }
export type { TargetingProps }
export type { PlayerPubkey as TableViewerPubkey }

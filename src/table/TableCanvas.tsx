/**
 * The table: a <Canvas> showing the active scene from the store with grid, tokens, cameras,
 * lighting and fog of war. Emits intents and presence through callbacks; never touches
 * networking or rules.
 *
 * Keys: G grid, C camera mode (local override), F first person (token mode), T tactical view
 * (top-down; Q / E turn it 45°), Esc deselect, Delete removes the selected tokens (GM).
 * Mouse: drag a token to move it (snaps to cells; a selected token drags the whole selection), click
 * selects, Shift/Cmd-click adds to the selection, right-click opens the token menu, drag empty
 * space to orbit, wheel to zoom, right-drag to pan. Touch: one finger drags a token or orbits,
 * two fingers pan, pinch zooms, long-press opens the token menu. With one of your tokens selected, a tap
 * on a cell previews the move and a second tap there (or Move) commits it (MovePreview).
 * Targeting (`props.targeting`): see TargetingLayer. Esc cancels.
 * Tools (`tableState.tool`, HUD buttons): the ruler measures distances (RulerLayer, M); ping marks a
 * spot for every client (PingLayer; also a double-tap or a long touch on empty floor).
 * Edit mode (`tableState.editMode`, GM): the selection gets a gizmo (EditGizmo), scene nodes are
 * selectable, G / R / S pick translate / rotate / scale, Delete removes the selected prop.
 * Rendering follows the device's graphics preset (graphics.ts): resolution, shadows, antialiasing
 * and an idle frame-rate cap. A lost WebGL context pauses the table behind a notice and remounts
 * the canvas once the browser gives the GPU back (or on Reload).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Box3, Color, Fog, NeutralToneMapping, SRGBColorSpace, Vector3 } from 'three'
import type { AssetRef } from '@/core/assets'
import type { CameraMode, Scene, Token } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import type { Presence } from '@/core/presence'
import { useGame } from '@/state/store'
import { CameraRig } from './CameraRig'
import { ambientLevels, fogColor, fogRange } from './atmosphere'
import { canControl, defaultResolveAsset, TableContext, useTable, type TableContextValue, type ViewerInfo } from './context'
import { BuildLayer, useDrawnBlocking } from './build/BuildLayer'
import { EditGizmo } from './EditGizmo'
import { sceneTransformMatrix, transformWalls } from './editing'
import { FogOverlay } from './FogOverlay'
import { cellKey, worldToCell, type Bounds2 } from './grid'
import { frameDue, useGraphics, type GraphicsPreset } from './graphics'
import { GridOverlay } from './GridOverlay'
import { ImageFloor, type ImageFloorStatus } from './ImageFloor'
import { imageFrame } from './imageScene'
import { PingLayer, pingMissed } from './PingLayer'
import { MoveBar, moveMissed, TwoTapMoveLayer } from './MovePreview'
import { Props } from './PropMesh'
import { RangePreview } from './RangePreview'
import { DeclaredActions } from './DeclaredActions'
import { RulerLayer } from './RulerLayer'
import { describeLoadError, disposeScene, loadSceneModel, type LoadedScene, type SceneValidationReport } from './sceneLoader'
import { SceneModel } from './SceneModel'
import { ScenePreviewBar, SceneTransition } from './SceneTransition'
import { clearSceneTransition, sceneTransitionEvent, setPreviewScene, setSceneError, tableRuntime, useTableUi, focusToken } from './tableState'
import { stagedSummary, stageTargeting } from './targeting'
import { targetingWarnings, targetingOutcome } from './telegraph'
import { describeShape, TargetingLayer, type TargetingProps } from './TargetingLayer'
import './TargetingBar.css'
import { toonMaterial } from './stylize'
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
const CANVAS_STYLE = { touchAction: 'none' } as const
/**
 * Renderer options per antialias setting. Tone mapping is chosen explicitly: Khronos PBR Neutral
 * keeps the flat palette's hues and values (ACES, R3F's default, darkens and desaturates them).
 */
const GL_OPTS = {
  on: { antialias: true, powerPreference: 'high-performance', toneMapping: NeutralToneMapping, toneMappingExposure: 1, outputColorSpace: SRGBColorSpace },
  off: { antialias: false, powerPreference: 'default', toneMapping: NeutralToneMapping, toneMappingExposure: 1, outputColorSpace: SRGBColorSpace },
} as const
/** After the last input or table change, frames keep coming at the active rate this long. */
const ACTIVE_MS = 2500

/**
 * Picks the scene to show (the GM's preview, else the live scene) and runs the fade between scenes:
 * the scene on screen lags the target by the fade-out so the swap happens under black, and the
 * fade-in waits for the new scene to report it has loaded (`SceneTransition` keeps the clocks).
 */
export function TableCanvas(props: TableCanvasProps) {
  const liveId = useGame((s) => s.meta?.activeScene ?? null)
  const scenes = useGame((s) => s.scenes)
  const gm = !props.viewer || props.viewer.isGm
  const previewScene = useTableUi((s) => s.previewScene)
  const transition = useTableUi((s) => s.transition)
  // Preview is a GM tool for a scene that exists and is not live; anything else ends it.
  const preview = gm && previewScene && previewScene !== liveId && scenes[previewScene] ? previewScene : null
  useEffect(() => { if (previewScene && !preview) setPreviewScene(null) }, [previewScene, preview])
  const target = preview ?? liveId
  const [displayed, setDisplayed] = useState(target)
  const shown = displayed && scenes[displayed] ? displayed : null
  const [ready, setReady] = useState<{ scene: SceneId; ok: boolean } | null>(null)
  const onReady = useCallback((scene: SceneId, ok: boolean) => setReady({ scene, ok }), [])
  useEffect(() => {
    if (!target || !shown) {
      // Nothing to fade from or to (first scene, scene removed): show what there is at once.
      if (target !== displayed) setDisplayed(target)
      clearSceneTransition()
      return
    }
    const name = useGame.getState().scenes[target]?.name ?? ''
    if (target !== shown) {
      if (!transition || transition.to !== target) sceneTransitionEvent({ type: 'change', to: target, name })
      else if (transition.phase === 'swap') setDisplayed(target)
      return
    }
    if (!transition) return
    // Back to the scene already on screen before the fade got anywhere: retarget, then reveal.
    if (transition.to !== target) sceneTransitionEvent({ type: 'change', to: target, name })
    else if (transition.phase === 'swap' && ready?.scene === target && ready.ok) sceneTransitionEvent({ type: 'loaded', scene: target })
  }, [target, shown, displayed, transition, ready])
  useEffect(() => () => clearSceneTransition(), [])
  const { className, style, ...inner } = props
  const scene = shown ? scenes[shown] : undefined
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      {shown && scene
        ? <TableInner key={shown} sceneId={shown} scene={scene} onReady={onReady} {...inner} />
        : <div style={{ padding: 16 }}>No active scene.</div>}
      {preview && (
        <ScenePreviewBar name={scenes[preview]?.name ?? ''} onSwitch={() => props.onIntent({ type: 'scene.activate', scene: preview })} onBack={() => setPreviewScene(null)} />
      )}
      <SceneTransition transition={transition} onEvent={sceneTransitionEvent} />
    </div>
  )
}

function TableInner({ sceneId, scene, onReady, onIntent, onPresence, resolveAsset, viewer, cameraMode, showGrid, onSceneLoaded, targeting }: Omit<TableCanvasProps, 'className' | 'style'> & { sceneId: SceneId; scene: Scene; onReady(scene: SceneId, ready: boolean): void }) {
  const resolve = resolveAsset ?? defaultResolveAsset
  /** Events older than the canvas are never replayed. */
  const mountedAt = useRef(Date.now()).current
  const events = useGame((s) => s.events)
  const [url, setUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<LoadedScene | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped by Retry: resolves and loads the model again without changing the scene.
  const [modelRetry, setModelRetry] = useState(0)
  const retryModel = useCallback(() => setModelRetry((n) => n + 1), [])
  // One readable line on screen and in the Scenes list; the raw error goes to the console.
  const failLoad = useCallback((stage: string, e: unknown) => {
    console.error(`scene ${sceneId} ${stage}:`, e)
    const text = describeLoadError(e)
    setError(text)
    setSceneError(sceneId, text)
  }, [sceneId])
  const uiSet = useTableUi((s) => s.set)
  const gridOn = useTableUi((s) => s.showGrid)
  const propWalls = useTableUi((s) => s.propWalls)
  const setSelection = useGame((s) => s.setSelection)
  const gm = !viewer || viewer.isGm

  useEffect(() => { uiSet({ showGrid: showGrid ?? true }) }, [showGrid, uiSet])
  useEffect(() => {
    uiSet({ firstPerson: false, drag: null, grab: null, hovered: null, contextMenu: null, editDrag: false, editPreview: null, nodeBase: null, propWalls: {} })
  }, [sceneId, uiSet])

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
    setSceneError(sceneId, null)
    const m = modelRef.current
    if (!m) return // image-based or empty scene: nothing to load, the placeholder floor is used
    resolveRef.current(m).then((u) => { if (live) setUrl(u) }, (e: unknown) => { if (live) failLoad('asset', e) })
    return () => { live = false }
  }, [modelKey, modelRetry, sceneId, failLoad])

  const handleLoaded = useCallback((s: LoadedScene) => { setLoaded(s); setSceneError(sceneId, null); onSceneLoaded?.(s.report) }, [onSceneLoaded, sceneId])
  const handleLoadError = useCallback((e: unknown) => failLoad('model', e), [failLoad])

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
        case 'g': case 'G': ui.set({ showGrid: !ui.showGrid }); break
        case 'f': case 'F': ui.set({ firstPerson: !ui.firstPerson }); break
        case 't': case 'T': ui.set({ tactical: !ui.tactical, firstPerson: false }); break
        case 'q': case 'Q': if (ui.tactical) ui.set({ tacticalTurn: ui.tacticalTurn - 1 }); break
        case 'e': case 'E': if (ui.tactical) ui.set({ tacticalTurn: ui.tacticalTurn + 1 }); break
        case 'Delete': case 'Backspace': {
          const sel = useGame.getState().selection
          if (sel?.kind === 'prop' && gm) { e.preventDefault(); onIntent({ type: 'props.remove', ids: [sel.id] }); setSelection(null) }
          break
        }
        case 'Escape': setSelection(null); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSelection, cancelTargeting, gm, onIntent])

  // GM: Delete removes every selected token (one undoable intent each). Runs in the capture phase
  // so it clears the selection before the Tokens panel's own Delete handler sees the primary token.
  useEffect(() => {
    if (!gm) return
    const onDelete = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const s = useGame.getState()
      if (s.selectedTokens.length === 0) return
      e.preventDefault()
      for (const id of s.selectedTokens) onIntent({ type: 'token.remove', token: id })
      s.clearSelection()
    }
    window.addEventListener('keydown', onDelete, true)
    return () => window.removeEventListener('keydown', onDelete, true)
  }, [gm, onIntent])

  const grid: GridSpec = scene.grid
  // The scene's in-game transform moves the floor, the bounds and the walls along with the model.
  const transform = scene.transform
  const floorY = (loaded?.floorY ?? 0) * (transform?.scale ?? 1) + (transform?.offset.y ?? 0)
  // Image-based scenes: the map image decides the bounds (and the framing); keyed on its numbers
  // because the store recreates `scene` on every sync.
  const image = scene.image
  const imageKey = image ? `${image.widthCells},${image.heightCells},${image.offset?.x ?? 0},${image.offset?.z ?? 0},${grid.cellSize},${grid.origin.x},${grid.origin.z}` : ''
  const imageBox = useMemo(() => {
    if (!image) return null
    const f = imageFrame(grid, image)
    return new Box3(new Vector3(f.minX, 0, f.minZ), new Vector3(f.maxX, 2 * grid.cellSize, f.maxZ))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey])
  // Map image loading state for the overlay; `imageRetry` makes the floor resolve and load again.
  const [imageStatus, setImageStatus] = useState<ImageFloorStatus | null>(null)
  const [imageRetry, setImageRetry] = useState(0)
  const retryImage = useCallback(() => setImageRetry((n) => n + 1), [])
  // Everything the scene needs is on screen (or has failed and shows its banner): the fade can end.
  const ready = (!model || loaded !== null || error !== null) && (!image || (imageStatus !== null && imageStatus.kind !== 'loading'))
  useEffect(() => { onReady(sceneId, ready) }, [onReady, sceneId, ready])
  const bounds3 = useMemo(() => {
    const b = (loaded?.bounds ?? (imageBox ? null : new Box3(new Vector3(-8, 0, -8), new Vector3(8, 3, 8))))?.clone() ?? null
    const modelBox = b && transform ? b.applyMatrix4(sceneTransformMatrix(transform)) : b
    if (modelBox && imageBox) return modelBox.union(imageBox.clone().translate(new Vector3(0, floorY, 0)))
    if (imageBox) return imageBox.clone().translate(new Vector3(0, floorY, 0))
    return modelBox!
  }, [loaded, transform, imageBox, floorY])
  const bounds2: Bounds2 = useMemo(() => {
    const pad = grid.cellSize * 0.5
    return { minX: bounds3.min.x - pad, minZ: bounds3.min.z - pad, maxX: bounds3.max.x + pad, maxZ: bounds3.max.z + pad }
  }, [bounds3, grid.cellSize])
  // Imported wall segments (`scene.walls`) are already in world units and sit under the image,
  // which the scene transform does not move, so they are not transformed either.
  const sceneWallsKey = scene.walls ? JSON.stringify(scene.walls) : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sceneWalls = useMemo<WallSegment[]>(() => scene.walls ?? [], [sceneWallsKey])
  const baseWalls = useMemo(
    () => [...transformWalls(loaded?.walls ?? [], transform), ...sceneWalls, ...Object.values(propWalls).flat()],
    [loaded, transform, sceneWalls, propWalls],
  )
  // Walls and doors drawn on the table (build tools); a closed door blocks like a wall.
  const drawnWalls = useDrawnBlocking(sceneId)
  const walls = useMemo(() => (drawnWalls.length ? [...baseWalls, ...drawnWalls] : baseWalls), [baseWalls, drawnWalls])
  useEffect(() => {
    const c = bounds3.getCenter(new Vector3())
    tableRuntime.sceneCenter = { x: c.x, y: floorY, z: c.z }
    tableRuntime.floorY = floorY
  }, [bounds3, floorY])
  const weatherBounds = useMemo(
    () => ({ min: [bounds3.min.x, bounds3.min.y, bounds3.min.z] as [number, number, number], max: [bounds3.max.x, bounds3.max.y, bounds3.max.z] as [number, number, number] }),
    [bounds3],
  )

  // The floor's own extent: the grid stops there.
  const floorRect: Bounds2 = useMemo(
    () => ({ minX: bounds3.min.x, minZ: bounds3.min.z, maxX: bounds3.max.x, maxZ: bounds3.max.z }),
    [bounds3],
  )

  const graphics = useGraphics()
  const ctx: TableContextValue = useMemo(
    () => ({ sceneId, scene, grid, floorY, loaded, walls, viewer: viewer ?? null, onIntent, onPresence, resolveAsset: resolve, graphics }),
    [sceneId, scene, grid, floorY, loaded, walls, viewer, onIntent, onPresence, resolve, graphics],
  )
  // WebGL context loss (app switch on a phone, a GPU reset): notice while lost, then a fresh canvas.
  const [glLost, setGlLost] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const onContextLost = useCallback(() => setGlLost(true), [])
  const remountCanvas = useCallback(() => { setGlLost(false); setCanvasKey((n) => n + 1) }, [])
  const uncapped = graphics.idleFps === 0 && graphics.activeFps === 0
  const background = fogColor(scene.darkness)

  // Orbit, or Eyes (first person from the followed token); a `cameraMode` prop pins it (dev stories).
  const firstPerson = useTableUi((s) => s.firstPerson)
  const mode: CameraMode = cameraMode ?? (firstPerson ? 'token' : 'orbit')

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320, background }}>
      <Canvas
        key={`${canvasKey}:${graphics.antialias ? 'aa' : 'no-aa'}`}
        shadows={graphics.shadows}
        dpr={graphics.dpr}
        frameloop={uncapped ? 'always' : 'demand'}
        camera={CAMERA_OPTS}
        gl={graphics.antialias ? GL_OPTS.on : GL_OPTS.off}
        style={CANVAS_STYLE}
        onPointerMissed={(e) => {
          // Touch with a token of yours selected: the tap previews or commits a two-tap move instead.
          if (e.button === 0 && !targeting && performance.now() > ignoreMissUntil.current && moveMissed(e)) return
          if (e.button === 0 && !targeting && performance.now() > ignoreMissUntil.current) setSelection(null)
          if (!targeting) pingMissed(e)
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Atmosphere darkness={scene.darkness} bounds={bounds3} />
        {!uncapped && <FramePacer graphics={graphics} />}
        <ContextGuard onLost={onContextLost} onRestored={remountCanvas} />
        <TableContext.Provider value={ctx}>
          {url && <SceneLoaderBridge key={modelRetry} url={url} onLoaded={handleLoaded} onError={handleLoadError} />}
          <Lighting darkness={scene.darkness} />
          {loaded ? <SceneModel loaded={loaded} /> : !image && <PlaceholderFloor bounds={bounds2} />}
          {image && <ImageFloor image={image} grid={grid} floorY={floorY} onStatus={setImageStatus} retry={imageRetry} />}
          {gridOn && <GridOverlay grid={grid} bounds={bounds2} floorY={floorY} clip={floorRect} />}
          <Props sceneId={sceneId} />
          <Tokens sceneId={sceneId} viewer={viewer ?? null} />
          <FogOverlay bounds={bounds2} walls={walls} brightFloor={!!image} />
          {targeting && <TargetingLayer key={`${targeting.source}:${targeting.shape.kind}`} targeting={targeting} bounds={bounds2} />}
          {!targeting && <RulerLayer bounds={bounds2} />}
          {!targeting && <RangePreview />}
          <DeclaredActions />
          <PingLayer bounds={bounds2} />
          {!targeting && <TwoTapMoveLayer />}
          <vfx.VfxLayer events={events} since={mountedAt} cellSize={grid.cellSize} />
          <vfx.WeatherLayer kind={scene.weather ?? 'none'} bounds={weatherBounds} />
          <BuildLayer bounds={bounds2} baseWalls={baseWalls} />
          <EditGizmo />
          <CameraRigFromStore mode={mode} sceneId={sceneId} viewer={viewer ?? null} bounds={bounds3} floorY={floorY} cellSize={grid.cellSize} walls={walls} />
          <CameraShake cellSize={grid.cellSize} />
        </TableContext.Provider>
      </Canvas>
      {model && !loaded && !error && <Overlay>Loading scene…</Overlay>}
      {error && <SceneLoadError sceneId={sceneId} name={scene.name} detail={error} gm={gm} onRetry={retryModel} onSwitch={(id) => onIntent({ type: 'scene.activate', scene: id })} />}
      {image && imageStatus?.kind === 'loading' && <Overlay>Loading map…</Overlay>}
      {image && imageStatus?.kind === 'error' && <MapImageError status={imageStatus} onRetry={retryImage} />}
      {targeting && <TargetingBar targeting={targeting} />}
      {!targeting && <MoveBar onIntent={onIntent} grid={grid} floorY={floorY} viewer={viewer ?? null} />}
      {glLost && <ContextLostNotice onReload={remountCanvas} />}
    </div>
  )
}

/**
 * Scene fog in the ambient tint, doubling as the background: it starts just past what the camera
 * looks at and swallows the void beyond the diorama's far edge.
 */
function Atmosphere({ darkness, bounds }: { darkness: number; bounds: Box3 }) {
  const scene = useThree((s) => s.scene)
  const color = fogColor(darkness)
  const fog = useMemo(() => new Fog(color, 30, 90), [color])
  const radius = useMemo(() => {
    const size = bounds.getSize(new Vector3())
    return Math.hypot(size.x, size.z) / 2
  }, [bounds])
  useEffect(() => {
    const bg = new Color(color)
    scene.fog = fog
    scene.background = bg
    return () => { if (scene.fog === fog) scene.fog = null; if (scene.background === bg) scene.background = null }
  }, [scene, fog, color])
  useFrame(({ camera }) => {
    const t = tableRuntime.cameraTarget
    const d = t ? Math.hypot(camera.position.x - t.x, camera.position.y - t.y, camera.position.z - t.z) : 20
    const r = fogRange(d, radius)
    fog.near = r.near
    fog.far = r.far
  })
  return null
}

/**
 * Frame pacing for the `demand` frame loop: renders at the preset's active rate for a moment after
 * any input or table change, then drops to the idle rate (flames still flicker, just slower).
 */
function FramePacer({ graphics }: { graphics: GraphicsPreset }) {
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    let lastInput = performance.now()
    let lastFrame = 0
    let raf = 0
    const poke = () => { lastInput = performance.now() }
    const tick = (now: number) => {
      const fps = now - lastInput < ACTIVE_MS ? graphics.activeFps : graphics.idleFps
      if (frameDue(now, lastFrame, fps)) { lastFrame = now; invalidate() }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const el = gl.domElement
    const opts = { passive: true } as const
    for (const type of ['pointerdown', 'pointermove', 'wheel'] as const) el.addEventListener(type, poke, opts)
    window.addEventListener('keydown', poke)
    const offGame = useGame.subscribe(poke)
    const offUi = useTableUi.subscribe(poke)
    return () => {
      cancelAnimationFrame(raf)
      for (const type of ['pointerdown', 'pointermove', 'wheel'] as const) el.removeEventListener(type, poke)
      window.removeEventListener('keydown', poke)
      offGame()
      offUi()
    }
  }, [graphics, invalidate, gl])
  return null
}

/** Reports WebGL context loss and restore. `preventDefault` tells the browser we want it back. */
function ContextGuard({ onLost, onRestored }: { onLost(): void; onRestored(): void }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    const lost = (e: Event) => { e.preventDefault(); onLost() }
    const restored = () => onRestored()
    el.addEventListener('webglcontextlost', lost)
    el.addEventListener('webglcontextrestored', restored)
    return () => { el.removeEventListener('webglcontextlost', lost); el.removeEventListener('webglcontextrestored', restored) }
  }, [gl, onLost, onRestored])
  return null
}

function ContextLostNotice({ onReload }: { onReload(): void }) {
  return (
    <div role="alert" style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
      background: 'rgba(8,8,12,0.82)', color: '#f3ead8', fontSize: 14, textAlign: 'center', padding: 16,
    }}>
      <strong style={{ fontSize: 16 }}>The table paused</strong>
      <span style={{ maxWidth: 360, opacity: 0.85 }}>The browser took the graphics back, which happens after switching apps. It should come back by itself.</span>
      <button type="button" onClick={onReload} style={{
        minHeight: 44, padding: '0 18px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(0,0,0,0.3)',
        color: '#f3ead8', fontSize: 14, fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation',
      }}>Reload the table</button>
    </div>
  )
}

/**
 * HTML controls for targeting: the skill being aimed, then the staged pick ("Fireball → Bramble,
 * Nettle · 2-cell burst"), the outcome ("hits 2 enemies, 1 ally"), a friendly-fire warning (or one
 * when a target is another player's character), and Cast / Cancel.
 * Every pointer type stages first; Enter casts the staged pick, Esc cancels (TableInner). 44px
 * buttons, safe-area aware, stacks on narrow screens (styles in TargetingBar.css).
 */
function TargetingBar({ targeting }: { targeting: TargetingProps }) {
  const candidate = useTableUi((s) => s.targeting?.candidate ?? null)
  const uiSet = useTableUi((s) => s.set)
  const tokens = useGame((s) => s.tokens)
  const nameOf = useCallback((id: TokenId) => tokens[id]?.name ?? 'someone', [tokens])
  const names = useMemo(() => (candidate?.targets ?? []).map(nameOf), [candidate, nameOf])
  // While aiming an area, the live count follows the pointer; once staged it is the pick's.
  const inside = useTableUi((s) => s.targeting?.inside)
  const live = useMemo(() => candidate?.targets ?? [...(inside ?? [])], [candidate, inside])
  const outcome = targetingOutcome(targeting, live)
  const warnings = targetingWarnings(targeting, candidate?.targets ?? [], nameOf)
  const cast = useCallback(() => {
    const t = useTableUi.getState().targeting
    const r = stageTargeting(t?.candidate ?? null, { kind: 'confirm' })
    if (!r.cast) return
    uiSet({ targeting: t ? { ...t, candidate: null } : null })
    targeting.onPick(r.cast)
  }, [targeting, uiSet])
  // Enter casts the staged pick. A focused button already fires its own click on Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON' || el.isContentEditable)) return
      if (!useTableUi.getState().targeting?.candidate) return
      e.preventDefault()
      cast()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cast])
  return (
    <div className="targeting-bar" role="group" aria-label="Skill targeting">
      <div className="targeting-bar__card">
        <div className="targeting-bar__text" aria-live="polite">
          {candidate ? stagedSummary(targeting.name, targeting.shape, names) : `${targeting.name} · ${describeShape(targeting.shape)}`}
          {outcome && <span className={`targeting-bar__outcome targeting-bar__outcome--${outcome.tone}`}> · {outcome.text}</span>}
        </div>
        {warnings.map((w) => <div key={w} className="targeting-bar__warn" role="alert">{w}</div>)}
        <div className="targeting-bar__actions">
          <button type="button" className="targeting-bar__btn" onClick={() => targeting.onCancel()}>Cancel</button>
          {candidate && (
            <button type="button" className="targeting-bar__btn targeting-bar__btn--primary" onClick={cast}>
              Cast
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

type ShakeEvent = { intensity?: number; duration?: number } | undefined
type ShakeBus = {
  on?(event: string, handler: (...args: unknown[]) => void): unknown
  off?(event: string, handler: (...args: unknown[]) => void): unknown
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
    // `vfxBus` emits (strength 0..1, durationMs); an object payload is still accepted.
    const h = (a?: unknown, b?: unknown) => handler(typeof a === 'number' ? { intensity: a, duration: typeof b === 'number' ? b : undefined } : (a as ShakeEvent))
    const off = bus.on('shake', h)
    return () => { if (typeof off === 'function') off(); else bus.off?.('shake', h) }
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
function SceneLoaderBridge({ url, onLoaded, onError }: { url: string; onLoaded(s: LoadedScene): void; onError(e: unknown): void }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    let live = true
    let result: LoadedScene | null = null
    loadSceneModel(url, { renderer: gl }).then(
      (s) => { if (live) { result = s; onLoaded(s) } else disposeScene(s) },
      (e: unknown) => { if (live) onError(e) },
    )
    return () => { live = false; if (result) disposeScene(result) }
  }, [url, gl, onLoaded, onError])
  return null
}

/** Cool ambient plus a warm-sky hemisphere, both scaled by darkness above a readable floor (atmosphere.ts). */
function Lighting({ darkness }: { darkness: number }) {
  const { ambient, hemisphere } = ambientLevels(darkness)
  return (
    <>
      <ambientLight intensity={ambient} color="#cfd6ff" />
      <hemisphereLight intensity={hemisphere} color="#f3ead8" groundColor="#2b241c" />
    </>
  )
}

const PLACEHOLDER_FLOOR = toonMaterial({ color: '#3a3630' })

function PlaceholderFloor({ bounds }: { bounds: Bounds2 }) {
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxZ - bounds.minZ
  return (
    <mesh rotation-x={-Math.PI / 2} position={[(bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2]} receiveShadow>
      <planeGeometry args={[w, h]} />
      <primitive object={PLACEHOLDER_FLOOR} attach="material" />
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
  // Selecting a token on this scene centres the orbit camera on it without changing the zoom.
  const selectedHere = !!selectedId && tokens[selectedId]?.scene === sceneId
  useEffect(() => { if (selectedId && selectedHere) focusToken(selectedId) }, [selectedId, selectedHere])
  return <CameraRig mode={mode} follow={follow} bounds={bounds} floorY={floorY} cellSize={cellSize} walls={walls} />
}

/** The map image could not be loaded: says which file and offers to resolve and load it again. */
function MapImageError({ status, onRetry }: { status: Extract<ImageFloorStatus, { kind: 'error' }>; onRetry(): void }) {
  return (
    <div role="alert" style={{
      position: 'absolute', left: 12, bottom: 12, maxWidth: 'min(420px, calc(100% - 24px))', padding: '8px 10px', borderRadius: 6, fontSize: 13,
      background: 'var(--error-glass)', color: 'var(--on-error)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <span style={{ flex: '1 1 160px', minWidth: 0 }}>
        <strong>Map image failed to load</strong>
        <span style={{ display: 'block', opacity: 0.85, overflowWrap: 'anywhere' }}>{status.name}</span>
      </span>
      <button type="button" onClick={onRetry} style={{
        minHeight: 36, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(0,0,0,0.3)',
        color: 'var(--on-error)', fontSize: 13, fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation',
      }}>Retry</button>
    </div>
  )
}

/**
 * The scene model could not be loaded: says which scene in plain words, offers to try again and,
 * for the GM, to switch to another scene that is not known to be broken. Details are in the console.
 */
function SceneLoadError({ sceneId, name, detail, gm, onRetry, onSwitch }: {
  sceneId: SceneId; name: string; detail: string; gm: boolean; onRetry(): void; onSwitch(id: SceneId): void
}) {
  const scenes = useGame((s) => s.scenes)
  const sceneErrors = useTableUi((s) => s.sceneErrors)
  const other = Object.values(scenes).find((s) => s.id !== sceneId && !sceneErrors[s.id]) ?? Object.values(scenes).find((s) => s.id !== sceneId)
  const button = {
    minHeight: 44, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(0,0,0,0.3)',
    color: 'var(--on-error)', fontSize: 13, fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation',
  } as const
  return (
    <div role="alert" style={{
      position: 'absolute', left: 12, bottom: 12, maxWidth: 'min(440px, calc(100% - 24px))', padding: '8px 10px', borderRadius: 6, fontSize: 13,
      background: 'var(--error-glass)', color: 'var(--on-error)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <span style={{ flex: '1 1 160px', minWidth: 0 }}>
        <strong>Couldn't load {name}</strong>
        <span style={{ display: 'block', opacity: 0.85, overflowWrap: 'anywhere' }}>{detail}</span>
      </span>
      <button type="button" onClick={onRetry} style={button}>Retry</button>
      {gm && other && <button type="button" onClick={() => onSwitch(other.id)} style={button}>Switch scene</button>}
    </div>
  )
}

function Overlay({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div style={{
      position: 'absolute', left: 12, bottom: 12, padding: '6px 10px', borderRadius: 6, fontSize: 13,
      background: tone === 'error' ? 'var(--error-glass)' : 'var(--scrim)', color: tone === 'error' ? 'var(--on-error)' : 'var(--on-glass)', pointerEvents: 'none',
    }}>{children}</div>
  )
}

export type { ViewerInfo }
export type { TargetingProps }
export type { PlayerPubkey as TableViewerPubkey }

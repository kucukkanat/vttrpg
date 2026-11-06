/**
 * The table: a <Canvas> showing the active scene from the store with grid, tokens, cameras,
 * lighting and fog of war. Emits intents and presence through callbacks; never touches
 * networking or rules.
 *
 * Keys: G grid, C camera mode (local override), F first person (token mode), Esc deselect.
 * Mouse: drag a token to move it (snaps to cells), click / right-click selects, drag empty
 * space to orbit, wheel to zoom, right-drag to pan. Touch: one finger drags a token or orbits,
 * two fingers pan, pinch zooms, long-press selects.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Box3, Vector3 } from 'three'
import type { AssetRef } from '@/core/assets'
import type { CameraMode, Scene, Token } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { PlayerPubkey, SceneId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import type { Presence } from '@/core/presence'
import { useGame } from '@/state/store'
import { CameraRig } from './CameraRig'
import { defaultResolveAsset, TableContext, type TableContextValue, type ViewerInfo } from './context'
import { FogOverlay } from './FogOverlay'
import type { Bounds2 } from './grid'
import { GridOverlay } from './GridOverlay'
import { disposeScene, loadSceneModel, type LoadedScene, type SceneValidationReport } from './sceneLoader'
import { SceneModel } from './SceneModel'
import { useTableUi } from './tableState'
import { DragGhostMesh, TokenMesh } from './TokenMesh'

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
  className?: string
  style?: CSSProperties
}

export function TableCanvas(props: TableCanvasProps) {
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const scene = useGame((s) => (sceneId ? s.scenes[sceneId] : undefined))
  if (!sceneId || !scene) {
    return <div className={props.className} style={{ padding: 16, ...props.style }}>No active scene.</div>
  }
  return <TableInner key={sceneId} sceneId={sceneId} scene={scene} {...props} />
}

function TableInner({ sceneId, scene, onIntent, onPresence, resolveAsset, viewer, cameraMode, showGrid, onSceneLoaded, className, style }: TableCanvasProps & { sceneId: SceneId; scene: Scene }) {
  const resolve = resolveAsset ?? defaultResolveAsset
  const [url, setUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<LoadedScene | null>(null)
  const [error, setError] = useState<string | null>(null)
  const uiSet = useTableUi((s) => s.set)
  const gridOn = useTableUi((s) => s.showGrid)
  const cameraOverride = useTableUi((s) => s.cameraOverride)
  const setSelected = useGame((s) => s.setSelectedToken)

  useEffect(() => { uiSet({ showGrid: showGrid ?? true }) }, [showGrid, uiSet])
  useEffect(() => { uiSet({ cameraOverride: null, firstPerson: false, drag: null, grab: null, hovered: null }) }, [sceneId, uiSet])

  // Resolve the scene model to a URL.
  const model = scene.model
  useEffect(() => {
    let live = true
    setUrl(null)
    setError(null)
    resolve(model).then((u) => { if (live) setUrl(u) }, (e: unknown) => { if (live) setError(`asset: ${String(e)}`) })
    return () => { live = false }
  }, [model, resolve])

  const handleLoaded = useCallback((s: LoadedScene) => { setLoaded(s); onSceneLoaded?.(s.report) }, [onSceneLoaded])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const ui = useTableUi.getState()
      switch (e.key) {
        case 'g': case 'G': ui.set({ showGrid: !ui.showGrid }); break
        case 'f': case 'F': ui.set({ firstPerson: !ui.firstPerson }); break
        case 'c': case 'C': {
          const current = ui.cameraOverride ?? cameraMode ?? scene.cameraMode
          ui.set({ cameraOverride: current === 'orbit' ? 'token' : 'orbit' })
          break
        }
        case 'Escape': setSelected(null); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cameraMode, scene.cameraMode, setSelected])

  const grid: GridSpec = scene.grid
  const floorY = loaded?.floorY ?? 0
  const bounds2: Bounds2 = useMemo(() => {
    const b = loaded?.bounds ?? new Box3(new Vector3(-8, 0, -8), new Vector3(8, 3, 8))
    const pad = grid.cellSize
    return { minX: b.min.x - pad, minZ: b.min.z - pad, maxX: b.max.x + pad, maxZ: b.max.z + pad }
  }, [loaded, grid.cellSize])
  const bounds3 = useMemo(() => loaded?.bounds ?? new Box3(new Vector3(-8, 0, -8), new Vector3(8, 3, 8)), [loaded])

  const ctx: TableContextValue = useMemo(
    () => ({ sceneId, scene, grid, floorY, loaded, viewer: viewer ?? null, onIntent, onPresence, resolveAsset: resolve }),
    [sceneId, scene, grid, floorY, loaded, viewer, onIntent, onPresence, resolve],
  )

  const mode: CameraMode = cameraOverride ?? cameraMode ?? scene.cameraMode

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320, background: '#0b0b10', ...style }}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ fov: 50, near: 0.05, far: 500, position: [8, 8, 8] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        style={{ touchAction: 'none' }}
        onPointerMissed={(e) => { if (e.button === 0) setSelected(null) }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <color attach="background" args={['#0b0b10']} />
        <TableContext.Provider value={ctx}>
          {url && <SceneLoaderBridge url={url} onLoaded={handleLoaded} onError={setError} />}
          <Lighting darkness={scene.darkness} />
          {loaded ? <SceneModel loaded={loaded} /> : <PlaceholderFloor bounds={bounds2} />}
          {gridOn && <GridOverlay grid={grid} bounds={bounds2} floorY={floorY} />}
          <Tokens sceneId={sceneId} viewer={viewer ?? null} />
          <FogOverlay bounds={bounds2} walls={loaded?.walls ?? []} />
          <CameraRigFromStore mode={mode} sceneId={sceneId} viewer={viewer ?? null} bounds={bounds3} floorY={floorY} cellSize={grid.cellSize} />
        </TableContext.Provider>
      </Canvas>
      {!loaded && !error && <Overlay>Loading scene…</Overlay>}
      {error && <Overlay tone="error">{error}</Overlay>}
    </div>
  )
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
  const list = useMemo(() => Object.values(tokens).filter((t) => t.scene === sceneId), [tokens, sceneId])
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
function CameraRigFromStore({ mode, sceneId, viewer, bounds, floorY, cellSize }: { mode: CameraMode; sceneId: SceneId; viewer: ViewerInfo | null; bounds: Box3; floorY: number; cellSize: number }) {
  const tokens = useGame((s) => s.tokens)
  const selectedId = useGame((s) => s.selectedToken)
  const follow: Token | null = useMemo(() => {
    const inScene = Object.values(tokens).filter((t) => t.scene === sceneId)
    const selected = selectedId ? inScene.find((t) => t.id === selectedId) : undefined
    if (selected) return selected
    const owned = viewer ? inScene.find((t) => t.owner === viewer.pubkey) : undefined
    return owned ?? inScene[0] ?? null
  }, [tokens, sceneId, selectedId, viewer])
  return <CameraRig mode={mode} follow={follow} bounds={bounds} floorY={floorY} cellSize={cellSize} />
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
export type { PlayerPubkey as TableViewerPubkey }

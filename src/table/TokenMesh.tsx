/**
 * One token: a GLB mini when `token.model` is set, else a coloured disc with initials.
 * Handles hover, selection (click / right-click / long-press) and drag-to-move with snapping.
 */
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useCursor, useGLTF } from '@react-three/drei'
import {
  CanvasTexture, Color, Group, Mesh, MeshStandardMaterial, Plane, PointLight, SRGBColorSpace, Vector3,
} from 'three'
import type { Token } from '@/core/doc'
import { useGame } from '@/state/store'
import { canControl, useTable } from './context'
import { snapToCell } from './grid'
import { flickerNoise } from './SceneModel'
import { fitObjectToCell, TOKEN_FIT, type FitRange } from './fitScale'
import { useTableUi } from './tableState'

const PRESENCE_INTERVAL_MS = 66 // ~15/s

/**
 * R3F routes captured pointer events to the object; its `target` is typed as a bare EventTarget.
 * The DOM call can throw (Safari after a cancelled touch, synthetic events); R3F has already
 * recorded the capture by then, so swallowing the error keeps routing intact.
 */
type CaptureTarget = { setPointerCapture(id: number): void; releasePointerCapture(id: number): void }
export const capture = (e: ThreeEvent<PointerEvent>) => {
  const t = e.target as unknown as CaptureTarget
  return {
    setPointerCapture(id: number) { try { t.setPointerCapture(id) } catch { /* see above */ } },
    releasePointerCapture(id: number) { try { t.releasePointerCapture(id) } catch { /* see above */ } },
  }
}
export const DRAG_THRESHOLD_PX = 6
export const LONG_PRESS_MS = 450

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function makeInitialsTexture(text: string, color: string): CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = 14
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2)
  ctx.stroke()
  const c = new Color(color)
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  ctx.fillStyle = lum > 0.45 ? '#1a1612' : '#f6efe3'
  ctx.font = `bold ${text.length > 1 ? 112 : 136}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, size / 2, size / 2 + 6)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function hashPhase(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return (h >>> 0) / 4294967295 * Math.PI * 2
}

/** Swaps in `fallback` when loading the model throws (bad URL, unsupported file). */
export class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/**
 * A GLB instance with shadows on. Scene-convention helpers (`COL_*`, `FOG_*`) inside the file
 * are hidden so a scene model can double as a prop. `onObject` reports the clone once it exists.
 * With `fitCell` the model's footprint is fitted to the grid (see fitScale.ts) before `scale` applies.
 */
export function GlbMini({ url, scale, fitCell, fitRange = TOKEN_FIT, onObject }: {
  url: string; scale: number; fitCell?: number; fitRange?: FitRange; onObject?(o: Group | null): void
}) {
  const gltf = useGLTF(url)
  const object = useMemo(() => {
    const o = gltf.scene.clone(true) as Group
    o.traverse((m) => {
      if (m instanceof Mesh) {
        if (/^(COL|FOG)_/.test(m.name)) { m.visible = false; return }
        m.castShadow = true
        m.receiveShadow = true
      }
      if ((m as { isLight?: boolean }).isLight) (m as { castShadow: boolean }).castShadow = false
    })
    return o
  }, [gltf])
  const fit = useMemo(() => (fitCell ? fitObjectToCell(object, fitCell, fitRange) : 1), [object, fitCell, fitRange])
  useEffect(() => {
    onObject?.(object)
    return () => onObject?.(null)
  }, [object, onObject])
  return <primitive object={object} scale={scale * fit} />
}

function Disc({ token, radius, dimmed }: { token: Token; radius: number; dimmed: boolean }) {
  const initials = initialsOf(token.name)
  const top = useMemo(() => makeInitialsTexture(initials, token.color), [initials, token.color])
  useEffect(() => () => top.dispose(), [top])
  const side = useMemo(() => new MeshStandardMaterial({ color: new Color(token.color).multiplyScalar(0.7), roughness: 0.6 }), [token.color])
  const face = useMemo(() => new MeshStandardMaterial({ map: top, roughness: 0.5 }), [top])
  useEffect(() => () => { side.dispose(); face.dispose() }, [side, face])
  useEffect(() => {
    for (const m of [side, face]) { m.transparent = dimmed; m.opacity = dimmed ? 0.45 : 1 }
  }, [dimmed, side, face])
  const h = radius * 0.22
  return (
    <mesh castShadow receiveShadow position-y={h / 2} material={[side, face, side]}>
      <cylinderGeometry args={[radius, radius, h, 40]} />
    </mesh>
  )
}

export function useAssetUrl(ref: Token['model']): string | null {
  const { resolveAsset } = useTable()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setUrl(null)
    if (!ref) return
    resolveAsset(ref).then((u) => { if (live) setUrl(u) }, () => { if (live) setUrl(null) })
    return () => { live = false }
  }, [ref, resolveAsset])
  return url
}

export function TokenMesh({ token }: { token: Token }) {
  const { grid, floorY, viewer, onIntent, onPresence } = useTable()
  const selected = useGame((s) => s.selectedToken === token.id)
  const setSelected = useGame((s) => s.setSelectedToken)
  const hovered = useTableUi((s) => s.hovered === token.id)
  const dragGhost = useTableUi((s) => (s.drag && s.drag.token === token.id ? s.drag : null))
  const targeting = useTableUi((s) => s.targeting !== null)
  const targetInside = useTableUi((s) => s.targeting?.inside.has(token.id) ?? false)
  const targetOutOfRange = useTableUi((s) => (s.targeting ? !s.targeting.inRange.has(token.id) : false))
  const uiSet = useTableUi((s) => s.set)
  // Live transform while the edit gizmo drags this token.
  const preview = useTableUi((s) => (s.editPreview && s.editPreview.target.kind === 'token' && s.editPreview.target.id === token.id ? s.editPreview : null))
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const modelUrl = useAssetUrl(token.model)

  const group = useRef<Group>(null)
  const body = useRef<Group>(null)
  const light = useRef<PointLight>(null)
  const controllable = canControl(viewer, token)
  useCursor(hovered && controllable, 'grab')
  useCursor(dragGhost !== null, 'grabbing')

  const cell = grid.cellSize
  const scale = preview?.scale ?? token.scale
  const rotationY = preview?.rotationY ?? token.rotationY
  const elevation = Math.max(0, preview?.elevation ?? token.elevation ?? 0)
  const radius = 0.38 * cell * scale
  const phase = useMemo(() => hashPhase(token.id), [token.id])
  const gmView = !viewer || viewer.isGm

  // Smoothly follow the committed position (or the drag ghost / edit preview), with an idle bob.
  const current = useRef(new Vector3(token.position.x, floorY, token.position.z))
  useFrame(({ clock }, dt) => {
    const g = group.current
    if (!g) return
    const tx = dragGhost ? dragGhost.x : preview ? preview.position.x : token.position.x
    const tz = dragGhost ? dragGhost.z : preview ? preview.position.z : token.position.z
    const k = 1 - Math.exp(-dt * (dragGhost || preview ? 18 : 10))
    current.current.x += (tx - current.current.x) * k
    current.current.z += (tz - current.current.z) * k
    const t = clock.elapsedTime
    const bob = Math.sin(t * 1.6 + phase) * 0.012 * cell
    const lift = dragGhost ? 0.25 * cell : 0
    g.position.set(current.current.x, floorY, current.current.z)
    if (body.current) {
      body.current.position.y = bob + lift + elevation
      body.current.rotation.y = rotationY
    }
    if (light.current && token.light > 0) {
      light.current.intensity = 5 * cell * cell * (1 + 0.3 * flickerNoise(t, phase))
    }
  })

  // Drag state lives in a ref; React state only gets the snapped ghost.
  const drag = useRef<{
    pointerId: number; startX: number; startY: number; moved: boolean; longPress: ReturnType<typeof setTimeout> | null
    plane: Plane; lastPresence: number; lastCell: string | null
  } | null>(null)
  const hit = useMemo(() => new Vector3(), [])

  const select = () => setSelected(token.id)

  const endDrag = (commit: boolean) => {
    const d = drag.current
    if (!d) return
    if (d.longPress) clearTimeout(d.longPress)
    drag.current = null
    if (controls) controls.enabled = true
    const ghost = useTableUi.getState().drag
    uiSet({ drag: null, grab: null })
    if (!d.moved) return
    onPresence({ dragging: undefined })
    if (commit && ghost && ghost.token === token.id) {
      if (Math.abs(ghost.x - token.position.x) > 1e-4 || Math.abs(ghost.z - token.position.z) > 1e-4) {
        onIntent({ type: 'token.move', token: token.id, position: { x: ghost.x, y: floorY, z: ghost.z } })
      }
    }
  }

  // While a skill is being aimed the targeting layer owns the pointer; let events fall through to it.
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (targeting) return
    e.stopPropagation()
    if (e.button === 2) { select(); return }
    if (e.button !== 0) return
    if (!controllable) { select(); return }
    capture(e).setPointerCapture(e.pointerId)
    uiSet({ grab: token.id })
    drag.current = {
      pointerId: e.pointerId, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY, moved: false,
      longPress: e.pointerType === 'touch'
        ? setTimeout(() => { if (drag.current && !drag.current.moved) { select(); endDrag(false) } }, LONG_PRESS_MS)
        : null,
      plane: new Plane(new Vector3(0, 1, 0), -floorY),
      lastPresence: 0,
      lastCell: null,
    }
  }

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (targeting || !d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    if (!d.moved) {
      const dist = Math.hypot(e.nativeEvent.clientX - d.startX, e.nativeEvent.clientY - d.startY)
      if (dist < DRAG_THRESHOLD_PX) return
      d.moved = true
      if (d.longPress) { clearTimeout(d.longPress); d.longPress = null }
      if (controls) controls.enabled = false
    }
    if (!e.ray.intersectPlane(d.plane, hit)) return
    const snapped = snapToCell(grid, hit.x, hit.z)
    const key = `${snapped.cell.q},${snapped.cell.r}`
    if (key !== d.lastCell) {
      d.lastCell = key
      uiSet({ drag: { token: token.id, x: snapped.x, z: snapped.z } })
    }
    const now = performance.now()
    if (now - d.lastPresence >= PRESENCE_INTERVAL_MS) {
      d.lastPresence = now
      onPresence({ dragging: { token: token.id, position: { x: snapped.x, y: floorY, z: snapped.z } } })
    }
  }

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (targeting || !d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    capture(e).releasePointerCapture(e.pointerId)
    const wasClick = !d.moved
    endDrag(true)
    if (wasClick) select()
  }

  useEffect(() => () => { if (drag.current) endDrag(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (token.hidden && !gmView) return null
  const dimmed = token.hidden || targetOutOfRange

  return (
    <group
      ref={group}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => endDrag(false)}
      onLostPointerCapture={() => endDrag(false)}
      onContextMenu={(e) => { if (targeting) return; e.stopPropagation(); e.nativeEvent.preventDefault(); select() }}
      onPointerOver={(e) => { if (targeting) return; e.stopPropagation(); uiSet({ hovered: token.id }) }}
      onPointerOut={() => { if (useTableUi.getState().hovered === token.id) uiSet({ hovered: null }) }}
    >
      {/* Lifted part: the mini, its rings and light. The group below stays on the floor. */}
      <group ref={body} position-y={elevation} rotation-y={rotationY}>
        {modelUrl ? (
          <ModelBoundary fallback={<Disc token={token} radius={radius} dimmed={dimmed} />}>
            <Suspense fallback={<Disc token={token} radius={radius} dimmed={dimmed} />}>
              <GlbMini url={modelUrl} scale={scale} fitCell={cell} />
            </Suspense>
          </ModelBoundary>
        ) : (
          <Disc token={token} radius={radius} dimmed={dimmed} />
        )}
        {(selected || hovered) && !targeting && (
          <mesh rotation-x={-Math.PI / 2} position-y={0.008} renderOrder={3}>
            <ringGeometry args={[radius * 1.12, radius * (selected ? 1.3 : 1.22), 48]} />
            <meshBasicMaterial color={selected ? '#ffd166' : '#ffffff'} transparent opacity={selected ? 0.95 : 0.5} depthWrite={false} />
          </mesh>
        )}
        {targetInside && (
          <mesh rotation-x={-Math.PI / 2} position-y={0.012} renderOrder={6} raycast={() => undefined}>
            <ringGeometry args={[radius * 1.1, radius * 1.45, 48]} />
            <meshBasicMaterial color="#ff5a1f" transparent opacity={0.95} depthWrite={false} />
          </mesh>
        )}
        {token.light > 0 && (
          <pointLight
            ref={light}
            position={[0, 0.8 * cell, 0]}
            color="#ffb46b"
            distance={token.light * cell}
            decay={2}
            intensity={5 * cell * cell}
          />
        )}
      </group>
      {elevation > 0.01 && <ElevationMarker elevation={elevation} radius={radius} cell={cell} />}
    </group>
  )
}

/** Thin plumb line from the floor up to a lifted token plus a soft shadow disc, so height reads at a glance. */
function ElevationMarker({ elevation, radius, cell }: { elevation: number; radius: number; cell: number }) {
  const shadow = Math.max(0.12, 1 - elevation / (6 * cell))
  return (
    <group raycast={() => undefined}>
      <mesh position-y={elevation / 2} raycast={() => undefined}>
        <cylinderGeometry args={[0.012 * cell, 0.012 * cell, elevation, 6]} />
        <meshBasicMaterial color="#f3ead8" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.006} renderOrder={2} raycast={() => undefined}>
        <circleGeometry args={[radius * (0.9 + 0.1 * (1 - shadow)), 40]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.4 * shadow} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** Translucent ghost for a token another player is dragging. */
export function DragGhostMesh({ token, x, z, color }: { token: Token; x: number; z: number; color: string }) {
  const { grid, floorY } = useTable()
  const r = 0.38 * grid.cellSize * token.scale
  return (
    <mesh position={[x, floorY + 0.2 * grid.cellSize, z]} raycast={() => undefined}>
      <cylinderGeometry args={[r, r, r * 0.22, 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
    </mesh>
  )
}

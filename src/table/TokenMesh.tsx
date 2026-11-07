/**
 * One token: a GLB mini when `token.model` is set, else a coloured disc with initials.
 * Handles hover, selection (click; Shift/Cmd-click or touch Select mode adds to the set), the context
 * menu (right-click / long-press) and drag-to-move with snapping; dragging a selected token moves the whole selection.
 * Combat state sits on the footprint: an HP bar from the sheet's primary resource, condition
 * chips around the disc, a ring in the owner's presence colour on player-owned tokens (thicker on
 * the viewer's own, with the owner's shape on it as a colour-blind-safe backup) and a pulsing amber
 * ring on the combatant whose turn it is. A name label floats
 * above the viewer's own tokens, the selection, the current combatant and whatever is hovered.
 * While the viewer drags, the path and its length show on the floor (TokenOverlays.tsx).
 * Look: toon materials, an ink outline and a rim light on minis, a soft blob shadow under every
 * base, and initials that turn to stay upright on screen (stylize.ts, labelFacing.ts). The high
 * graphics tier adds a thick outline in the selection colour around selected tokens.
 */
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useCursor, useGLTF } from '@react-three/drei'
import {
  CanvasTexture, CircleGeometry, Color, CylinderGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Plane, PlaneGeometry,
  PointLight, RingGeometry, Shape, ShapeGeometry, SpriteMaterial, SRGBColorSpace, Vector3,
} from 'three'
import type { Token } from '@/core/doc'
import { useGame } from '@/state/store'
import { useSession } from '@/ui/session'
import { canControl, useTable } from './context'
import { snapToCell } from './grid'
import { moveBlocked } from './build/wallEdit'
import { flickerNoise } from './SceneModel'
import { fitObjectToCell, TOKEN_FIT, type FitRange } from './fitScale'
import { clearPendingMove, groupMoveTargets, useTableUi } from './tableState'
import { doubleTapEdit, tapTwice } from './editTap'
import { chipAngle, conditionChips, defenseAbbr, defenseAttribute, HP_BAND_COLORS, hpBand, MAX_PIPS, readDefense, readResource, vitalState, type ConditionChip, type HpBand } from './tokenHud'
import { CombatBadges } from './CombatBadges'
import { inCurrentSlot } from '@/state/initiative'
import { initialsOf, LOCAL_OWNER_COLOR, nameplateShown, ownerRingColor } from './tokenLabel'
import { MoveTrail, Nameplate, TurnRing } from './TokenOverlays'
import { ownerShapeIn, shapePoints, type OwnerShape } from './ownerShape'
import { blobShadowLook } from './atmosphere'
import { labelYaw } from './labelFacing'
import { addOutlines, buildGlow, materialModeFor, OUTLINE_INK, outlineMaterial, smoothNormals, stylizeObject, toonMaterial } from './stylize'

/** Colour of the high-tier selection outline; matches the selection ring under the token. */
export const SELECTION_OUTLINE_COLOR = '#ffd166'
/** Ink outline and selection outline widths, in cells. */
const INK_WIDTH = 0.014
const SELECTION_WIDTH = 0.04

/** Colour the local player is shown as (see `createController` in `src/ui/controller.ts` and the Players panel). */
export const LOCAL_PRESENCE_COLOR = LOCAL_OWNER_COLOR

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
/** Touch: a still press this long opens the token's context menu (props: selects). */
export const LONG_PRESS_MS = 500

/** Shift / Cmd / Ctrl held, or touch Select mode on: the tap adds to the selection instead of replacing it. */
export function isAdditiveSelect(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, multiSelect: boolean): boolean {
  return multiSelect || e.shiftKey || e.metaKey || e.ctrlKey
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
export function GlbMini({ url, scale, fitCell, fitRange = TOKEN_FIT, onObject, mini = false, selected = false }: {
  url: string; scale: number; fitCell?: number; fitRange?: FitRange; onObject?(o: Group | null): void
  /** A token's miniature: rim light and ink outline (props get neither). */
  mini?: boolean
  /** Selected token: a thick outline in the selection colour on the high tier. */
  selected?: boolean
}) {
  const gltf = useGLTF(url)
  const { graphics, grid } = useTable()
  const mode = materialModeFor(gltf.scene, graphics.pbr)
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
    stylizeObject(o, mode, { rim: mini })
    return o
  }, [gltf, mode, mini])
  const fit = useMemo(() => (fitCell ? fitObjectToCell(object, fitCell, fitRange) : 1), [object, fitCell, fitRange])
  useEffect(() => {
    onObject?.(object)
    return () => onObject?.(null)
  }, [object, onObject])
  const cell = fitCell ?? grid.cellSize
  useEffect(() => (mini ? addOutlines(object, outlineMaterial(OUTLINE_INK, INK_WIDTH * cell)) : undefined), [object, mini, cell])
  const outlineSelected = mini && selected && graphics.selectionOutline
  useEffect(
    () => (outlineSelected ? addOutlines(object, outlineMaterial(SELECTION_OUTLINE_COLOR, SELECTION_WIDTH * cell), 'selection') : undefined),
    [object, outlineSelected, cell],
  )
  const glow = useMemo(() => (graphics.glow ? buildGlow(object) : null), [object, graphics.glow])
  useEffect(() => () => glow?.dispose(), [glow])
  return (
    <>
      <primitive object={object} scale={scale * fit} />
      {glow && <primitive object={glow.group} scale={scale * fit} />}
    </>
  )
}

/**
 * The default token: a toon-shaded puck in the token colour with an ink outline. The initials sit
 * on a separate disc on top that turns about the vertical every frame so they read upright from
 * any camera yaw (`labelYaw`); `parentYaw` is the facing of the group the puck stands in.
 */
function Disc({ token, radius, dimmed, ghost = false, selected = false, parentYaw = 0 }: {
  token: Token; radius: number; dimmed: boolean; ghost?: boolean; selected?: boolean; parentYaw?: number
}) {
  const { graphics, grid } = useTable()
  const initials = initialsOf(token.name)
  const top = useMemo(() => makeInitialsTexture(initials, token.color), [initials, token.color])
  useEffect(() => () => top.dispose(), [top])
  const h = radius * 0.22
  const geometry = useMemo(() => {
    const g = new CylinderGeometry(radius, radius, h, 40)
    smoothNormals(g)
    return g
  }, [radius, h])
  useEffect(() => () => geometry.dispose(), [geometry])
  const side = useMemo(() => toonMaterial({ color: new Color(token.color).multiplyScalar(0.7) }, true), [token.color])
  const cap = useMemo(() => toonMaterial({ color: token.color }), [token.color])
  const face = useMemo(() => toonMaterial({ map: top }), [top])
  useEffect(() => () => { side.dispose(); cap.dispose(); face.dispose() }, [side, cap, face])
  // Ghost: a move the GM has not applied yet (queued while they were away) shows half-there.
  const opacity = dimmed ? 0.45 : ghost ? 0.6 : 1
  useEffect(() => {
    for (const m of [side, cap, face]) { m.transparent = opacity < 1; m.opacity = opacity }
  }, [opacity, side, cap, face])
  const label = useRef<Group>(null)
  const yaw = useRef(parentYaw)
  yaw.current = parentYaw
  useFrame(({ camera }) => {
    const l = label.current
    if (!l) return
    // The camera's screen-up, laid on the floor: the text's up follows it.
    const e = camera.matrixWorld.elements
    const y = labelYaw(e[4]!, e[6]!, yaw.current)
    if (y !== null) l.rotation.y = y
  })
  const outlined = opacity === 1
  const cell = grid.cellSize
  return (
    <group position-y={h / 2}>
      <mesh castShadow receiveShadow geometry={geometry} material={[side, cap, side]} />
      {outlined && <mesh geometry={geometry} material={outlineMaterial(OUTLINE_INK, INK_WIDTH * cell)} raycast={noRaycast} />}
      {outlined && selected && graphics.selectionOutline && (
        <mesh geometry={geometry} material={outlineMaterial(SELECTION_OUTLINE_COLOR, SELECTION_WIDTH * cell)} raycast={noRaycast} />
      )}
      <group ref={label} position-y={h / 2 + 0.002}>
        <mesh rotation-x={-Math.PI / 2} material={face} receiveShadow>
          <circleGeometry args={[radius * 0.97, 40]} />
        </mesh>
      </group>
    </group>
  )
}

/* ---------- Combat state on the footprint: shared geometry and materials, created once ---------- */

interface HudShared {
  plane: PlaneGeometry
  ring: RingGeometry
  ownRing: RingGeometry
  back: MeshBasicMaterial
  divider: MeshBasicMaterial
  bands: Record<HpBand, MeshBasicMaterial>
}
let hudShared: HudShared | null = null
function hud(): HudShared {
  if (hudShared) return hudShared
  const flat = (color: string, opacity = 1) => new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, toneMapped: false })
  hudShared = {
    plane: new PlaneGeometry(1, 1),
    ring: new RingGeometry(1, 1.1, 48),
    ownRing: new RingGeometry(0.98, 1.2, 48),
    back: flat('#100e0c', 0.82),
    divider: flat('#100e0c'),
    bands: { high: flat(HP_BAND_COLORS.high), mid: flat(HP_BAND_COLORS.mid), low: flat(HP_BAND_COLORS.low) },
  }
  return hudShared
}
const ownerMaterials = new Map<string, MeshBasicMaterial>()
function ownerMaterial(color: string): MeshBasicMaterial {
  let m = ownerMaterials.get(color)
  if (!m) {
    m = new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false })
    ownerMaterials.set(color, m)
  }
  return m
}
/** One sprite material per chip look (label + colour); the pack's condition list bounds the cache. */
const chipMaterials = new Map<string, SpriteMaterial>()
function chipMaterial(chip: ConditionChip): SpriteMaterial {
  const key = `${chip.label}|${chip.color}`
  let m = chipMaterials.get(key)
  if (m) return m
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = chip.color
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'
  ctx.lineWidth = 4
  ctx.stroke()
  const c = new Color(chip.color)
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  ctx.fillStyle = lum > 0.45 ? '#1a1612' : '#f6efe3'
  ctx.font = `bold ${chip.label.length > 1 ? 30 : 36}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(chip.label, size / 2, size / 2 + 2)
  const map = new CanvasTexture(canvas)
  map.colorSpace = SRGBColorSpace
  m = new SpriteMaterial({ map, transparent: true, depthWrite: false, toneMapped: false })
  chipMaterials.set(key, m)
  return m
}
const noRaycast = () => undefined
const tmpObject = new Object3D()

/**
 * Flat bar on the floor in front of the disc. Backing plane plus a fill scaled to the ratio,
 * coloured by band; up to `MAX_PIPS` points get divider pips (one instanced mesh).
 */
function HpBar({ current, max, radius }: { current: number; max: number; radius: number }) {
  const s = hud()
  const w = radius * 1.8
  const h = radius * 0.22
  const ratio = Math.min(1, Math.max(0, current / max))
  const band = hpBand(current, max)
  const pips = max <= MAX_PIPS ? Math.max(0, Math.round(max) - 1) : 0
  const dividers = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = dividers.current
    if (!m || pips <= 0) return
    for (let i = 0; i < pips; i++) {
      tmpObject.position.set(-w / 2 + (w * (i + 1)) / (pips + 1), 0, 0.001)
      tmpObject.scale.set(Math.max(0.012 * radius, w * 0.025), h, 1)
      tmpObject.updateMatrix()
      m.setMatrixAt(i, tmpObject.matrix)
    }
    m.count = pips
    m.instanceMatrix.needsUpdate = true
  }, [pips, w, h, radius])
  return (
    <group rotation-x={-Math.PI / 2} position={[0, 0, radius * 1.12 + h]} raycast={noRaycast}>
      <mesh geometry={s.plane} material={s.back} scale={[w + h, h * 1.8, 1]} renderOrder={4} raycast={noRaycast} />
      {ratio > 0 && (
        <mesh geometry={s.plane} material={s.bands[band]} position={[-(w - w * ratio) / 2, 0, 0.0005]} scale={[w * ratio, h, 1]} renderOrder={5} raycast={noRaycast} />
      )}
      {pips > 0 && <instancedMesh key={pips} ref={dividers} args={[s.plane, s.divider, pips]} renderOrder={6} frustumCulled={false} raycast={noRaycast} />}
    </group>
  )
}

/** Camera-facing lettered chips around the rim of the disc, one sprite each with a shared material per look. */
function ConditionGlyphs({ chips, radius }: { chips: ConditionChip[]; radius: number }) {
  const size = radius * 0.55
  const ringR = radius * 1.2
  const y = radius * 0.22 + size * 0.5
  return (
    <>
      {chips.map((c, i) => {
        const a = chipAngle(i)
        return (
          <sprite key={c.id} material={chipMaterial(c)} position={[Math.cos(a) * ringR, y, -Math.sin(a) * ringR]} scale={[size, size, 1]} renderOrder={7} raycast={noRaycast} />
        )
      })}
    </>
  )
}

/** Unit-radius floor geometry per owner shape (and a fatter copy for the dark outline behind it). */
const shapeGeometries = new Map<string, ShapeGeometry | CircleGeometry>()
function ownerShapeGeometry(shape: OwnerShape, outline: boolean): ShapeGeometry | CircleGeometry {
  const key = `${shape}:${outline}`
  let g = shapeGeometries.get(key)
  if (g) return g
  const grow = outline ? 1.35 : 1
  const pts = shapePoints(shape)
  if (!pts) g = new CircleGeometry(grow, 24)
  else {
    const s = new Shape()
    // shapePoints' y points down the screen; the ring's plane is rotated so local +y is away from the camera.
    s.moveTo(pts[0]!.x * grow, -pts[0]!.y * grow)
    for (const p of pts.slice(1)) s.lineTo(p.x * grow, -p.y * grow)
    s.closePath()
    g = new ShapeGeometry(s)
  }
  shapeGeometries.set(key, g)
  return g
}

/**
 * Permanent ring in the owner's presence colour; the viewer's own tokens get a thicker one. The
 * owner's shape (ownerShape.ts) sits on the ring at the back left, so who owns a token reads
 * without telling colours apart.
 */
function OwnerRing({ radius, color, mine, shape }: { radius: number; color: string; mine: boolean; shape: OwnerShape | null }) {
  const a = (3 * Math.PI) / 4
  const size = radius * 0.3
  return (
    <group rotation-x={-Math.PI / 2} position-y={0.004} raycast={noRaycast}>
      <mesh geometry={mine ? hud().ownRing : hud().ring} material={ownerMaterial(color)} scale={[radius, radius, 1]} renderOrder={3} raycast={noRaycast} />
      {shape && (
        <group position={[Math.cos(a) * radius * 1.1, Math.sin(a) * radius * 1.1, 0.002]} raycast={noRaycast}>
          <mesh geometry={ownerShapeGeometry(shape, true)} material={hud().divider} scale={[size, size, 1]} renderOrder={4} raycast={noRaycast} />
          <mesh geometry={ownerShapeGeometry(shape, false)} material={ownerMaterial(color)} position-z={0.001} scale={[size, size, 1]} renderOrder={5} raycast={noRaycast} />
        </group>
      )}
    </group>
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
  const { grid, floorY, viewer, walls, onIntent, onPresence } = useTable()
  const selected = useGame((s) => s.selectedTokens.includes(token.id))
  const setSelected = useGame((s) => s.setSelectedToken)
  const toggleSelected = useGame((s) => s.toggleSelected)
  const hovered = useTableUi((s) => s.hovered === token.id)
  const dragGhost = useTableUi((s) => (s.drag && s.drag.token === token.id ? s.drag : null))
  // Another selected token is being dragged: this one previews the same move (see groupMoveTargets).
  const groupDrag = useTableUi((s) => (s.drag && s.drag.token !== token.id ? s.drag : null))
  const inDragGroup = useGame((s) => groupDrag !== null && s.selectedTokens.includes(token.id) && s.selectedTokens.includes(groupDrag.token))
  // Dropped while the GM was away: stays where it was dropped, ghosted, until the doc catches up.
  const pending = useTableUi((s) => s.pending[token.id] ?? null)
  const targeting = useTableUi((s) => s.targeting !== null)
  const targetInside = useTableUi((s) => s.targeting?.inside.has(token.id) ?? false)
  const targetOutOfRange = useTableUi((s) => (s.targeting ? !s.targeting.inRange.has(token.id) : false))
  const uiSet = useTableUi((s) => s.set)
  // Live transform while the edit gizmo drags this token.
  const preview = useTableUi((s) => (s.editPreview && s.editPreview.target.kind === 'token' && s.editPreview.target.id === token.id ? s.editPreview : null))
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const modelUrl = useAssetUrl(token.model)
  const character = useGame((s) => (token.character ? s.characters[token.character] : undefined))
  const showHpToPlayers = useGame((s) => s.meta?.showHpToPlayers ?? false)
  const ownerPresence = useGame((s) => (token.owner ? s.presence[token.owner]?.color : undefined))
  const gmPubkey = useGame((s) => s.meta?.gm)
  const ownerShape = useGame((s) => ownerShapeIn(s, token.owner))
  const pack = useGame((s) => s.meta?.pack ?? null)
  // Whose turn it is: a boolean per token, so a turn change re-renders two tokens, not all of them.
  const isTurn = useGame((s) => inCurrentSlot(s.initiative, token.id))
  // The pack (resources, conditions) comes from the session's rules engine; the Canvas bridges the context.
  const rules = useSession().controller?.rules ?? null

  const group = useRef<Group>(null)
  const body = useRef<Group>(null)
  const hudGroup = useRef<Group>(null)
  const light = useRef<PointLight>(null)
  const controllable = canControl(viewer, token)
  useCursor(hovered && controllable, 'grab')
  useCursor(dragGhost !== null, 'grabbing')
  const groupGhost = useMemo(() => {
    if (!groupDrag || !inDragGroup || !controllable) return null
    return snapToCell(grid, token.position.x + (groupDrag.x - groupDrag.from.x), token.position.z + (groupDrag.z - groupDrag.from.z))
  }, [groupDrag, inDragGroup, controllable, grid, token.position.x, token.position.z])
  /** Position preview while this token, or its selection group, is being dragged. */
  const ghostPos = dragGhost ?? groupGhost

  const cell = grid.cellSize
  const scale = preview?.scale ?? token.scale
  const rotationY = preview?.rotationY ?? token.rotationY
  const elevation = Math.max(0, preview?.elevation ?? token.elevation ?? 0)
  const radius = 0.38 * cell * scale
  const phase = useMemo(() => hashPhase(token.id), [token.id])
  const gmView = !viewer || viewer.isGm
  const mine = !!viewer && token.owner === viewer.pubkey
  const showState = gmView || showHpToPlayers
  const primary = rules?.pack.resources[0]
  const hp = useMemo(() => {
    if (!showState || !character || !rules || !primary) return null
    return readResource(character.data, primary, (expr) => rules.evaluateNow(expr, character))
  }, [showState, character, rules, primary])
  const vital = vitalState(hp)
  const defense = useMemo(() => {
    const attr = showState ? defenseAttribute(rules?.pack.attributes) : undefined
    if (!attr || !character || !rules) return null
    const v = readDefense(character.data, attr, (expr) => rules.evaluateNow(expr, character))
    return v === null ? null : `${defenseAbbr(attr)} ${v}`
  }, [showState, character, rules])
  const chips = useMemo(
    () => (showState ? conditionChips(token, character, rules?.pack.conditions ?? []) : []),
    [showState, token, character, rules],
  )

  // Smoothly follow the committed position (or the drag ghost / edit preview), with an idle bob.
  const current = useRef(new Vector3(token.position.x, floorY, token.position.z))
  useFrame(({ clock }, dt) => {
    const g = group.current
    if (!g) return
    const tx = ghostPos ? ghostPos.x : pending ? pending.x : preview ? preview.position.x : token.position.x
    const tz = ghostPos ? ghostPos.z : pending ? pending.z : preview ? preview.position.z : token.position.z
    const k = 1 - Math.exp(-dt * (ghostPos || preview ? 18 : 10))
    current.current.x += (tx - current.current.x) * k
    current.current.z += (tz - current.current.z) * k
    const t = clock.elapsedTime
    const bob = Math.sin(t * 1.6 + phase) * 0.012 * cell
    const lift = ghostPos ? 0.25 * cell : 0
    g.position.set(current.current.x, floorY, current.current.z)
    if (body.current) {
      body.current.position.y = bob + lift + elevation
      body.current.rotation.y = rotationY
    }
    if (hudGroup.current) hudGroup.current.position.y = lift + elevation + 0.012
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

  /** Plain tap: this token alone. Shift / Cmd / Ctrl or touch Select mode: toggle it in the set. */
  const select = (e?: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (e && isAdditiveSelect(e, useTableUi.getState().multiSelect)) toggleSelected(token.id)
    else setSelected(token.id)
  }
  /** Right-click / long-press: the token becomes the primary selection (the set is kept when it is a member) and the menu opens there. */
  const openMenu = (x: number, y: number, radial = false) => {
    const s = useGame.getState()
    if (s.selectedTokens.includes(token.id)) s.selectMany(s.selectedTokens, token.id)
    else s.setSelectedToken(token.id)
    uiSet({ contextMenu: { token: token.id, x, y, ...(radial ? { radial } : {}) } })
  }

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
        // The rest of the selection moves by the same delta: one intent per token the viewer may move.
        const s = useGame.getState()
        for (const m of groupMoveTargets(ghost, s.tokens, s.selectedTokens)) {
          const t = s.tokens[m.token]
          if (!t || !canControl(viewer, t)) continue
          const p = snapToCell(grid, m.x, m.z)
          if (Math.abs(p.x - t.position.x) > 1e-4 || Math.abs(p.z - t.position.z) > 1e-4) {
            onIntent({ type: 'token.move', token: m.token, position: { x: p.x, y: floorY, z: p.z } })
          }
        }
      }
    }
  }

  // While a skill is being aimed the targeting layer owns the pointer; let events fall through to it.
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (targeting) return
    e.stopPropagation()
    if (e.button === 2) return // the contextmenu event that follows selects and opens the menu
    if (e.button !== 0) return
    if (!controllable) {
      // Not ours to edit; a double tap here still ends edit mode.
      if (tapTwice(`token:${token.id}`, e.nativeEvent.clientX, e.nativeEvent.clientY)) doubleTapEdit(null)
      select(e.nativeEvent)
      return
    }
    capture(e).setPointerCapture(e.pointerId)
    uiSet({ grab: token.id })
    drag.current = {
      pointerId: e.pointerId, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY, moved: false,
      longPress: e.pointerType === 'touch'
        ? setTimeout(() => {
          const held = drag.current
          if (held && !held.moved) { endDrag(false); openMenu(held.startX, held.startY, true) }
        }, LONG_PRESS_MS)
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
    // Players cannot drag through walls or closed doors: the ghost stays on the last cell in reach.
    if (!gmView && moveBlocked(token.position, snapped, walls)) return
    const key = `${snapped.cell.q},${snapped.cell.r}`
    if (key !== d.lastCell) {
      d.lastCell = key
      uiSet({ drag: { token: token.id, x: snapped.x, z: snapped.z, from: { x: token.position.x, z: token.position.z } } })
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
    if (!wasClick) return
    // Double tap: edit this token (gizmo), or leave edit mode when already editing.
    if (tapTwice(`token:${token.id}`, e.nativeEvent.clientX, e.nativeEvent.clientY) && doubleTapEdit({ kind: 'token', id: token.id })) return
    select(e.nativeEvent)
  }

  useEffect(() => () => { if (drag.current) endDrag(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The document moved on (the GM applied the queued move, or moved the token elsewhere): the truth wins.
  useEffect(() => {
    if (pending && (token.position.x !== pending.from.x || token.position.z !== pending.from.z)) clearPendingMove(token.id)
  }, [pending, token.id, token.position.x, token.position.z])

  if (token.hidden && !gmView) return null
  const dimmed = token.hidden || targetOutOfRange
  const ghost = pending !== null && !dragGhost

  const ringColor = ownerRingColor(token.owner, gmPubkey, viewer?.pubkey ?? null, ownerPresence)
  // While the viewer drags it, the distance label takes the name's place over the ghost.
  const showName = !dragGhost && nameplateShown({ mine, selected, hovered, current: isTurn })
  // Above the disc top, or above a mini's head (minis are fitted to about a cell tall at most).
  const nameY = (modelUrl ? 0.95 * cell * scale : radius * 0.22 + 0.12 * cell)
  const disc = <Disc token={token} radius={radius} dimmed={dimmed} ghost={ghost} selected={selected} parentYaw={rotationY} />

  return (
    <>
    <group
      ref={group}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => endDrag(false)}
      onLostPointerCapture={() => endDrag(false)}
      onContextMenu={(e) => {
        if (targeting) return
        e.stopPropagation()
        e.nativeEvent.preventDefault()
        // Players get the menu on their own tokens only; another token just gets selected.
        if (controllable) openMenu(e.nativeEvent.clientX, e.nativeEvent.clientY)
        else select()
      }}
      onPointerOver={(e) => { if (targeting) return; e.stopPropagation(); uiSet({ hovered: token.id }) }}
      onPointerOut={() => { if (useTableUi.getState().hovered === token.id) uiSet({ hovered: null }) }}
    >
      {/* Lifted part: the mini, its rings and light. The group below stays on the floor. */}
      <group ref={body} position-y={elevation} rotation-y={rotationY}>
        {modelUrl ? (
          <ModelBoundary fallback={disc}>
            <Suspense fallback={disc}>
              <GlbMini url={modelUrl} scale={scale} fitCell={cell} mini selected={selected} />
            </Suspense>
          </ModelBoundary>
        ) : disc}
        {ghost && (
          // Amber "waiting" ring under a move the GM has not applied yet; minis cannot fade, so they get the ring alone.
          <mesh rotation-x={-Math.PI / 2} position-y={0.01} renderOrder={4} raycast={() => undefined}>
            <ringGeometry args={[radius * 1.15, radius * 1.3, 48]} />
            <meshBasicMaterial color="#e0a458" transparent opacity={0.6} depthWrite={false} />
          </mesh>
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
      {/* Combat state and the owner marker follow the lift but not the facing, so the bar always sits in front. */}
      <group ref={hudGroup} position-y={elevation + 0.012} raycast={noRaycast}>
        {ringColor && <OwnerRing radius={radius} color={ringColor} mine={mine} shape={ownerShape} />}
        {isTurn && <TurnRing radius={radius} />}
        {showName && <Nameplate name={token.name} y={nameY} accent={ringColor} mine={mine && !gmView} current={isTurn} shape={ringColor ? ownerShape : null} />}
        {hp && <HpBar current={hp.current} max={hp.max} radius={radius} />}
        {chips.length > 0 && <ConditionGlyphs chips={chips} radius={radius} />}
        {(vital || defense) && <CombatBadges vital={vital} defense={defense} radius={radius} />}
      </group>
      <BlobShadow radius={radius} elevation={elevation} cell={cell} faded={dimmed || ghost} />
      {elevation > 0.01 && <ElevationMarker elevation={elevation} cell={cell} />}
    </group>
    {dragGhost && <MoveTrail grid={grid} from={dragGhost.from} to={dragGhost} y={floorY + 0.014} pack={pack} />}
    </>
  )
}

/** Thin plumb line from the floor up to a lifted token, so height reads at a glance. */
function ElevationMarker({ elevation, cell }: { elevation: number; cell: number }) {
  return (
    <mesh position-y={elevation / 2} raycast={noRaycast}>
      <cylinderGeometry args={[0.012 * cell, 0.012 * cell, elevation, 6]} />
      <meshBasicMaterial color="#f3ead8" transparent opacity={0.55} depthWrite={false} />
    </mesh>
  )
}

/** Soft radial shadow texture shared by every blob shadow. */
let blobTexture: CanvasTexture | null = null
function blobMap(): CanvasTexture {
  if (blobTexture) return blobTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(0,0,0,1)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.75)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  blobTexture = new CanvasTexture(canvas)
  return blobTexture
}
const blobMaterials = new Map<number, MeshBasicMaterial>()
function blobMaterial(opacity: number): MeshBasicMaterial {
  const key = Math.round(opacity * 20) / 20
  let m = blobMaterials.get(key)
  if (!m) {
    m = new MeshBasicMaterial({ map: blobMap(), transparent: true, opacity: key, depthWrite: false, toneMapped: false })
    blobMaterials.set(key, m)
  }
  return m
}

/**
 * Blob shadow on the floor under the base: grounds the token on every graphics tier, including
 * those without shadow maps. It widens and fades as the token is lifted (`blobShadowLook`).
 */
function BlobShadow({ radius, elevation, cell, faded }: { radius: number; elevation: number; cell: number; faded: boolean }) {
  const look = blobShadowLook(elevation, cell)
  const size = 2 * radius * look.scale
  return (
    <mesh geometry={hud().plane} material={blobMaterial(look.opacity * (faded ? 0.5 : 1))} rotation-x={-Math.PI / 2} position-y={0.003}
      scale={[size, size, 1]} renderOrder={1} raycast={noRaycast} />
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

/**
 * Aiming a skill on the table. Mounted inside the <Canvas> while `TableCanvasProps.targeting`
 * is set: an invisible floor plane follows the pointer, the shape preview is drawn on the floor,
 * tokens inside are highlighted (via `useTableUi().targeting`) and a tap picks.
 *
 * Mouse: move to aim, click to pick. Touch: drag to aim, lift to stage the pick; the host shows a
 * confirm button (`TargetingBar`) so a stray tap never fires a spell. A tap on the source token,
 * the Cancel button or Esc cancels. Tokens do not take pointer events while targeting is active.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Plane, Shape, ShapeGeometry, Vector3 } from 'three'
import type { Token } from '@/core/doc'
import type { TargetShape, Vec2, Vec3 } from '@/core/geometry'
import type { TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import { useTable } from './context'
import type { Bounds2 } from './grid'
import { useTableUi } from './tableState'
import { resolveShape, shapeOutline, tokenAt, tokensInRange, tokensInShape, type ResolvedShape } from './targeting'

export interface TargetingProps {
  shape: TargetShape
  source: TokenId
  onPick(result: { targets: TokenId[]; point?: Vec3 }): void
  onCancel(): void
}

const DRAG_THRESHOLD_PX = 8
const FILL = '#ff9a3c'
const noRaycast = () => undefined

type CaptureTarget = { setPointerCapture(id: number): void; releasePointerCapture(id: number): void }
const capture = (e: ThreeEvent<PointerEvent>) => {
  const t = e.target as unknown as CaptureTarget
  return {
    set(id: number) { try { t.setPointerCapture(id) } catch { /* Safari after a cancelled touch */ } },
    release(id: number) { try { t.releasePointerCapture(id) } catch { /* ditto */ } },
  }
}

/** Token forward direction (local -Z rotated by rotationY) as atan2(z, x). */
function facingOf(token: Token): number {
  return Math.atan2(-Math.cos(token.rotationY), -Math.sin(token.rotationY))
}

function polygonGeometry(points: Vec2[]): ShapeGeometry | null {
  if (points.length < 3) return null
  const shape = new Shape()
  // ShapeGeometry lies in XY; we rotate the mesh -90deg about X so y -> -z. Flip the sign here.
  shape.moveTo(points[0]!.x, -points[0]!.y)
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i]!.x, -points[i]!.y)
  shape.closePath()
  return new ShapeGeometry(shape)
}

function loopGeometry(points: Vec2[], y: number): BufferGeometry {
  const arr: number[] = []
  for (const p of points) arr.push(p.x, y, p.y)
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(arr, 3))
  return g
}

function circlePoints(c: Vec2, r: number, n = 64): Vec2[] {
  const pts: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r })
  }
  return pts
}

export function TargetingLayer({ targeting, bounds }: { targeting: TargetingProps; bounds: Bounds2 }) {
  const { shape, source, onPick, onCancel } = targeting
  const { grid, floorY, sceneId, viewer } = useTable()
  const tokens = useGame((s) => s.tokens)
  const uiSet = useTableUi((s) => s.set)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const sourceToken = tokens[source]
  const gmView = !viewer || viewer.isGm

  const candidates = useMemo(
    () => Object.values(tokens).filter((t) => t.scene === sceneId && (gmView || !t.hidden)).map((t) => ({ id: t.id as string, x: t.position.x, z: t.position.z, scale: t.scale })),
    [tokens, sceneId, gmView],
  )
  const srcPos: Vec2 = useMemo(
    () => ({ x: sourceToken?.position.x ?? 0, y: sourceToken?.position.z ?? 0 }),
    [sourceToken?.position.x, sourceToken?.position.z],
  )
  const facing = sourceToken ? facingOf(sourceToken) : 0

  // Pointer position on the floor; starts on the source so the preview shows at once.
  const [pointer, setPointer] = useState<Vec2>(srcPos)
  const resolved: ResolvedShape = useMemo(() => resolveShape(grid, shape, srcPos, pointer, facing), [grid, shape, srcPos, pointer, facing])
  const inRange = useMemo(() => new Set(tokensInRange(grid, shape, srcPos, candidates, source) as TokenId[]), [grid, shape, srcPos, candidates, source])
  const hovered = useMemo<TokenId | null>(() => {
    if (shape.kind !== 'single') return null
    const id = tokenAt(pointer, candidates, grid.cellSize) as TokenId | null
    return id && inRange.has(id) ? id : null
  }, [shape.kind, pointer, candidates, grid.cellSize, inRange])
  const inside = useMemo(() => {
    if (shape.kind === 'single') return new Set<TokenId>(hovered ? [hovered] : [])
    return new Set(tokensInShape(resolved, candidates, source) as TokenId[])
  }, [shape.kind, hovered, resolved, candidates, source])

  /** What a tap at the current pointer would pick; null when nothing valid is under it. */
  const pickAt = (p: Vec2): { targets: TokenId[]; point: Vec3 } | null => {
    const r = resolveShape(grid, shape, srcPos, p, facing)
    const point = (q: Vec2): Vec3 => ({ x: q.x, y: floorY, z: q.y })
    switch (r.kind) {
      case 'self':
        return { targets: [source], point: point(srcPos) }
      case 'single': {
        const id = tokenAt(p, candidates, grid.cellSize) as TokenId | null
        if (!id || !inRange.has(id)) return null
        const t = tokens[id]!
        return { targets: [id], point: point({ x: t.position.x, y: t.position.z }) }
      }
      case 'radius':
        return { targets: tokensInShape(r, candidates, source) as TokenId[], point: point(r.center) }
      case 'cone':
      case 'line': {
        const d = Math.hypot(p.x - srcPos.x, p.y - srcPos.y)
        const reach = (shape.kind === 'cone' || shape.kind === 'line' ? shape.range : 0) * grid.cellSize
        const k = d > reach && d > 0 ? reach / d : 1
        return { targets: tokensInShape(r, candidates, source) as TokenId[], point: point({ x: srcPos.x + (p.x - srcPos.x) * k, y: srcPos.y + (p.y - srcPos.y) * k }) }
      }
    }
  }

  // Publish highlights for TokenMesh; keep the touch candidate across pointer updates.
  useEffect(() => {
    uiSet({ targeting: { source, inside, inRange, hovered, candidate: useTableUi.getState().targeting?.candidate ?? null } })
  }, [source, inside, inRange, hovered, uiSet])
  useEffect(() => {
    uiSet({ targeting: { source, inside: new Set(), inRange: new Set(), hovered: null, candidate: null }, hovered: null, grab: null, drag: null })
    return () => { uiSet({ targeting: null }); if (controls) controls.enabled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, shape])

  const drag = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean; touch: boolean } | null>(null)
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), -floorY), [floorY])
  const hit = useMemo(() => new Vector3(), [])

  const pointAt = (e: ThreeEvent<PointerEvent>): Vec2 | null => {
    if (!e.ray.intersectPlane(plane, hit)) return null
    return { x: hit.x, y: hit.z }
  }
  const stage = (p: Vec2, touch: boolean) => {
    const result = pickAt(p)
    if (!result) { uiSet({ targeting: { ...useTableUi.getState().targeting!, candidate: null } }); return }
    if (touch) uiSet({ targeting: { ...useTableUi.getState().targeting!, candidate: result } })
    else onPick(result)
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button === 2) { e.stopPropagation(); onCancel(); return }
    if (e.button !== 0) return
    e.stopPropagation()
    capture(e).set(e.pointerId)
    if (controls) controls.enabled = false
    drag.current = { pointerId: e.pointerId, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY, moved: false, touch: e.pointerType === 'touch' }
    const p = pointAt(e)
    if (p) setPointer(p)
  }
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (d && e.pointerId !== d.pointerId) return
    const p = pointAt(e)
    if (!p) return
    if (d) {
      e.stopPropagation()
      if (!d.moved && Math.hypot(e.nativeEvent.clientX - d.startX, e.nativeEvent.clientY - d.startY) >= DRAG_THRESHOLD_PX) d.moved = true
      if (d.touch && !d.moved) return // a steady finger keeps the preview where it landed
    }
    setPointer(p)
  }
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    capture(e).release(e.pointerId)
    drag.current = null
    if (controls) controls.enabled = true
    const p = pointAt(e) ?? pointer
    setPointer(p)
    // A plain tap on the caster cancels (an aimed drag that ends there does not).
    if (!d.moved && shape.kind !== 'self' && tokenAt(p, candidates, grid.cellSize) === source) { onCancel(); return }
    stage(p, d.touch)
  }
  const onPointerCancel = () => {
    if (!drag.current) return
    drag.current = null
    if (controls) controls.enabled = true
  }

  // --- preview geometry -------------------------------------------------------------------
  const y = floorY + 0.02
  const fillGeo = useMemo(() => (resolved.kind === 'self' || resolved.kind === 'single' ? null : polygonGeometry(shapeOutline(resolved))), [resolved])
  useEffect(() => () => fillGeo?.dispose(), [fillGeo])
  const outlineGeo = useMemo(() => (resolved.kind === 'self' || resolved.kind === 'single' ? null : loopGeometry(shapeOutline(resolved), 0)), [resolved])
  useEffect(() => () => outlineGeo?.dispose(), [outlineGeo])
  const rangeWorld = shape.kind === 'self' ? 0 : shape.range * grid.cellSize
  const rangeGeo = useMemo(() => (rangeWorld > 0 ? loopGeometry(circlePoints(srcPos, rangeWorld), 0) : null), [srcPos, rangeWorld])
  useEffect(() => () => rangeGeo?.dispose(), [rangeGeo])
  const hoveredToken = hovered ? tokens[hovered] : undefined

  const w = bounds.maxX - bounds.minX + 40 * grid.cellSize
  const h = bounds.maxZ - bounds.minZ + 40 * grid.cellSize

  return (
    <group>
      {/* pointer catcher */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[(bounds.minX + bounds.maxX) / 2, floorY + 0.001, (bounds.minZ + bounds.maxZ) / 2]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onContextMenu={(e) => { e.stopPropagation(); e.nativeEvent.preventDefault() }}
      >
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {/* range circle around the caster */}
      {rangeGeo && (
        <lineLoop geometry={rangeGeo} position-y={y} raycast={noRaycast} renderOrder={4}>
          <lineBasicMaterial color="#ffd166" transparent opacity={0.45} depthWrite={false} />
        </lineLoop>
      )}
      {/* the shape */}
      {fillGeo && (
        <mesh geometry={fillGeo} rotation-x={-Math.PI / 2} position-y={y} raycast={noRaycast} renderOrder={4}>
          <meshBasicMaterial color={FILL} transparent opacity={0.28} depthWrite={false} side={DoubleSide} />
        </mesh>
      )}
      {outlineGeo && (
        <lineLoop geometry={outlineGeo} position-y={y + 0.005} raycast={noRaycast} renderOrder={5}>
          <lineBasicMaterial color={FILL} transparent opacity={0.9} depthWrite={false} />
        </lineLoop>
      )}
      {/* caster marker */}
      {sourceToken && (
        <mesh rotation-x={-Math.PI / 2} position={[srcPos.x, y, srcPos.y]} raycast={noRaycast} renderOrder={4}>
          <ringGeometry args={[0.44 * grid.cellSize * sourceToken.scale, 0.5 * grid.cellSize * sourceToken.scale, 48]} />
          <meshBasicMaterial color="#ffd166" transparent opacity={0.8} depthWrite={false} />
        </mesh>
      )}
      {/* hovered single target */}
      {hoveredToken && (
        <mesh rotation-x={-Math.PI / 2} position={[hoveredToken.position.x, y + 0.01, hoveredToken.position.z]} raycast={noRaycast} renderOrder={5}>
          <ringGeometry args={[0.5 * grid.cellSize * hoveredToken.scale, 0.6 * grid.cellSize * hoveredToken.scale, 48]} />
          <meshBasicMaterial color={FILL} transparent opacity={0.95} depthWrite={false} />
        </mesh>
      )}
      {/* pointer dot for area shapes */}
      {(resolved.kind === 'radius' || resolved.kind === 'cone' || resolved.kind === 'line') && (
        <mesh rotation-x={-Math.PI / 2} position={[resolved.kind === 'radius' ? resolved.center.x : pointer.x, y + 0.01, resolved.kind === 'radius' ? resolved.center.y : pointer.y]} raycast={noRaycast} renderOrder={5}>
          <circleGeometry args={[0.08 * grid.cellSize, 24]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

/** Short label for the bar: what the player is doing. */
export function describeShape(shape: TargetShape): string {
  switch (shape.kind) {
    case 'self': return 'targets yourself'
    case 'single': return `pick a target within ${shape.range} cells`
    case 'radius': return `aim a ${shape.radius}-cell burst within ${shape.range} cells`
    case 'cone': return `aim a cone, ${shape.range} cells long`
    case 'line': return `aim a line, ${shape.range} cells long`
  }
}

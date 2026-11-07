/**
 * Aiming a skill on the table. Mounted inside the <Canvas> while `TableCanvasProps.targeting`
 * is set: an invisible floor plane follows the pointer, the shape preview is drawn on the floor,
 * tokens inside are highlighted (via `useTableUi().targeting`) and a tap picks.
 *
 * Every pointer type stages first: move or drag to aim, click or lift to stage the pick; the host
 * shows the staged targets with Cast / Cancel (`TargetingBar`) so a stray click never fires a
 * spell. A staged pick holds the preview until the next press re-aims. A tap on the source
 * token, the Cancel button, right click or Esc cancels. Tokens do not take pointer events while
 * targeting is active. The pure staging rules live in `stageTargeting`.
 *
 * The preview speaks the telegraph language (telegraph.ts): colour by who owns the effect and what
 * it does, a dashed rim while aiming and a solid one once staged, sawtooth teeth and a hatch for
 * hostile effects, a "+" pattern for heals, a centre badge, a dimmed template when it is not the
 * caster's turn, and a warning marker over each ally caught in a harmful template.
 *
 * Touch on area shapes (burst, cone, line): the aim snaps to cell centres, and while the finger
 * drags it sits `FINGER_OFFSET_PX` above the touch point so the finger never covers the template.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Plane, Raycaster, Shape, ShapeGeometry, Vector2, Vector3, type Texture } from 'three'
import type { Token } from '@/core/doc'
import type { TargetShape, Vec2, Vec3 } from '@/core/geometry'
import type { TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import { useTable } from './context'
import type { Bounds2 } from './grid'
import { useTableUi } from './tableState'
import {
  fingerAimPoint, isAreaShape, resolveShape, shapeOutline, snapAim, stageTargeting, tokenAt, tokensInRange, tokensInShape, type ResolvedShape,
} from './targeting'
import { dashSegments, sawtooth, sides, telegraphKind, telegraphStyle, type SkillIntent } from './telegraph'
import { badgeMaterial, friendlyFireMaterial, patternTexture } from './telegraphTextures'
import { MEASURE } from '@/ui/theme/palette'

export interface TargetingProps {
  /** Skill name for the bar ("Fireball → Bramble, Nettle"). */
  name: string
  shape: TargetShape
  source: TokenId
  /** Called with the staged pick once the user confirms. */
  onPick(result: { targets: TokenId[]; point?: Vec3 }): void
  onCancel(): void
  /** Marks tokens the bar should warn about before casting (another player's character). */
  isPlayerCharacter?(id: TokenId): boolean
  /** What the skill does (telegraph.ts `skillIntent`): picks the template look and the bar's verb. */
  intent?: SkillIntent
}

const DRAG_THRESHOLD_PX = 8
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

/** Separate line segments (for `lineSegments`), e.g. the dashes of a rim. */
function segmentsGeometry(segments: [Vec2, Vec2][], y: number): BufferGeometry {
  const arr: number[] = []
  for (const [a, b] of segments) arr.push(a.x, y, a.y, b.x, y, b.y)
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(arr, 3))
  return g
}

function centroid(points: Vec2[]): Vec2 {
  let x = 0
  let y = 0
  for (const p of points) { x += p.x; y += p.y }
  return points.length ? { x: x / points.length, y: y / points.length } : { x: 0, y: 0 }
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
  const { shape, source, onCancel, intent, isPlayerCharacter } = targeting
  const { grid, floorY, sceneId, viewer } = useTable()
  const tokens = useGame((s) => s.tokens)
  const uiSet = useTableUi((s) => s.set)
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null
  const sourceToken = tokens[source]
  const gmView = !viewer || viewer.isGm
  const staged = useTableUi((s) => s.targeting?.candidate != null)
  // Combat is on and someone else has the turn: this caster's template steps back.
  const dimmed = useGame((s) => !!s.initiative?.active && !!s.initiative.order.length && s.initiative.order[s.initiative.turn]?.token !== source)
  const isPlayer = (id: TokenId) => isPlayerCharacter?.(id) ?? true
  const style = telegraphStyle(telegraphKind(intent, isPlayer(source)), { staged, dimmed })

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
    uiSet({ targeting: { source, inside, inRange, hovered, color: style.color, candidate: useTableUi.getState().targeting?.candidate ?? null } })
  }, [source, inside, inRange, hovered, uiSet, style.color])
  useEffect(() => {
    uiSet({ targeting: { source, inside: new Set(), inRange: new Set(), hovered: null, candidate: null }, hovered: null, grab: null, drag: null })
    return () => { uiSet({ targeting: null }); if (controls) controls.enabled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, shape])

  const drag = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean; touch: boolean } | null>(null)
  const plane = useMemo(() => new Plane(new Vector3(0, 1, 0), -floorY), [floorY])
  const hit = useMemo(() => new Vector3(), [])
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const offsetRay = useMemo(() => new Raycaster(), [])
  const ndc = useMemo(() => new Vector2(), [])

  const pointAt = (e: ThreeEvent<PointerEvent>): Vec2 | null => {
    if (!e.ray.intersectPlane(plane, hit)) return null
    return { x: hit.x, y: hit.z }
  }
  const area = isAreaShape(shape)
  /**
   * Where a touch aims an area shape: snapped to the grid, and while the finger drags, through a
   * point a finger-width above it so the template stays visible. Other input aims at the pointer.
   */
  const aimAt = (e: ThreeEvent<PointerEvent>, touch: boolean, dragging: boolean): Vec2 | null => {
    if (!touch || !area) return pointAt(e)
    let p: Vec2 | null
    if (dragging) {
      const rect = gl.domElement.getBoundingClientRect()
      const f = fingerAimPoint(e.nativeEvent.clientX, e.nativeEvent.clientY, rect)
      ndc.set(((f.x - rect.left) / rect.width) * 2 - 1, -((f.y - rect.top) / rect.height) * 2 + 1)
      offsetRay.setFromCamera(ndc, camera)
      p = offsetRay.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.z } : pointAt(e)
    } else {
      p = pointAt(e)
    }
    return p ? snapAim(grid, p) : null
  }
  /** A lift stages the pick for the bar's Cast button (or cancels on a plain tap on the caster). */
  const stage = (p: Vec2, onCaster: boolean) => {
    const ui = useTableUi.getState().targeting
    const r = stageTargeting(ui?.candidate ?? null, { kind: 'lift', pick: pickAt(p), onCaster })
    if (r.cancelled) { onCancel(); return }
    if (ui) uiSet({ targeting: { ...ui, candidate: r.staged } })
  }

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button === 2) { e.stopPropagation(); onCancel(); return }
    if (e.button !== 0) return
    e.stopPropagation()
    capture(e).set(e.pointerId)
    if (controls) controls.enabled = false
    const touch = e.pointerType === 'touch'
    drag.current = { pointerId: e.pointerId, startX: e.nativeEvent.clientX, startY: e.nativeEvent.clientY, moved: false, touch }
    const p = aimAt(e, touch, false)
    if (p) setPointer(p)
  }
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (d && e.pointerId !== d.pointerId) return
    // A staged pick holds the preview where it was aimed; the next press starts aiming again.
    if (!d && useTableUi.getState().targeting?.candidate) return
    if (d) {
      e.stopPropagation()
      if (!d.moved && Math.hypot(e.nativeEvent.clientX - d.startX, e.nativeEvent.clientY - d.startY) >= DRAG_THRESHOLD_PX) d.moved = true
      if (d.touch && !d.moved) return // a steady finger keeps the preview where it landed
    }
    const p = aimAt(e, !!d?.touch, !!d?.moved)
    if (!p) return
    setPointer(p)
  }
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    e.stopPropagation()
    capture(e).release(e.pointerId)
    drag.current = null
    if (controls) controls.enabled = true
    const p = aimAt(e, d.touch, d.moved) ?? pointer
    setPointer(p)
    // A plain tap on the caster cancels (an aimed drag that ends there does not).
    stage(p, !d.moved && shape.kind !== 'self' && tokenAt(p, candidates, grid.cellSize) === source)
  }
  const onPointerCancel = () => {
    if (!drag.current) return
    drag.current = null
    if (controls) controls.enabled = true
  }

  // --- preview geometry -------------------------------------------------------------------
  const y = floorY + 0.02
  const cell = grid.cellSize
  const outline = useMemo(() => (resolved.kind === 'self' || resolved.kind === 'single' ? null : shapeOutline(resolved)), [resolved])
  const fillGeo = useMemo(() => (outline ? polygonGeometry(outline) : null), [outline])
  useEffect(() => () => fillGeo?.dispose(), [fillGeo])
  const outlineGeo = useMemo(() => (outline ? loopGeometry(outline, 0) : null), [outline])
  useEffect(() => () => outlineGeo?.dispose(), [outlineGeo])
  const dashGeo = useMemo(() => (outline ? segmentsGeometry(dashSegments(outline, 0.32 * cell, 0.2 * cell), 0) : null), [outline, cell])
  useEffect(() => () => dashGeo?.dispose(), [dashGeo])
  const teethGeo = useMemo(() => (outline && style.teeth ? loopGeometry(sawtooth(outline, 0.4 * cell, 0.14 * cell), 0) : null), [outline, style.teeth, cell])
  useEffect(() => () => teethGeo?.dispose(), [teethGeo])
  const rangeWorld = shape.kind === 'self' ? 0 : shape.range * cell
  // Range is a measurement: neutral cream, dashed and thin.
  const rangeGeo = useMemo(() => (rangeWorld > 0 ? segmentsGeometry(dashSegments(circlePoints(srcPos, rangeWorld, 96), 0.25 * cell, 0.25 * cell), 0) : null), [srcPos, rangeWorld, cell])
  useEffect(() => () => rangeGeo?.dispose(), [rangeGeo])
  const hoveredToken = hovered ? tokens[hovered] : undefined
  const fillMap: Texture = patternTexture(style.fill)
  fillMap.repeat.set(1 / (0.5 * cell), 1 / (0.5 * cell))
  const badgeAt = outline ? (resolved.kind === 'radius' ? resolved.center : centroid(outline)) : null
  // Allies caught in a harmful template: a warning over each (the bar counts them too).
  const friendlyFire = useMemo(() => {
    if (intent === 'help' || intent === 'neutral' || shape.kind === 'self') return []
    return sides([...inside], source, isPlayer).allies.map((id) => tokens[id]).filter((t): t is Token => !!t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inside, source, intent, shape.kind, tokens, isPlayerCharacter])

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
        <lineSegments geometry={rangeGeo} position-y={y} raycast={noRaycast} renderOrder={4}>
          <lineBasicMaterial color={MEASURE} transparent opacity={0.55 * (dimmed ? 0.6 : 1)} depthWrite={false} />
        </lineSegments>
      )}
      {/* the shape: patterned fill, then a dashed (aiming) or solid (staged) rim, then hostile teeth */}
      {fillGeo && (
        <mesh geometry={fillGeo} rotation-x={-Math.PI / 2} position-y={y} raycast={noRaycast} renderOrder={4}>
          <meshBasicMaterial key={style.fill} color={style.color} map={fillMap} transparent opacity={style.fillOpacity} depthWrite={false} side={DoubleSide} toneMapped={false} />
        </mesh>
      )}
      {outlineGeo && !style.dashed && (
        <lineLoop geometry={outlineGeo} position-y={y + 0.005} raycast={noRaycast} renderOrder={5}>
          <lineBasicMaterial color={style.color} transparent opacity={style.rimOpacity} depthWrite={false} toneMapped={false} />
        </lineLoop>
      )}
      {dashGeo && style.dashed && (
        <lineSegments geometry={dashGeo} position-y={y + 0.005} raycast={noRaycast} renderOrder={5}>
          <lineBasicMaterial color={style.color} transparent opacity={style.rimOpacity} depthWrite={false} toneMapped={false} />
        </lineSegments>
      )}
      {teethGeo && (
        <lineLoop geometry={teethGeo} position-y={y + 0.006} raycast={noRaycast} renderOrder={5}>
          <lineBasicMaterial color={style.color} transparent opacity={style.rimOpacity} depthWrite={false} toneMapped={false} />
        </lineLoop>
      )}
      {badgeAt && style.badge && (
        <sprite material={badgeMaterial(style.badge)} position={[badgeAt.x, y + 0.35 * cell, badgeAt.y]} scale={[0.4 * cell, 0.4 * cell, 1]}
          renderOrder={8} raycast={noRaycast} />
      )}
      {friendlyFire.map((t) => (
        <sprite key={t.id} material={friendlyFireMaterial()} position={[t.position.x, y + (0.75 + (t.elevation ?? 0) / cell) * cell * Math.max(1, t.scale), t.position.z]}
          scale={[0.42 * cell, 0.42 * cell, 1]} renderOrder={9} raycast={noRaycast} />
      ))}
      {/* caster marker */}
      {sourceToken && (
        <mesh rotation-x={-Math.PI / 2} position={[srcPos.x, y, srcPos.y]} raycast={noRaycast} renderOrder={4}>
          <ringGeometry args={[0.44 * cell * sourceToken.scale, 0.5 * cell * sourceToken.scale, 48]} />
          <meshBasicMaterial color={style.color} transparent opacity={0.8 * (dimmed ? 0.5 : 1)} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {/* hovered single target */}
      {hoveredToken && (
        <mesh rotation-x={-Math.PI / 2} position={[hoveredToken.position.x, y + 0.01, hoveredToken.position.z]} raycast={noRaycast} renderOrder={5}>
          <ringGeometry args={[0.5 * cell * hoveredToken.scale, 0.6 * cell * hoveredToken.scale, 48]} />
          <meshBasicMaterial color={style.color} transparent opacity={style.rimOpacity} depthWrite={false} toneMapped={false} />
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

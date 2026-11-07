/**
 * Walls, doors and lights as props: the `light`, `wall` and `door` parts of a prop
 * (reports/One mode plan.md). Validation, the wall segment a prop carries, segments per level for
 * sight and movement, and who may open a door. Pure: no three.js, no Yjs, no React.
 *
 * ## Invisible props
 *
 * A wall stretched over a map image, a door in it, a bare light source: props with a part and
 * nothing to draw. They carry `NO_MODEL`, a reserved built-in AssetRef, rather than leaving
 * `model` out. Every prop path (validation, undo snapshots, the clipboard, saved groups,
 * instancing, the catalogue counts) can then keep treating `model` as always there, and a client
 * from before parts existed draws its missing-model marker instead of failing on a missing field.
 * Renderers ask `hasModel(prop)` and draw the GM-only gizmo instead.
 */
import type { AssetRef } from './assets'
import type { Prop, PropDoor, PropLight, PropWall, WallBlocks } from './doc'
import type { AssetHash } from './ids'
import { levelOfHeight } from './kits'

/** The model of a prop that is only a part (invisible wall, door or light source). Never fetched. */
export const NO_MODEL: AssetRef = Object.freeze({
  sha256: 'builtin:no-model' as AssetHash,
  kind: 'other',
  mime: 'application/x-vtt-part',
  size: 0,
  name: 'part',
  sources: [] as string[],
}) as AssetRef

export function isNoModel(ref: Pick<AssetRef, 'sha256'> | undefined): boolean {
  return !!ref && ref.sha256 === NO_MODEL.sha256
}

/** False for invisible walls, doors and light sources: nothing to load or draw for players. */
export function hasModel(prop: Pick<Prop, 'model'>): boolean {
  return !isNoModel(prop.model)
}

/** A door prop: clicking it opens or closes it, whatever the edit state (track A's pointer gating asks this). */
export function isDoorProp(prop: Pick<Prop, 'door'> | null | undefined): boolean {
  return !!prop?.door
}

export function isWallProp(prop: Pick<Prop, 'wall'> | null | undefined): boolean {
  return !!prop?.wall
}

export function isLightProp(prop: Pick<Prop, 'light'> | null | undefined): boolean {
  return !!prop?.light
}

/** Light defaults, shared by the shelf's sources, lit models and the migration of placed lights. */
export const WARM_LIGHT: PropLight = Object.freeze({ color: '#ffb35c', radius: 6, flicker: true }) as PropLight
export const COLD_LIGHT: PropLight = Object.freeze({ color: '#9cc8ff', radius: 6 }) as PropLight
export const SPOT_LIGHT: PropLight = Object.freeze({ color: '#fff1d6', radius: 6, kind: 'spot', angle: Math.PI / 6 }) as PropLight

// ------------------------------------------------------------- validation

export const LIGHT_RADIUS_MAX = 60
export const LIGHT_INTENSITY_MAX = 2
export const SEGMENT_LENGTH_MAX = 1000

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const HEX = /^#[0-9a-fA-F]{6}$/
const BLOCKS: readonly WallBlocks[] = ['sight', 'move', 'both']

export function badLight(v: unknown): string | null {
  if (!v || typeof v !== 'object') return 'light must be an object'
  const l = v as PropLight
  for (const k of Object.keys(l)) if (!['color', 'radius', 'intensity', 'flicker', 'kind', 'angle'].includes(k)) return `light cannot have ${k}`
  if (typeof l.color !== 'string' || !HEX.test(l.color)) return 'light colour must be #rrggbb'
  if (!finite(l.radius) || l.radius <= 0 || l.radius > LIGHT_RADIUS_MAX) return `light reach must be 0–${LIGHT_RADIUS_MAX} cells`
  if (l.intensity !== undefined && (!finite(l.intensity) || l.intensity < 0 || l.intensity > LIGHT_INTENSITY_MAX)) return `light intensity must be 0–${LIGHT_INTENSITY_MAX}`
  if (l.flicker !== undefined && typeof l.flicker !== 'boolean') return 'flicker must be true or false'
  if (l.kind !== undefined && l.kind !== 'point' && l.kind !== 'spot') return 'light kind must be point or spot'
  if (l.angle !== undefined && (!finite(l.angle) || l.angle <= 0 || l.angle >= Math.PI / 2)) return 'spot angle must be between 0 and 90°'
  return null
}

const badLength = (v: unknown, what: string): string | null =>
  v === undefined ? null : !finite(v) || v <= 0 || v > SEGMENT_LENGTH_MAX ? `${what} must be 0–${SEGMENT_LENGTH_MAX} m` : null

export function badWallPart(v: unknown): string | null {
  if (!v || typeof v !== 'object') return 'wall must be an object'
  const w = v as PropWall
  for (const k of Object.keys(w)) if (k !== 'length' && k !== 'blocks') return `wall cannot have ${k}`
  if (!BLOCKS.includes(w.blocks)) return 'wall blocks sight, move or both'
  return badLength(w.length, 'wall length')
}

export function badDoorPart(v: unknown): string | null {
  if (!v || typeof v !== 'object') return 'door must be an object'
  const d = v as PropDoor
  for (const k of Object.keys(d)) if (!['open', 'locked', 'width'].includes(k)) return `door cannot have ${k}`
  if (typeof d.open !== 'boolean') return 'door open must be true or false'
  if (d.locked !== undefined && typeof d.locked !== 'boolean') return 'door locked must be true or false'
  return badLength(d.width, 'door width')
}

/**
 * The parts of a new or patched prop. In a patch `null` removes a part, so the Inspector (and
 * undo) can take one off again.
 */
export function badParts(p: { light?: unknown; wall?: unknown; door?: unknown }, patch: boolean): string | null {
  const check = (v: unknown, bad: (v: unknown) => string | null) => (v === undefined || (patch && v === null) ? null : bad(v))
  return check(p.light, badLight) ?? check(p.wall, badWallPart) ?? check(p.door, badDoorPart)
}

/** A prop with no model must be something: a wall, a door or a light. */
export function badInvisible(prop: Pick<Prop, 'model' | 'light' | 'wall' | 'door'>): string | null {
  return hasModel(prop) || prop.light || prop.wall || prop.door ? null : 'a prop without a model must be a wall, a door or a light'
}

// ------------------------------------------------------------- doors

/** Why `actor` may not open or close `prop`, or null. The GM always may; players where the scene allows it, never a locked door. */
export function doorRefusal(
  prop: Pick<Prop, 'door'> | undefined,
  scene: { playersOpenDoors?: boolean } | undefined,
  actor: { isGm: boolean },
): string | null {
  if (!prop?.door) return 'that is not a door'
  if (actor.isGm) return null
  if (!scene?.playersOpenDoors) return 'only the GM opens doors here'
  return prop.door.locked ? 'that door is locked' : null
}

// ------------------------------------------------------------- segments

export interface P2 { x: number; z: number }
export interface Segment { a: P2; b: P2 }

/** A model's footprint in its own frame (before the prop's scale and turn), metres. */
export interface FootprintBounds {
  min: P2
  max: P2
  /** Top of the model, metres above its origin, when known (where a lit model's flame is). */
  top?: number
}

/** The local footprint of a prop's model, when known (measured on load, or the catalogue size). */
export type BoundsOf = (prop: Prop) => FootprintBounds | undefined

/** A footprint centred on the origin from a catalogue size [x, y, z]. */
export function centredBounds(size: readonly [number, number, number] | readonly number[]): FootprintBounds {
  const hx = (size[0] ?? 0) / 2, hz = (size[2] ?? 0) / 2
  return { min: { x: -hx, z: -hz }, max: { x: hx, z: hz } }
}

/** `v` turned `a` radians about +Y (three.js convention, as the prop's rotation.y turns its model). */
function turnY(x: number, z: number, a: number): P2 {
  const c = Math.cos(a), s = Math.sin(a)
  return { x: x * c + z * s, z: -x * s + z * c }
}

/**
 * Rounds away the last bits a turn leaves (cos 90° is 6e-17, not 0): a wall drawn on the grid
 * lattice comes back exactly on it, so a cell centre lying on the wall is still blocked, as it was
 * when the wall was a drawn segment.
 */
function clean(v: number): number {
  return Math.round(v * 1e9) / 1e9
}

/** Ends of the segment in the prop's own frame, before its scale. */
function localSegment(len: number | undefined, bounds: FootprintBounds | undefined, fallback: number): Segment {
  if (len !== undefined) return { a: { x: -len / 2, z: 0 }, b: { x: len / 2, z: 0 } }
  if (!bounds) return { a: { x: -fallback / 2, z: 0 }, b: { x: fallback / 2, z: 0 } }
  const cx = (bounds.min.x + bounds.max.x) / 2, cz = (bounds.min.z + bounds.max.z) / 2
  const w = bounds.max.x - bounds.min.x, d = bounds.max.z - bounds.min.z
  return w >= d
    ? { a: { x: bounds.min.x, z: cz }, b: { x: bounds.max.x, z: cz } }
    : { a: { x: cx, z: bounds.min.z }, b: { x: cx, z: bounds.max.z } }
}

/**
 * The world segment of a wall or door prop on the XZ plane, or null for a prop with neither.
 * `fallback` is the length used when nothing gives one (one cell).
 */
export function propSegment(prop: Prop, bounds: FootprintBounds | undefined, fallback: number): Segment | null {
  if (!prop.wall && !prop.door) return null
  const len = prop.door ? prop.door.width ?? prop.wall?.length : prop.wall!.length
  const local = localSegment(len, bounds, fallback)
  const sc = typeof prop.scale === 'number' ? { x: prop.scale, z: prop.scale } : prop.scale
  const yaw = prop.rotation.y
  const at = (p: P2): P2 => {
    const t = turnY(p.x * sc.x, p.z * sc.z, yaw)
    return { x: clean(prop.position.x + t.x), z: clean(prop.position.z + t.z) }
  }
  return { a: at(local.a), b: at(local.b) }
}

/** What blocks on one level: `sight` blocks sight and movement, `move` movement only, `sightOnly` sight only. */
export interface LevelSegments {
  sight: Segment[]
  move: Segment[]
  sightOnly: Segment[]
}

/** The storey a prop stands on, from its height (the same rule tokens follow). */
export function propLevel(prop: Pick<Prop, 'position'>, floorY: number, cellSize: number): number {
  return Math.max(0, levelOfHeight(prop.position.y, floorY, cellSize))
}

/**
 * Blocking segments of a scene's wall and door props, by level. Closed doors block sight and
 * movement, open ones nothing; a wall blocks what its part says.
 */
export function propSegmentsByLevel(
  props: Readonly<Record<string, Prop>> | readonly Prop[],
  scene: string,
  opts: { floorY: number; cellSize: number; boundsOf?: BoundsOf },
): Map<number, LevelSegments> {
  const out = new Map<number, LevelSegments>()
  const list = Array.isArray(props) ? props : Object.values(props)
  for (const p of list as Prop[]) {
    if (p.scene !== scene || (!p.wall && !p.door)) continue
    if (p.door?.open) continue
    const seg = propSegment(p, hasModel(p) ? opts.boundsOf?.(p) : undefined, opts.cellSize)
    if (!seg || (Math.abs(seg.a.x - seg.b.x) < 1e-6 && Math.abs(seg.a.z - seg.b.z) < 1e-6)) continue
    const level = propLevel(p, opts.floorY, opts.cellSize)
    let l = out.get(level)
    if (!l) out.set(level, (l = { sight: [], move: [], sightOnly: [] }))
    const blocks: WallBlocks = p.door ? 'both' : p.wall!.blocks
    if (blocks === 'both') l.sight.push(seg)
    else if (blocks === 'move') l.move.push(seg)
    else l.sightOnly.push(seg)
  }
  return out
}

/** Segments that stop movement on a level (sight-and-move walls plus move-only ones). */
export function moveSegments(l: LevelSegments | undefined): Segment[] {
  if (!l) return []
  return l.move.length ? [...l.sight, ...l.move] : l.sight
}

/** Segments that stop sight on a level. */
export function sightSegments(l: LevelSegments | undefined): Segment[] {
  if (!l) return []
  return l.sightOnly.length ? [...l.sight, ...l.sightOnly] : l.sight
}

// ------------------------------------------------------------- lights

/** Where a bare light source shines from: 1.4 cells above the floor, as placed lights always did. */
export const BARE_LIGHT_HEIGHT_CELLS = 1.4

export interface LightEmitter {
  /** World position of the light. */
  x: number
  y: number
  z: number
  color: string
  /** three.js `distance`, metres. */
  distance: number
  /** three.js `intensity` (physically based, decay 2). */
  intensity: number
  flicker: boolean
  kind: 'point' | 'spot'
  angle: number
}

/**
 * The three.js light a light prop makes. A bare source shines from 1.4 cells up with the same
 * reach and strength placed lights had (distance 1.6 × reach, intensity 5·cell²·k·max(1, reach/3)),
 * so converted lights look the same. A lit model shines from near its top.
 */
export function lightEmitter(prop: Pick<Prop, 'position' | 'light' | 'model' | 'scale'>, cellSize: number, bounds?: FootprintBounds): LightEmitter | null {
  const l = prop.light
  if (!l) return null
  const sy = typeof prop.scale === 'number' ? prop.scale : prop.scale.y
  const lift = hasModel(prop)
    ? (bounds?.top !== undefined ? Math.max(0.1, bounds.top * sy * 0.9) : 0.8 * cellSize)
    : BARE_LIGHT_HEIGHT_CELLS * cellSize
  return {
    x: prop.position.x,
    y: prop.position.y + lift,
    z: prop.position.z,
    color: l.color,
    distance: l.radius * cellSize * 1.6,
    intensity: 5 * cellSize * cellSize * (l.intensity ?? 1) * Math.max(1, l.radius / 3),
    flicker: !!l.flicker,
    kind: l.kind ?? 'point',
    angle: l.angle ?? Math.PI / 6,
  }
}

// ------------------------------------------------------------- invisible segments

/**
 * The prop pose of an invisible wall or door stretched from `a` to `b`: centred between them,
 * turned so its local X axis runs from `a` to `b`, `length` the distance. Two clicks of the
 * Invisible wall tool give one of these.
 */
export function stretchBetween(a: P2, b: P2): { position: P2; yaw: number; length: number } {
  const dx = b.x - a.x, dz = b.z - a.z
  const length = Math.hypot(dx, dz)
  // turnY(1, 0, yaw) = (cos yaw, -sin yaw) must point along (dx, dz).
  const yaw = length < 1e-9 ? 0 : Math.atan2(-dz, dx)
  return { position: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, yaw, length }
}

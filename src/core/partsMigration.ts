/**
 * The one-time conversion to walls, doors and lights as props (reports/One mode plan.md):
 *
 * - drawn and detected walls (`doc.walls`)  -> invisible wall props
 * - drawn doors (`doc.walls` with `door`)    -> invisible door props, open and locked kept
 * - imported wall segments (`scene.walls`)   -> invisible wall props
 * - placed lights (`doc.lights`)             -> invisible light props
 *
 * A GM client builds the `props.convert` intents for the scene on its table and sends them once
 * (the table knows the floor height). Each new prop's id is derived from the record it replaces,
 * so a second GM client doing the same writes nothing new. The segment of a converted wall is the
 * drawn one (`stretchBetween`), and a converted light sits on the floor with the default emitter
 * height of a bare light, 1.4 cells, where the placed light used to shine from; sight, doors and
 * lighting stay as they were. Pure.
 */
import type { GameDocShape, PlacedLight, Prop, Wall } from './doc'
import type { Intent } from './intents'
import type { LightId, PropId, SceneId, WallId } from './ids'
import { NO_MODEL, stretchBetween, type P2 } from './propParts'
import { MAX_PROPS_PER_INTENT } from './props'

export const INVISIBLE_WALL_NAME = 'Invisible wall'
export const INVISIBLE_DOOR_NAME = 'Invisible door'
export const LIGHT_NAME = 'Light'

/** An invisible wall (or, with `door`, door) prop from `a` to `b` on the floor at `y`. */
export function segmentProp(args: {
  id: PropId
  scene: SceneId
  a: P2
  b: P2
  y: number
  door?: { open: boolean; locked?: boolean }
  tags?: string[]
}): Prop {
  const { position, yaw, length } = stretchBetween(args.a, args.b)
  const prop: Prop = {
    id: args.id,
    scene: args.scene,
    name: args.door ? INVISIBLE_DOOR_NAME : INVISIBLE_WALL_NAME,
    model: NO_MODEL,
    position: { x: position.x, y: args.y, z: position.z },
    rotation: { x: 0, y: yaw, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  }
  if (args.door) prop.door = { open: args.door.open, ...(args.door.locked ? { locked: true } : {}), width: length }
  else prop.wall = { length, blocks: 'both' }
  if (args.tags?.length) prop.tags = args.tags
  return prop
}

export const convertedWallId = (id: WallId) => `wall-${id}` as PropId
export const convertedSceneWallId = (scene: SceneId, i: number) => `scenewall-${scene}-${i}` as PropId
export const convertedLightId = (id: LightId) => `light-${id}` as PropId

function wallProp(w: Wall, y: number): Prop {
  return segmentProp({
    id: convertedWallId(w.id), scene: w.scene, a: w.a, b: w.b, y,
    ...(w.door ? { door: w.door } : {}),
    ...(w.source === 'detected' ? { tags: ['detected'] } : {}),
  })
}

function lightProp(l: PlacedLight, y: number): Prop {
  return {
    id: convertedLightId(l.id),
    scene: l.scene,
    name: LIGHT_NAME,
    model: NO_MODEL,
    position: { x: l.position.x, y, z: l.position.z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    light: { color: l.color, radius: l.radius, ...(l.intensity !== undefined && l.intensity !== 1 ? { intensity: l.intensity } : {}) },
  }
}

/** True when the scene still has drawn walls, imported segments or placed lights to convert. */
export function needsConversion(doc: Pick<GameDocShape, 'scenes' | 'walls' | 'lights'>, scene: SceneId): boolean {
  if (doc.scenes[scene]?.walls?.length) return true
  for (const id in doc.walls ?? {}) if (doc.walls![id as WallId]!.scene === scene) return true
  for (const id in doc.lights ?? {}) if (doc.lights![id as LightId]!.scene === scene) return true
  return false
}

/**
 * The `props.convert` intents for one scene (several when it holds more than a batch), or none
 * when there is nothing left to convert. `floorY` is the height the props stand at.
 */
export function conversionIntents(doc: Pick<GameDocShape, 'scenes' | 'walls' | 'lights'>, scene: SceneId, floorY: number): Intent[] {
  const sc = doc.scenes[scene]
  if (!sc) return []
  const walls = Object.values(doc.walls ?? {}).filter((w) => w.scene === scene)
  const lights = Object.values(doc.lights ?? {}).filter((l) => l.scene === scene)
  const imported = sc.walls ?? []
  if (!walls.length && !lights.length && !imported.length) return []
  type Item = { prop: Prop; wall?: WallId; light?: LightId; imported?: true }
  const items: Item[] = [
    ...walls.map((w) => ({ prop: wallProp(w, floorY), wall: w.id })),
    ...imported.map((s, i) => ({ prop: segmentProp({ id: convertedSceneWallId(scene, i), scene, a: s.a, b: s.b, y: floorY }), imported: true as const })),
    ...lights.map((l) => ({ prop: lightProp(l, floorY), light: l.id })),
  ]
  const out: Intent[] = []
  for (let i = 0; i < items.length; i += MAX_PROPS_PER_INTENT) {
    const chunk = items.slice(i, i + MAX_PROPS_PER_INTENT)
    const last = i + MAX_PROPS_PER_INTENT >= items.length
    out.push({
      type: 'props.convert',
      scene,
      // Zero-length segments block nothing; they are dropped but their records still go.
      props: chunk.filter((it) => it.prop.light || (it.prop.wall?.length ?? it.prop.door?.width ?? 0) > 1e-6).map((it) => it.prop),
      walls: chunk.flatMap((it) => (it.wall ? [it.wall] : [])),
      lights: chunk.flatMap((it) => (it.light ? [it.light] : [])),
      // Imported segments are cleared with the last batch, once every one has its prop.
      ...(last && imported.length ? { sceneWalls: true } : {}),
    })
  }
  return out
}

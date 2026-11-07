/**
 * Pure parts of instanced prop rendering (PropBatch.tsx): which props draw standalone, how the
 * rest group by model, the slot table that maps instance ids to props and finds what changed, and
 * the matrix and footprint maths. No React here, so it is all unit tested.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { Prop } from '@/core/doc'
import type { PropId } from '@/core/ids'
import { isLegacyScale, propScale } from '@/core/props'

/** The bits of the selection store the split depends on. */
export interface StandaloneInputs {
  selection: { kind: string; id: string } | null | undefined
  /** Multi-selection of props, when the store has it. */
  propSelection?: readonly PropId[] | undefined
  /** Prop under an edit preview (dragged on the floor or by the gizmo). */
  previewId?: PropId | null | undefined
}

/**
 * Props that keep a real Object3D of their own: the selected ones (the gizmo and the outline attach
 * to them), the one being edited and the one being dragged. Everything else may be instanced.
 */
export function standaloneIds({ selection, propSelection, previewId }: StandaloneInputs): Set<PropId> {
  const out = new Set<PropId>()
  if (propSelection) for (const id of propSelection) out.add(id)
  if (selection?.kind === 'prop') out.add(selection.id as PropId)
  if (previewId) out.add(previewId)
  return out
}

/** A stable string for a set of ids, for memo dependencies. */
export function idsKey(ids: ReadonlySet<string>): string {
  return [...ids].sort().join('|')
}

export interface PropGroup {
  /** Asset hash every prop in the group draws. */
  key: string
  props: Prop[]
}

/**
 * Splits a scene's props into standalone ones and groups by model hash, keeping the input order
 * within each. Version 1 props (number scale) stay standalone: their size depends on a per-model
 * fit measured by PropMesh, and a GM client migrates them within moments of loading.
 */
export function groupProps(list: readonly Prop[], standalone: ReadonlySet<PropId>, instancing = true): { singles: Prop[]; groups: PropGroup[] } {
  const singles: Prop[] = []
  const byKey = new Map<string, Prop[]>()
  for (const p of list) {
    if (!instancing || standalone.has(p.id) || isLegacyScale(p.scale) || !p.model?.sha256) { singles.push(p); continue }
    const k = p.model.sha256
    let g = byKey.get(k)
    if (!g) byKey.set(k, (g = []))
    g.push(p)
  }
  return { singles, groups: [...byKey].map(([key, props]) => ({ key, props })) }
}

/** Same elements in the same order (by reference). */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export interface SlotSync {
  /** Slots whose prop is new, changed or moved into the slot; ascending. */
  dirty: number[]
  /** Ids that left the table. */
  removed: string[]
}

/**
 * Instance slot table. Slot i of every InstancedMesh in a batch draws `items[i]`. `sync` takes the
 * batch's current props and returns the slots to rewrite: a prop whose object is unchanged (the
 * store keeps identity for untouched props) costs nothing. Removals swap the last slot into the
 * hole so the live range stays dense.
 */
export class InstanceSlots<T extends { id: string }> {
  private ids: string[] = []
  private items: T[] = []
  private index = new Map<string, number>()

  get count(): number { return this.ids.length }

  /** Prop id drawn by an instance, or undefined for an id out of range. */
  idAt(slot: number | undefined): string | undefined {
    return slot === undefined || slot < 0 || slot >= this.ids.length ? undefined : this.ids[slot]
  }

  itemAt(slot: number): T | undefined {
    return this.items[slot]
  }

  slotOf(id: string): number | undefined {
    return this.index.get(id)
  }

  sync(next: readonly T[]): SlotSync {
    const keep = new Set<string>()
    for (const p of next) keep.add(p.id)
    const dirty = new Set<number>()
    const removed: string[] = []
    for (let i = this.ids.length - 1; i >= 0; i--) {
      const id = this.ids[i]!
      if (keep.has(id)) continue
      removed.push(id)
      const last = this.ids.length - 1
      if (i !== last) {
        this.ids[i] = this.ids[last]!
        this.items[i] = this.items[last]!
        this.index.set(this.ids[i]!, i)
        dirty.add(i)
      }
      this.ids.pop()
      this.items.pop()
      this.index.delete(id)
    }
    for (const p of next) {
      const s = this.index.get(p.id)
      if (s === undefined) {
        const slot = this.ids.length
        this.ids.push(p.id)
        this.items.push(p)
        this.index.set(p.id, slot)
        dirty.add(slot)
      } else if (this.items[s] !== p) {
        this.items[s] = p
        dirty.add(s)
      }
    }
    return { dirty: [...dirty].filter((s) => s < this.ids.length).sort((a, b) => a - b), removed }
  }

  /** Every live slot, for a full rewrite (new meshes after a capacity change). */
  all(): number[] {
    return this.ids.map((_, i) => i)
  }
}

/** Capacity for `n` instances: powers of two from 16, so growth reallocates rarely. */
export function capacityFor(n: number): number {
  let c = 16
  while (c < n) c *= 2
  return c
}

const tmpPos = new Vector3()
const tmpQuat = new Quaternion()
const tmpScale = new Vector3()
const tmpEuler = new Euler()

/** The prop's world matrix: position, XYZ Euler rotation, per-axis scale (as PropMesh draws it). */
export function propMatrix(prop: Pick<Prop, 'position' | 'rotation' | 'scale'>, out: Matrix4 = new Matrix4()): Matrix4 {
  const s = propScale(prop)
  tmpPos.set(prop.position.x, prop.position.y, prop.position.z)
  tmpQuat.setFromEuler(tmpEuler.set(prop.rotation.x, prop.rotation.y, prop.rotation.z, 'XYZ'))
  tmpScale.set(s.x, s.y, s.z)
  return out.compose(tmpPos, tmpQuat, tmpScale)
}

export interface XZ { x: number; z: number }

/** Convex hull of points on the XZ plane (monotone chain), counter-clockwise, no repeats. */
export function xzHull(points: readonly XZ[]): XZ[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z)
  if (pts.length <= 2) return pts
  const cross = (o: XZ, a: XZ, b: XZ) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)
  const lower: XZ[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: XZ[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** A model's outline for footprints: its XZ hull plus its height range, in model space. */
export interface ModelHull { hull: XZ[]; minY: number; maxY: number }

const tmpV = new Vector3()

/**
 * World-space axis-aligned box of a model hull under `matrix`. Exact for turns about Y (the usual
 * case) and close for tilted props; footprintWalls (editing.ts) takes its XZ extent.
 */
export function hullBox(h: ModelHull, matrix: Matrix4): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
  if (!h.hull.length) return null
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const p of h.hull) {
    for (const y of [h.minY, h.maxY]) {
      tmpV.set(p.x, y, p.z).applyMatrix4(matrix)
      min.x = Math.min(min.x, tmpV.x); min.y = Math.min(min.y, tmpV.y); min.z = Math.min(min.z, tmpV.z)
      max.x = Math.max(max.x, tmpV.x); max.y = Math.max(max.y, tmpV.y); max.z = Math.max(max.z, tmpV.z)
    }
  }
  return { min, max }
}

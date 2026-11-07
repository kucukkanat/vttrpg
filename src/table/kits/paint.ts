/**
 * Kit paint tools as plans: what a floor rectangle, a stair, a roof fill, a pillar, an erase or
 * a single piece writes, as one `tiles.place` worth of cells (see `TilePlan`). Walls, doors and
 * windows go through `planWalls` (autoJoin.ts). Pure; the table layer turns a plan into an intent
 * and a ghost.
 */
import {
  cellKey, cellSlotFor, cellsOfAreaPiece, edgesOfEdgePiece, encodeTile, isAreaSlot, isEdgeSlot, isVertexSlot, turnDir, turnedFootprint,
  type EdgeAddr, type KitManifest, type KitPiece,
} from '@/core/kits'
import { EMPTY_PLAN, planWalls, type TilePlan } from './autoJoin'
import { pieceIndex } from './manifests'
import type { Occupancy, Occupant } from './occupancy'

export interface CellRect { x0: number; z0: number; x1: number; z1: number }

export function normRect(a: { x: number; z: number }, b: { x: number; z: number }): CellRect {
  return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) }
}

/** Grows a rectangle of cells to whole modules (2×2 cells for a 3 m kit). */
export function snapRect(r: CellRect, module: number): CellRect {
  if (module <= 1) return r
  const down = (v: number) => Math.floor(v / module) * module
  return { x0: down(r.x0), z0: down(r.z0), x1: down(r.x1) + module - 1, z1: down(r.z1) + module - 1 }
}

/** Snaps a cell or vertex coordinate to the kit module. */
export const snapToModule = (v: number, module: number) => (module <= 1 ? v : Math.round(v / module) * module)

/** Builds a plan, keeping the last write per key and dropping clears of empty cells. */
export class PlanBuilder {
  private out = new Map<string, string>()
  private kits: string[] = []
  constructor(private occ: Occupancy) {}
  kitIndex(id: string): number {
    let i = this.kits.indexOf(id)
    if (i < 0) { this.kits.push(id); i = this.kits.length - 1 }
    return i
  }
  put(key: string, manifest: KitManifest, piece: KitPiece, rot: number, variant = 0): void {
    this.out.set(key, encodeTile({ kit: this.kitIndex(manifest.id), piece: pieceIndex(manifest, piece.id), rot: rot & 3, variant }))
  }
  clear(key: string): void {
    if (!this.out.has(key) || this.out.get(key) !== '') this.out.set(key, '')
  }
  /** Merges another plan (its writes win). */
  merge(plan: TilePlan): void {
    plan.keys.forEach((key, i) => {
      const v = plan.values[i]!
      if (v === '') { this.out.set(key, ''); return }
      const [k, ...rest] = v.split(':')
      this.out.set(key, [this.kitIndex(plan.kits[Number(k)]!), ...rest].join(':'))
    })
  }
  has(key: string): boolean { return this.out.has(key) && this.out.get(key) !== '' }
  build(existing: (key: string) => Occupant | undefined): TilePlan {
    const keys: string[] = []
    const values: string[] = []
    for (const [key, value] of this.out) {
      const had = existing(key)
      if (value === '' && !had) continue
      if (had && value !== '') {
        const [k, ...rest] = value.split(':')
        if (this.kits[Number(k)] === had.manifest.id && rest.join(':') === had.raw.split(':').slice(1).join(':')) continue
      }
      keys.push(key)
      values.push(value)
    }
    return keys.length ? { kits: this.kits, keys, values } : EMPTY_PLAN
  }
  get occupancy(): Occupancy { return this.occ }
}

/** The occupant stored under a cell key (anchor), if any. */
function byKey(occ: Occupancy, key: string): Occupant | undefined {
  const [x, level, z, slot] = key.split(',')
  const lx = Number(x), ll = Number(level), lz = Number(z)
  if (slot === 'v') return occ.vertex(ll, lx, lz)
  if (slot === 'n' || slot === 'w') { const o = occ.edge(ll, { x: lx, z: lz, side: slot }); return o?.key === key ? o : undefined }
  const o = occ.cell(ll, lx, lz, slot as 'f' | 's' | 'r')
  return o?.key === key ? o : undefined
}

export const existingIn = (occ: Occupancy) => (key: string) => byKey(occ, key)

/** Clears every area piece of `slot` covering any of `cells` on `level`. */
function clearArea(b: PlanBuilder, level: number, slot: 'f' | 's' | 'r', cells: { x: number; z: number }[]): void {
  for (const c of cells) {
    const o = b.occupancy.cell(level, c.x, c.z, slot)
    if (o) b.clear(o.key)
  }
}

/** One area piece (floor, stair, roof) at an anchor cell; what it overlaps in its slot gives way. */
export function planArea(occ: Occupancy, level: number, manifest: KitManifest, piece: KitPiece, at: { x: number; z: number }, rot: number): TilePlan {
  if (!isAreaSlot(piece.slot)) return EMPTY_PLAN
  const b = new PlanBuilder(occ)
  const slot = cellSlotFor(piece.slot, rot) as 'f' | 's' | 'r'
  const cells = cellsOfAreaPiece(piece, at, rot)
  clearArea(b, level, slot, cells)
  // Stairs open a stairwell in the floor above; a big floor tile cut by it is patched back with
  // one-cell tiles around the hole when its kit has them.
  if (piece.slot === 'stair') {
    const hole = new Set(cells.map((c) => `${c.x},${c.z}`))
    const cut = new Set<Occupant>()
    for (const c of cells) { const o = occ.cell(level + 1, c.x, c.z, 'f'); if (o) cut.add(o) }
    for (const o of cut) {
      b.clear(o.key)
      const small = o.manifest.pieces.find((p) => p.id === o.manifest.defaults.floorSmall)
      if (!small || small.footprint[0] !== 1 || small.footprint[1] !== 1) continue
      for (const c of cellsOfAreaPiece(o.piece, o.at, o.value.rot)) {
        if (!hole.has(`${c.x},${c.z}`)) b.put(cellKey({ x: c.x, level: level + 1, z: c.z, slot: 'f' }), o.manifest, small, 0)
      }
    }
  }
  b.put(cellKey({ x: at.x, level, z: at.z, slot }), manifest, piece, rot)
  return b.build(existingIn(occ))
}

/**
 * Floor paint: the rectangle tiled with `piece` (turned by `rot`), and whatever it cannot fit
 * filled with the kit's small floor. Floors already in the rectangle give way.
 */
export function planFloorRect(occ: Occupancy, level: number, manifest: KitManifest, piece: KitPiece, rect: CellRect, rot: number): TilePlan {
  const b = new PlanBuilder(occ)
  const cells: { x: number; z: number }[] = []
  for (let x = rect.x0; x <= rect.x1; x++) for (let z = rect.z0; z <= rect.z1; z++) cells.push({ x, z })
  clearArea(b, level, 'f', cells)
  const taken = new Set<string>()
  const small = manifest.pieces.find((p) => p.id === manifest.defaults.floorSmall)
  const fits = (p: KitPiece, at: { x: number; z: number }, r: number) => {
    const [w, d] = turnedFootprint(p, r)
    if (at.x + w - 1 > rect.x1 || at.z + d - 1 > rect.z1) return false
    return cellsOfAreaPiece(p, at, r).every((c) => !taken.has(`${c.x},${c.z}`))
  }
  const lay = (p: KitPiece, at: { x: number; z: number }, r: number) => {
    for (const c of cellsOfAreaPiece(p, at, r)) taken.add(`${c.x},${c.z}`)
    b.put(cellKey({ x: at.x, level, z: at.z, slot: 'f' }), manifest, p, r)
  }
  for (let z = rect.z0; z <= rect.z1; z++) for (let x = rect.x0; x <= rect.x1; x++) {
    if (taken.has(`${x},${z}`)) continue
    const at = { x, z }
    if (fits(piece, at, rot)) { lay(piece, at, rot); continue }
    if (small) {
      const r = [rot, rot + 1].find((q) => fits(small, at, q))
      if (r !== undefined) { lay(small, at, r); continue }
    }
  }
  return b.build(existingIn(occ))
}

/** A vertex piece (pillar, decor corner) on a vertex. */
export function planVertex(occ: Occupancy, level: number, manifest: KitManifest, piece: KitPiece, at: { x: number; z: number }, rot: number): TilePlan {
  if (!isVertexSlot(piece.slot)) return EMPTY_PLAN
  const b = new PlanBuilder(occ)
  b.put(cellKey({ x: at.x, level, z: at.z, slot: 'v' }), manifest, piece, rot)
  return b.build(existingIn(occ))
}

/**
 * Where an edge piece of `piece`'s length goes when placed on edge `e`: over the plain wall piece
 * already there when it has the same length, else starting at `e` (or one back when the next edge
 * is no wall but the previous one is), snapped to the kit module.
 */
export function edgeAnchor(occ: Occupancy, level: number, manifest: KitManifest, piece: KitPiece, e: EdgeAddr): { at: { x: number; z: number }; rot: number } {
  const len = Math.max(1, Math.round(piece.footprint[0]))
  const o = occ.edge(level, e)
  const odd = (e.side === 'n') ? 0 : 1
  if (o && isEdgeSlot(o.piece.slot) && Math.round(o.piece.footprint[0]) === len) {
    const sameSide = (o.value.rot & 1) === odd ? o.value.rot : odd
    return { at: o.at, rot: sameSide }
  }
  const along = e.side === 'n' ? e.x : e.z
  let start = manifest.module > 1 ? Math.floor(along / manifest.module) * manifest.module : along
  if (manifest.module <= 1 && len > 1) {
    const next = e.side === 'n' ? { ...e, x: e.x + 1 } : { ...e, z: e.z + 1 }
    const prev = e.side === 'n' ? { ...e, x: e.x - 1 } : { ...e, z: e.z - 1 }
    if (!occ.edge(level, next) && occ.edge(level, prev)) start = along - (len - 1)
  }
  const keep = o && (o.value.rot & 1) === odd ? o.value.rot : odd
  return { at: e.side === 'n' ? { x: start, z: e.z } : { x: e.x, z: start }, rot: keep }
}

/** A door, window or decor wall on an edge: walls around it re-tile; overlapped edge pieces give way. */
export function planEdgePiece(occ: Occupancy, level: number, manifest: KitManifest, piece: KitPiece, e: EdgeAddr, rot?: number, floorAt?: (x: number, z: number) => boolean): TilePlan {
  if (!isEdgeSlot(piece.slot)) return EMPTY_PLAN
  const anchor = edgeAnchor(occ, level, manifest, piece, e)
  // A requested turn keeps the edge's axis; it only flips the side.
  const r = rot === undefined ? anchor.rot : ((rot & 1) === (anchor.rot & 1) ? rot : anchor.rot)
  return planWalls({ occ, level, manifest, fixed: [{ piece, at: anchor.at, rot: r }], ...(floorAt ? { floorAt } : {}) })
}

/**
 * Roof over a room (cells `rect`, snapped to modules) on top of `level`: on a kit with roofs, a
 * gable along the longer side (one module deep: gable pieces; two: two slopes meeting at the
 * ridge; deeper: rows of gables). On a kit without roofs, a ceiling of its default floor on the
 * level above.
 */
export function planRoofFill(occ: Occupancy, level: number, manifest: KitManifest, rect: CellRect): TilePlan {
  const b = new PlanBuilder(occ)
  const top = level + 1
  const slope = manifest.pieces.find((p) => p.id === manifest.defaults.roof)
  const gable = manifest.pieces.find((p) => p.id === manifest.defaults.roofGable)
  if (!slope && !gable) {
    const floor = manifest.pieces.find((p) => p.id === manifest.defaults.floor)
    if (!floor) return EMPTY_PLAN
    return planFloorRect(occ, top, manifest, floor, rect, 0)
  }
  const m = 2
  const r = snapRect(rect, m)
  const mw = (r.x1 - r.x0 + 1) / m
  const md = (r.z1 - r.z0 + 1) / m
  const alongX = mw >= md
  const across = alongX ? md : mw
  const cells: { x: number; z: number }[] = []
  for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) cells.push({ x, z })
  clearArea(b, top, 'r', cells)
  for (let i = 0; i < mw; i++) for (let j = 0; j < md; j++) {
    const at = { x: r.x0 + i * m, z: r.z0 + j * m }
    const key = cellKey({ x: at.x, level: top, z: at.z, slot: 'r' })
    const k = alongX ? j : i
    if (across === 2 && slope) {
      // Slopes rise towards the ridge between the two rows; `roof` rises towards local +x (E).
      const want = alongX ? (k === 0 ? 'S' : 'N') : (k === 0 ? 'E' : 'W')
      const rot = [0, 1, 2, 3].find((q) => turnDir('E', q) === want)!
      b.put(key, manifest, slope, rot)
    } else if (gable) b.put(key, manifest, gable, alongX ? 0 : 1)
    else if (slope) b.put(key, manifest, slope, alongX ? 1 : 0)
  }
  return b.build(existingIn(occ))
}

export interface EraseJob {
  occ: Occupancy
  level: number
  /** Cells whose floor, stair and roof pieces go. */
  rect?: CellRect
  /** A single piece (a click). */
  piece?: Occupant
  /** Kit to re-tile walls with when an erase splits them (the piece's own when absent). */
  manifest: KitManifest
}

/** Erase: pieces in a rectangle (walls on its edges re-tile around the gap), or one piece. */
export function planErase(job: EraseJob): TilePlan {
  const { occ, level, manifest } = job
  const b = new PlanBuilder(occ)
  if (job.piece) {
    const o = job.piece
    if (isEdgeSlot(o.piece.slot) || (isVertexSlot(o.piece.slot) && o.piece.arms?.length)) {
      const edges = isEdgeSlot(o.piece.slot) ? edgesOfEdgePiece(o.piece, o.at, o.value.rot) : []
      if (edges.length) b.merge(planWalls({ occ, level: o.level, manifest: o.manifest, remove: edges }))
      else b.clear(o.key)
    } else b.clear(o.key)
    return b.build(existingIn(occ))
  }
  const r = job.rect
  if (!r) return EMPTY_PLAN
  const cells: { x: number; z: number }[] = []
  for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) cells.push({ x, z })
  for (const slot of ['f', 's', 'r'] as const) clearArea(b, level, slot, cells)
  // Edges inside the rectangle and on its border, and the vertices on them.
  const edges: EdgeAddr[] = []
  for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1 + 1; z++) edges.push({ x, z, side: 'n' })
  for (let x = r.x0; x <= r.x1 + 1; x++) for (let z = r.z0; z <= r.z1; z++) edges.push({ x, z, side: 'w' })
  const walled = edges.filter((e) => occ.edge(level, e))
  if (walled.length) b.merge(planWalls({ occ, level, manifest, remove: walled }))
  for (let x = r.x0; x <= r.x1 + 1; x++) for (let z = r.z0; z <= r.z1 + 1; z++) {
    const v = occ.vertex(level, x, z)
    if (v && !v.piece.arms?.length) b.clear(v.key)
  }
  return b.build(existingIn(occ))
}

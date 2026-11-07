/**
 * Wall auto-join: turns a set of wall edges into kit pieces. Paint, erase and door placement all
 * describe what the walls of a region should be (edges added, edges cleared, doors and windows
 * fixed in place); this re-tiles the region's plain walls to match:
 *
 *   1. at every vertex where walls meet, the kit's join piece for that shape: a cross for four
 *      arms, a tee for three, a corner for two at right angles (turned to fit), when its arms
 *      are free plain wall;
 *   2. the rest in straight runs: full-length walls, then the one-cell piece for an odd end (or a
 *      full one shifted back when the kit has none).
 *
 * Plain walls are the kit defaults (`wall`, `half`, `corner`, `tee`, `cross`) of any kit; they are
 * cleared and laid again. Every other edge piece (doors, windows, decor walls) stays where it is,
 * counts as a wall for the join shape, and is never covered by a join arm. Pure.
 */
import { cellKey, encodeTile, type Dir, type KitManifest, type KitPiece } from '@/core/kits'
import { DIRS, edgeFrom, edgeKey, edgesOfArms, edgesOfEdgePiece, isEdgeSlot, isVertexSlot, parseEdgeKey, turnDir, type EdgeAddr } from '@/core/kitGeometry'
import { pieceIndex } from './manifests'
import type { Occupancy, Occupant } from './occupancy'

/** A tile plan: one `tiles.place` worth of cells (an empty value clears the cell). */
export interface TilePlan {
  kits: string[]
  keys: string[]
  values: string[]
}

export const EMPTY_PLAN: TilePlan = { kits: [], keys: [], values: [] }

export interface FixedPiece {
  piece: KitPiece
  at: { x: number; z: number }
  rot: number
  variant?: number
}

export interface WallJob {
  occ: Occupancy
  level: number
  /** The kit new plain walls come from. */
  manifest: KitManifest
  /** Edges that become plain wall. */
  add?: readonly EdgeAddr[]
  /** Edges cleared (a door or window on one goes as a whole). */
  remove?: readonly EdgeAddr[]
  /** Doors and windows placed by this job; whatever edge pieces they overlap give way. */
  fixed?: readonly FixedPiece[]
  /** A floor on this cell at this level: one-sided walls face it. */
  floorAt?(x: number, z: number): boolean
}

/** A plain wall of its own kit: re-tiled freely. */
export function isPlainWall(o: Pick<Occupant, 'piece' | 'manifest'>): boolean {
  const d = o.manifest.defaults
  return [d.wall, d.half, d.corner, d.tee, d.cross].includes(o.piece.id)
}

function coveredEdges(o: Occupant): EdgeAddr[] {
  if (isEdgeSlot(o.piece.slot)) return edgesOfEdgePiece(o.piece, o.at, o.value.rot)
  if (isVertexSlot(o.piece.slot)) return edgesOfArms(o.piece, o.at, o.value.rot)
  return []
}

const endpoints = (e: EdgeAddr): [number, number][] => (e.side === 'n' ? [[e.x, e.z], [e.x + 1, e.z]] : [[e.x, e.z], [e.x, e.z + 1]])

/** The join piece for a set of arm directions, turned to fit, or null. */
export function joinFor(manifest: KitManifest, dirs: readonly Dir[]): { piece: KitPiece; index: number; rot: number } | null {
  const d = manifest.defaults
  const id = dirs.length === 4 ? d.cross : dirs.length === 3 ? d.tee
    : dirs.length === 2 && (DIRS.indexOf(dirs[0]!) + DIRS.indexOf(dirs[1]!)) % 2 === 1 ? d.corner : undefined
  const index = pieceIndex(manifest, id)
  const piece = manifest.pieces[index]
  if (!piece?.arms) return null
  const want = new Set(dirs)
  for (let rot = 0; rot < 4; rot++) {
    const got = piece.arms.map((a) => turnDir(a.dir, rot))
    if (got.length === want.size && got.every((x) => want.has(x))) return { piece, index, rot }
  }
  return null
}

/** Re-tiles the plain walls around a job's edges. */
export function planWalls(job: WallJob): TilePlan {
  const { occ, level, manifest } = job
  const touchedEdges = [...(job.add ?? []), ...(job.remove ?? []), ...(job.fixed ?? []).flatMap((f) => edgesOfEdgePiece(f.piece, f.at, f.rot))]
  if (!touchedEdges.length) return EMPTY_PLAN
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (const e of touchedEdges) { minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x); minZ = Math.min(minZ, e.z); maxZ = Math.max(maxZ, e.z) }
  const pad = 3
  const rect = { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad }
  const inRect = (e: EdgeAddr) => e.x >= rect.minX && e.x <= rect.maxX && e.z >= rect.minZ && e.z <= rect.maxZ

  // The region: every wall-like piece with an edge in the rectangle.
  const plain = new Set<string>()
  const fixedAt = new Map<string, Occupant>()
  const regionEdges = new Set<string>()
  const existing = new Map<string, Occupant>()
  const cleared = new Set<string>()
  for (const o of occ.pieces(level, rect)) {
    const edges = coveredEdges(o)
    if (!edges.length && !isVertexSlot(o.piece.slot)) continue
    if (!edges.some(inRect) && !(isVertexSlot(o.piece.slot) && inRect({ x: o.at.x, z: o.at.z, side: 'n' }))) continue
    existing.set(o.key, o)
    for (const e of edges) regionEdges.add(edgeKey(e))
    if (isPlainWall(o)) { cleared.add(o.key); for (const e of edges) plain.add(edgeKey(e)) }
    else if (isEdgeSlot(o.piece.slot)) for (const e of edges) fixedAt.set(edgeKey(e), o)
  }

  const out = new Map<string, string>()
  for (const k of cleared) out.set(k, '')
  const gone = new Set<string>()
  const dropFixed = (o: Occupant, keep: Set<string>, toPlain: boolean) => {
    out.set(o.key, '')
    for (const e of coveredEdges(o)) {
      const k = edgeKey(e)
      if (fixedAt.get(k) === o) fixedAt.delete(k)
      if (keep.has(k)) continue
      if (toPlain) plain.add(k)
      else gone.add(k)
    }
  }
  for (const e of job.remove ?? []) {
    const k = edgeKey(e)
    plain.delete(k)
    gone.add(k)
    const o = fixedAt.get(k)
    if (o) dropFixed(o, new Set(), false)
  }
  const kitIdx = 0
  for (const f of job.fixed ?? []) {
    const edges = edgesOfEdgePiece(f.piece, f.at, f.rot).map(edgeKey)
    const mine = new Set(edges)
    for (const k of edges) { const o = fixedAt.get(k); if (o) dropFixed(o, mine, true) }
    const index = pieceIndex(manifest, f.piece.id)
    const key = cellKey({ x: f.at.x, level, z: f.at.z, slot: (f.rot & 1) === 0 ? 'n' : 'w' })
    const fake = { key } as Occupant
    for (const k of edges) { plain.delete(k); gone.delete(k); fixedAt.set(k, fake) }
    out.set(key, encodeTile({ kit: kitIdx, piece: index, rot: f.rot & 3, variant: f.variant ?? 0 }))
  }
  for (const e of job.add ?? []) {
    const k = edgeKey(e)
    if (!fixedAt.has(k)) { plain.add(k); gone.delete(k) }
  }

  // A wall arm leaves vertex V in direction d: plain, fixed, or a wall outside the region.
  const armAt = (vx: number, vz: number, d: Dir) => {
    const e = edgeFrom(vx, vz, d)
    const k = edgeKey(e)
    if (plain.has(k) || fixedAt.has(k)) return true
    if (gone.has(k) || regionEdges.has(k)) return false
    return !!occ.edge(level, e)
  }

  const covered = new Set<string>()
  const vertices = new Map<string, [number, number]>()
  for (const k of plain) for (const v of endpoints(parseEdgeKey(k))) vertices.set(`${v[0]},${v[1]}`, v)
  const order = [...vertices.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0])
  for (const [vx, vz] of order) {
    const dirs = DIRS.filter((d) => armAt(vx, vz, d))
    const join = joinFor(manifest, dirs)
    if (!join) continue
    const edges = edgesOfArms(join.piece, { x: vx, z: vz }, join.rot).map(edgeKey)
    if (!edges.every((k) => plain.has(k) && !covered.has(k))) continue
    for (const k of edges) covered.add(k)
    out.set(cellKey({ x: vx, level, z: vz, slot: 'v' }), encodeTile({ kit: kitIdx, piece: join.index, rot: join.rot, variant: 0 }))
  }

  // Straight runs of what is left, per line.
  const wallIdx = pieceIndex(manifest, manifest.defaults.wall)
  const wall = manifest.pieces[wallIdx]!
  const halfIdx = pieceIndex(manifest, manifest.defaults.half)
  const len = Math.max(1, Math.round(wall.footprint[0]))
  const lines = new Map<string, number[]>()
  for (const k of plain) {
    if (covered.has(k)) continue
    const e = parseEdgeKey(k)
    const line = e.side === 'n' ? `n,${e.z}` : `w,${e.x}`
    let list = lines.get(line)
    if (!list) lines.set(line, (list = []))
    list.push(e.side === 'n' ? e.x : e.z)
  }
  const place = (side: 'n' | 'w', fixed: number, along: number, index: number) => {
    const at = side === 'n' ? { x: along, z: fixed } : { x: fixed, z: along }
    // One-sided walls face the floor; with floor on both sides (or none) the default side.
    const a = side === 'n' ? job.floorAt?.(at.x, at.z) : job.floorAt?.(at.x, at.z)
    const b = side === 'n' ? job.floorAt?.(at.x, at.z - 1) : job.floorAt?.(at.x - 1, at.z)
    const rot = side === 'n' ? (!a && b ? 2 : 0) : (!a && b ? 3 : 1)
    out.set(cellKey({ x: at.x, level, z: at.z, slot: side }), encodeTile({ kit: kitIdx, piece: index, rot, variant: 0 }))
  }
  for (const [line, coords] of lines) {
    const side = line[0] as 'n' | 'w'
    const fixed = Number(line.slice(2))
    coords.sort((a, b) => a - b)
    let start = 0
    for (let i = 1; i <= coords.length; i++) {
      if (i < coords.length && coords[i] === coords[i - 1]! + 1) continue
      const s = coords[start]!, e = coords[i - 1]!
      let at = s
      while (e - at + 1 >= len) { place(side, fixed, at, wallIdx); at += len }
      if (at <= e) {
        if (halfIdx >= 0) for (; at <= e; at++) place(side, fixed, at, halfIdx)
        else place(side, fixed, Math.max(s, e - len + 1), wallIdx)
      }
      start = i
    }
  }

  // Leave out what would not change.
  const keys: string[] = []
  const values: string[] = []
  for (const [key, value] of out) {
    const had = existing.get(key)
    if (value === '' && !had) continue
    if (had && value !== '' && had.manifest.id === manifest.id && encodeTile({ ...had.value, kit: kitIdx }) === value) continue
    keys.push(key)
    values.push(value)
  }
  return keys.length ? { kits: [manifest.id], keys, values } : EMPTY_PLAN
}

/** Edges along a straight drag between two vertices, on the axis the drag mostly follows. */
export function edgesAlong(a: { x: number; z: number }, b: { x: number; z: number }): EdgeAddr[] {
  const out: EdgeAddr[] = []
  if (Math.abs(b.x - a.x) >= Math.abs(b.z - a.z)) {
    const [s, e] = a.x <= b.x ? [a.x, b.x] : [b.x, a.x]
    for (let x = s; x < e; x++) out.push({ x, z: a.z, side: 'n' })
  } else {
    const [s, e] = a.z <= b.z ? [a.z, b.z] : [b.z, a.z]
    for (let z = s; z < e; z++) out.push({ x: a.x, z, side: 'w' })
  }
  return out
}

/** Edges around the rectangle with opposite vertices `a` and `b`. */
export function edgesAround(a: { x: number; z: number }, b: { x: number; z: number }): EdgeAddr[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z)
  if (x0 === x1 || z0 === z1) return edgesAlong(a, b)
  return [
    ...edgesAlong({ x: x0, z: z0 }, { x: x1, z: z0 }), ...edgesAlong({ x: x0, z: z1 }, { x: x1, z: z1 }),
    ...edgesAlong({ x: x0, z: z0 }, { x: x0, z: z1 }), ...edgesAlong({ x: x1, z: z0 }, { x: x1, z: z1 }),
  ]
}

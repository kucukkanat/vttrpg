/**
 * Placement geometry of kit pieces (see the frames and slots in `./kits.ts`): turning, footprints,
 * where a piece's canonical origin lands, the edges and cells it covers. Kept apart from the keys
 * and values in `./kits.ts`, which the app shell loads at startup; this is only needed by the
 * table and the kit tools.
 */
import { LEVEL_CELLS, type CellSlot, type Dir, type KitPiece, type KitSlot } from './kits'

export const DIRS: readonly Dir[] = ['E', 'N', 'W', 'S']
const DIR_VEC: Record<Dir, [number, number]> = { E: [1, 0], N: [0, -1], W: [-1, 0], S: [0, 1] }

// ------------------------------------------------------------------ slots

export function isEdgeSlot(slot: KitSlot): boolean {
  return slot === 'wall' || slot === 'door' || slot === 'window'
}
export function isVertexSlot(slot: KitSlot): boolean {
  return slot === 'corner' || slot === 'pillar'
}
export function isAreaSlot(slot: KitSlot): boolean {
  return slot === 'floor' || slot === 'stair' || slot === 'roof'
}

/** The document slot letter a piece of `slot` turned by `rot` is stored under. */
export function cellSlotFor(slot: KitSlot, rot: number): CellSlot {
  if (isEdgeSlot(slot)) return (rot & 1) === 0 ? 'n' : 'w'
  if (isVertexSlot(slot)) return 'v'
  return slot === 'floor' ? 'f' : slot === 'stair' ? 's' : 'r'
}

// ------------------------------------------------------------------ geometry

/** Rotates a canonical vector by `q` quarter turns (three.js Y rotation). */
export function turn(v: readonly [number, number], q: number): [number, number] {
  const k = ((q % 4) + 4) % 4
  const [x, z] = v
  // `+ 0` turns -0 into 0, so turned points compare equal.
  switch (k) {
    case 0: return [x + 0, z + 0]
    case 1: return [z + 0, -x + 0]
    case 2: return [-x + 0, -z + 0]
    default: return [-z + 0, x + 0]
  }
}

export function turnDir(d: Dir, q: number): Dir {
  return DIRS[(DIRS.indexOf(d) + (((q % 4) + 4) % 4)) % 4]!
}

export function dirVec(d: Dir): [number, number] {
  return DIR_VEC[d]
}

/** Footprint in cells along world x and z after `rot` quarter turns. */
export function turnedFootprint(p: Pick<KitPiece, 'footprint'>, rot: number): [number, number] {
  const [w, d] = p.footprint
  return (rot & 1) === 0 ? [w, d] : [d, w]
}

/**
 * Where the canonical origin of a piece lands, in cell units: x and z are measured so that cell
 * (x, z) has its centre at (x, z) and vertex (x, z) sits at (x - 0.5, z - 0.5).
 */
export function pieceCentre(p: Pick<KitPiece, 'slot' | 'footprint'>, at: { x: number; z: number }, rot: number): [number, number] {
  if (isVertexSlot(p.slot)) return [at.x - 0.5, at.z - 0.5]
  if (isEdgeSlot(p.slot)) {
    const half = p.footprint[0] / 2
    return (rot & 1) === 0 ? [at.x - 0.5 + half, at.z - 0.5] : [at.x - 0.5, at.z - 0.5 + half]
  }
  const [w, d] = turnedFootprint(p, rot)
  return [at.x + (w - 1) / 2, at.z + (d - 1) / 2]
}

/** The anchor cell for a piece whose canonical origin should land at `centre` (cell units). Inverse of `pieceCentre`. */
export function anchorFor(p: Pick<KitPiece, 'slot' | 'footprint'>, centre: [number, number], rot: number): { x: number; z: number } {
  if (isVertexSlot(p.slot)) return { x: Math.round(centre[0] + 0.5), z: Math.round(centre[1] + 0.5) }
  if (isEdgeSlot(p.slot)) {
    const half = p.footprint[0] / 2
    return (rot & 1) === 0
      ? { x: Math.round(centre[0] + 0.5 - half), z: Math.round(centre[1] + 0.5) }
      : { x: Math.round(centre[0] + 0.5), z: Math.round(centre[1] + 0.5 - half) }
  }
  const [w, d] = turnedFootprint(p, rot)
  return { x: Math.round(centre[0] - (w - 1) / 2), z: Math.round(centre[1] - (d - 1) / 2) }
}

/** An edge of the cell lattice at a level: `n` or `w` of cell (x, z). */
export interface EdgeAddr { x: number; z: number; side: 'n' | 'w' }

export const edgeKey = (e: EdgeAddr): string => `${e.x},${e.z},${e.side}`
export function parseEdgeKey(k: string): EdgeAddr {
  const [x, z, side] = k.split(',')
  return { x: Number(x), z: Number(z), side: side as 'n' | 'w' }
}

/** The edge leaving vertex (vx, vz) in direction `d`. */
export function edgeFrom(vx: number, vz: number, d: Dir): EdgeAddr {
  switch (d) {
    case 'E': return { x: vx, z: vz, side: 'n' }
    case 'W': return { x: vx - 1, z: vz, side: 'n' }
    case 'S': return { x: vx, z: vz, side: 'w' }
    default: return { x: vx, z: vz - 1, side: 'w' }
  }
}

/** The vertex a step of one edge in direction `d` reaches from (vx, vz). */
export function stepVertex(vx: number, vz: number, d: Dir): [number, number] {
  const [dx, dz] = DIR_VEC[d]
  return [vx + dx, vz + dz]
}

/** Edges an edge piece at `at` turned `rot` covers. */
export function edgesOfEdgePiece(p: Pick<KitPiece, 'footprint'>, at: { x: number; z: number }, rot: number): EdgeAddr[] {
  const n = Math.max(1, Math.round(p.footprint[0]))
  const out: EdgeAddr[] = []
  for (let i = 0; i < n; i++) out.push((rot & 1) === 0 ? { x: at.x + i, z: at.z, side: 'n' } : { x: at.x, z: at.z + i, side: 'w' })
  return out
}

/** Edges a join piece's arms cover from vertex `at` turned `rot`. */
export function edgesOfArms(p: Pick<KitPiece, 'arms'>, at: { x: number; z: number }, rot: number): EdgeAddr[] {
  const out: EdgeAddr[] = []
  for (const arm of p.arms ?? []) {
    const d = turnDir(arm.dir, rot)
    let [vx, vz] = [at.x, at.z]
    for (let i = 0; i < arm.length; i++) {
      out.push(edgeFrom(vx, vz, d))
      ;[vx, vz] = stepVertex(vx, vz, d)
    }
  }
  return out
}

/** Cells an area piece covers. */
export function cellsOfAreaPiece(p: Pick<KitPiece, 'footprint'>, at: { x: number; z: number }, rot: number): { x: number; z: number }[] {
  const [w, d] = turnedFootprint(p, rot)
  const out: { x: number; z: number }[] = []
  for (let i = 0; i < Math.max(1, w); i++) for (let j = 0; j < Math.max(1, d); j++) out.push({ x: at.x + i, z: at.z + j })
  return out
}

/** World height of the base of `level`, given the floor height and cell size. */
export function levelBase(level: number, floorY: number, cellSize: number): number {
  return floorY + level * LEVEL_CELLS * cellSize
}


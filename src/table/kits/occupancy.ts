/**
 * CPU occupancy of a scene's kit tiles: which piece covers each cell, edge and vertex on each
 * level. Placement picks against this (and a plane per level), never against meshes, which keeps
 * touch placement cheap on phones. Built per chunk and cached by the chunk record's identity, so
 * an edit re-indexes only the chunks it touched. Pure.
 */
import { CHUNK, chunkOf, parseCellKey, parseTile, type CellSlot, type KitManifest, type KitPiece, type SceneTiles, type TileValue } from '@/core/kits'
import { cellsOfAreaPiece, edgesOfArms, edgesOfEdgePiece, isAreaSlot, isEdgeSlot, type EdgeAddr } from '@/core/kitGeometry'
import type { PieceLookup } from './manifests'

export interface Occupant {
  key: string
  level: number
  slot: CellSlot
  at: { x: number; z: number }
  value: TileValue
  raw: string
  piece: KitPiece
  manifest: KitManifest
}

export const occEdgeKey = (level: number, e: EdgeAddr) => `${e.x},${level},${e.z},${e.side}`
export const occVertexKey = (level: number, x: number, z: number) => `${x},${level},${z}`
/** Area slots are kept apart: a floor, a stair and a roof can share a cell. */
export const occCellKey = (level: number, x: number, z: number, slot: 'f' | 's' | 'r') => `${x},${level},${z},${slot}`

export interface ChunkOccupancy {
  pieces: Occupant[]
  edges: Map<string, Occupant>
  vertices: Map<string, Occupant>
  cells: Map<string, Occupant>
}

/** Indexes one chunk's tiles. Pieces whose kit or piece is unknown are left out. */
export function indexChunk(cells: Record<string, string>, lookup: PieceLookup): ChunkOccupancy {
  const out: ChunkOccupancy = { pieces: [], edges: new Map(), vertices: new Map(), cells: new Map() }
  for (const key in cells) {
    const c = parseCellKey(key)
    const raw = cells[key]!
    const value = parseTile(raw)
    const found = value ? lookup(value.kit, value.piece) : null
    if (!c || !value || !found) continue
    const occ: Occupant = { key, level: c.level, slot: c.slot, at: { x: c.x, z: c.z }, value, raw, piece: found.piece, manifest: found.manifest }
    out.pieces.push(occ)
    const p = found.piece
    if (isEdgeSlot(p.slot)) for (const e of edgesOfEdgePiece(p, c, value.rot)) out.edges.set(occEdgeKey(c.level, e), occ)
    else if (isAreaSlot(p.slot)) for (const cell of cellsOfAreaPiece(p, c, value.rot)) out.cells.set(occCellKey(c.level, cell.x, cell.z, c.slot as 'f' | 's' | 'r'), occ)
    else {
      out.vertices.set(occVertexKey(c.level, c.x, c.z), occ)
      for (const e of edgesOfArms(p, c, value.rot)) out.edges.set(occEdgeKey(c.level, e), occ)
    }
  }
  return out
}

/** Cells a piece may reach past its anchor (the largest footprint is 3). */
const REACH = 4

/** A scene's occupancy: lookups across chunks (a piece near a chunk border may cover cells of the next). */
export class Occupancy {
  readonly chunks: Map<string, ChunkOccupancy>
  constructor(chunks: Map<string, ChunkOccupancy>) { this.chunks = chunks }
  /** Chunks whose pieces may cover cell (x, z): its own and the ones up to REACH cells west and north. */
  private near(x: number, z: number): ChunkOccupancy[] {
    const ids = new Set([chunkOf(x, z), chunkOf(x - REACH, z), chunkOf(x, z - REACH), chunkOf(x - REACH, z - REACH)])
    const out: ChunkOccupancy[] = []
    for (const id of ids) { const c = this.chunks.get(id); if (c) out.push(c) }
    return out
  }
  edge(level: number, e: EdgeAddr): Occupant | undefined {
    const k = occEdgeKey(level, e)
    for (const c of this.near(e.x, e.z)) { const o = c.edges.get(k); if (o) return o }
    return undefined
  }
  vertex(level: number, x: number, z: number): Occupant | undefined {
    const k = occVertexKey(level, x, z)
    for (const c of this.near(x, z)) { const o = c.vertices.get(k); if (o) return o }
    return undefined
  }
  cell(level: number, x: number, z: number, slot: 'f' | 's' | 'r'): Occupant | undefined {
    const k = occCellKey(level, x, z, slot)
    for (const c of this.near(x, z)) { const o = c.cells.get(k); if (o) return o }
    return undefined
  }
  /** Pieces on `level` (every level when omitted), optionally only in chunks overlapping a cell rectangle. */
  *pieces(level?: number, rect?: { minX: number; minZ: number; maxX: number; maxZ: number }): Generator<Occupant> {
    for (const [id, c] of this.chunks) {
      if (rect) {
        const [cx, cz] = id.split(',').map(Number) as [number, number]
        if ((cx + 1) * CHUNK <= rect.minX || cx * CHUNK > rect.maxX || (cz + 1) * CHUNK <= rect.minZ || cz * CHUNK > rect.maxZ) continue
      }
      for (const o of c.pieces) if (level === undefined || o.level === level) yield o
    }
  }
}

const cache = new WeakMap<Record<string, string>, { lookup: PieceLookup; occ: ChunkOccupancy }>()

/** The occupancy of a scene's tiles, reusing the index of every chunk record that did not change. */
export function sceneOccupancy(tiles: SceneTiles | undefined, lookup: PieceLookup): Occupancy {
  const chunks = new Map<string, ChunkOccupancy>()
  for (const id in tiles?.chunks ?? {}) {
    const rec = tiles!.chunks[id]!
    let hit = cache.get(rec)
    if (!hit || hit.lookup !== lookup) { hit = { lookup, occ: indexChunk(rec, lookup) }; cache.set(rec, hit) }
    chunks.set(id, hit.occ)
  }
  return new Occupancy(chunks)
}

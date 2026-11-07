/**
 * Kit piece geometry for the chunk batches: each piece's GLB loaded once (the shared loader,
 * gltf.ts), its meshes merged into one indexed, float geometry with position, normal and colour,
 * already moved into the kit's canonical frame (the manifest's `base`). Every kit piece shares the
 * one diorama material (white, vertex colours, toon bands), so a chunk is one BatchedMesh.
 */
import { create } from 'zustand'
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, type Material, type Object3D, type WebGLRenderer } from 'three'
import type { KitManifest, KitPiece } from '@/core/kits'
import { LIBRARY_BASE } from '@/ui/library'
import { loadModel } from '../gltf'
import { toonMaterial } from '../stylize'

/** The material every kit piece is drawn with (as library props are: banded Lambert on vertex colours). */
export const KIT_MATERIAL: Material = toonMaterial({ vertexColors: true, color: 0xffffff })

/** Bumped whenever a piece geometry arrives, so chunk batches waiting for it rebuild. */
export const useKitGeometryVersion = create<{ version: number }>(() => ({ version: 0 }))

const geometries = new Map<string, BufferGeometry | null>()
const pending = new Set<string>()

/** URL of a built-in piece's GLB, from its catalogue id (`builtin:kits/<kit>/<slug>.glb`). */
export function pieceUrl(piece: KitPiece): string {
  const rel = piece.catalogue.replace(/^builtin:/, '')
  return new URL(LIBRARY_BASE + rel, window.location.href).toString()
}

const keyOf = (kit: string, piece: string) => `${kit}/${piece}`

/** Copies any attribute into a float attribute of `size` components (dequantised; colour alpha dropped). */
function floatAttr(attr: BufferAttribute, size: number): BufferAttribute {
  const out = new Float32Array(attr.count * size)
  for (let i = 0; i < attr.count; i++) {
    out[i * size] = attr.getX(i)
    if (size > 1) out[i * size + 1] = attr.getY(i)
    if (size > 2) out[i * size + 2] = attr.getZ(i)
  }
  return new BufferAttribute(out, size)
}

/** Merges a piece's meshes into one canonical-frame geometry. Exported for tests. */
export function pieceGeometry(root: Object3D, piece: Pick<KitPiece, 'base'>): BufferGeometry | null {
  root.updateMatrixWorld(true)
  const base = new Matrix4().makeRotationY(((piece.base?.turns ?? 0) * Math.PI) / 2)
  if (piece.base) base.setPosition(piece.base.offset[0], piece.base.offset[1], piece.base.offset[2])
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = []
  root.traverse((o) => {
    if (!(o instanceof Mesh) || /^(COL|FOG)_/.test(o.name)) return
    const g = o.geometry as BufferGeometry
    const p = g.getAttribute('position') as BufferAttribute | undefined
    if (!p) return
    const m = base.clone().multiply(o.matrixWorld)
    const geo = new BufferGeometry()
    geo.setAttribute('position', floatAttr(p, 3))
    const n = g.getAttribute('normal') as BufferAttribute | undefined
    if (n) geo.setAttribute('normal', floatAttr(n, 3))
    geo.applyMatrix4(m)
    if (!n) geo.computeVertexNormals()
    const c = g.getAttribute('color') as BufferAttribute | undefined
    const start = pos.length / 3
    const P = geo.getAttribute('position') as BufferAttribute, N = geo.getAttribute('normal') as BufferAttribute
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i))
      nrm.push(N.getX(i), N.getY(i), N.getZ(i))
      if (c) col.push(c.getX(i), c.getY(i), c.getZ(i))
      else col.push(1, 1, 1)
    }
    const index = g.getIndex()
    if (index) for (let i = 0; i < index.count; i++) idx.push(start + index.getX(i))
    else for (let i = 0; i < P.count; i++) idx.push(start + i)
    geo.dispose()
  })
  if (!pos.length) return null
  const out = new BufferGeometry()
  out.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  out.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3))
  out.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  out.setIndex(pos.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : new BufferAttribute(new Uint16Array(idx), 1))
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

/**
 * The canonical geometry of a piece, or undefined while it loads (the load starts on the first
 * call; `useKitGeometryVersion` bumps when it lands). Null when the piece cannot be drawn.
 */
export function kitPieceGeometry(manifest: KitManifest, piece: KitPiece, renderer?: WebGLRenderer): BufferGeometry | null | undefined {
  const key = keyOf(manifest.id, piece.id)
  if (geometries.has(key)) return geometries.get(key)
  if (!pending.has(key)) {
    pending.add(key)
    loadModel(pieceUrl(piece), renderer ? { renderer } : {}).promise.then(
      (loaded) => { geometries.set(key, pieceGeometry(loaded.gltf.scene, piece)) },
      (e: unknown) => { console.warn(`kit piece ${key} failed to load`, e); geometries.set(key, null) },
    ).finally(() => {
      pending.delete(key)
      useKitGeometryVersion.setState((s) => ({ version: s.version + 1 }))
    })
  }
  return undefined
}

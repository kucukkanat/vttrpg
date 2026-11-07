/**
 * Format conversion: OBJ (+MTL), FBX, STL and Draco-compressed glTF are read with the three.js
 * loaders and written out as one GLB with GLTFExporter. GLB and plain glTF skip this step; glTF
 * Transform reads them directly (optimise.ts).
 *
 * STL and OBJ without materials need no DOM and run inside the import worker. Anything with
 * textures (MTL, FBX) needs image decoding, which three's TextureLoader only does on the main thread.
 */
import {
  BufferGeometry, Color, DoubleSide, FrontSide, Group, LoadingManager, Material, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshPhongMaterial, MeshStandardMaterial, Object3D, type Texture,
} from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { findCompanion, extOf, mimeForImage, type ModelSet } from './formats'
import { ModelImportError, type InputFile } from './types'

/** True when this set can be converted without a DOM (no textures to decode). */
export function convertsWithoutDom(set: ModelSet): boolean {
  if (set.format === 'stl') return true
  if (set.format === 'obj') return !/^\s*mtllib\s/m.test(new TextDecoder().decode(set.main.bytes.subarray(0, 1 << 20)))
  return false
}

/** True when the set needs the three.js path at all (GLB/glTF without Draco go straight to glTF Transform). */
export function needsThreeConversion(set: ModelSet): boolean {
  if (set.format === 'obj' || set.format === 'fbx' || set.format === 'stl') return true
  return usesExtension(set, 'KHR_draco_mesh_compression')
}

/** Whether a GLB / glTF set declares a glTF extension. */
export function usesExtension(set: ModelSet, ext: string): boolean {
  const json = readGltfJson(set)
  if (!json) return false
  const used = [...((json.extensionsUsed as string[] | undefined) ?? []), ...((json.extensionsRequired as string[] | undefined) ?? [])]
  return used.includes(ext)
}

/** The JSON chunk of a GLB, or the parsed .gltf; undefined if unreadable. */
export function readGltfJson(set: ModelSet): Record<string, unknown> | undefined {
  try {
    const b = set.main.bytes
    if (set.format === 'glb') {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
      if (dv.getUint32(0, true) !== 0x46546c67) return undefined
      const len = dv.getUint32(12, true)
      if (dv.getUint32(16, true) !== 0x4e4f534a) return undefined
      return JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + len)))
    }
    if (set.format === 'gltf') return JSON.parse(new TextDecoder().decode(b))
  } catch { /* fall through */ }
  return undefined
}

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? (b.buffer as ArrayBuffer) : (b.slice().buffer as ArrayBuffer)
}

/**
 * A LoadingManager that serves companion files from memory (blob: URLs) and lets the caller wait
 * for every texture it started to finish loading.
 */
function memoryManager(files: InputFile[], mainName: string) {
  const urls: string[] = []
  const byRef = new Map<string, string>()
  let started = 0
  let settled = 0
  let wake: (() => void) | null = null
  const missing: string[] = []
  const manager = new LoadingManager()
  manager.itemStart = ((orig) => (url: string) => { started++; orig.call(manager, url) })(manager.itemStart)
  const done = () => { settled++; if (settled >= started) wake?.() }
  manager.itemEnd = ((orig) => (url: string) => { orig.call(manager, url); done() })(manager.itemEnd)
  manager.itemError = ((orig) => (url: string) => { orig.call(manager, url); missing.push(url) })(manager.itemError)
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url
    const cached = byRef.get(url)
    if (cached) return cached
    const f = findCompanion(files, url.replace(/^memory:\/+/, ''), mainName)
    if (!f) return url
    const u = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: mimeForImage(f.name) }))
    urls.push(u)
    byRef.set(url, u)
    return u
  })
  return {
    manager,
    missing,
    /** Resolves once every started load has finished (or after the timeout). */
    async idle(timeoutMs = 30_000): Promise<void> {
      if (settled >= started) return
      await new Promise<void>((resolve) => {
        wake = resolve
        setTimeout(resolve, timeoutMs)
      })
    },
    dispose() { for (const u of urls) URL.revokeObjectURL(u) },
  }
}

/** Phong, Lambert and Basic materials export poorly; convert them to PBR with the same maps. */
export function toStandardMaterial(m: Material): Material {
  if (m instanceof MeshStandardMaterial) return m
  if (!(m instanceof MeshPhongMaterial || m instanceof MeshLambertMaterial || m instanceof MeshBasicMaterial)) {
    const fallback = new MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.8 })
    fallback.name = m.name
    return fallback
  }
  const shininess = m instanceof MeshPhongMaterial ? m.shininess : 0
  const s = new MeshStandardMaterial({
    name: m.name,
    color: (m as MeshPhongMaterial).color?.clone() ?? new Color(0xffffff),
    map: m.map,
    alphaMap: m.alphaMap,
    transparent: m.transparent,
    opacity: m.opacity,
    alphaTest: m.alphaTest,
    side: m.side === DoubleSide ? DoubleSide : FrontSide,
    vertexColors: m.vertexColors,
    roughness: Math.max(0.2, Math.min(1, 1 - Math.sqrt(Math.max(0, shininess) / 100))),
    metalness: 0,
  })
  if (m instanceof MeshPhongMaterial || m instanceof MeshLambertMaterial) {
    s.emissive.copy(m.emissive)
    s.emissiveMap = m.emissiveMap
    s.emissiveIntensity = m.emissiveIntensity
    s.aoMap = m.aoMap
  }
  if (m instanceof MeshPhongMaterial) {
    s.normalMap = m.normalMap
    s.normalScale.copy(m.normalScale)
    s.bumpMap = m.bumpMap
  }
  return s
}

function standardiseMaterials(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toStandardMaterial) : toStandardMaterial(mesh.material)
  })
}

/** Drops textures whose image never loaded (missing file), so the exporter does not throw. */
function dropBrokenTextures(root: Object3D, warnings: string[]): void {
  const slots = ['map', 'normalMap', 'emissiveMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'bumpMap'] as const
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const rec = mat as unknown as Record<string, Texture | null | undefined>
      for (const slot of slots) {
        const t = rec[slot]
        if (!t) continue
        const img = t.image as { width?: number; data?: unknown } | undefined
        if (!img || !(img.width || img.data)) {
          rec[slot] = null
          warnings.push(`A texture (${t.name || slot}) could not be loaded and was left out.`)
        }
      }
      mat.needsUpdate = true
    }
  })
}

function countMeshes(root: Object3D): number {
  let n = 0
  root.traverse((o) => { if ((o as Mesh).isMesh && ((o as Mesh).geometry as BufferGeometry).getAttribute('position')?.count) n++ })
  return n
}

async function loadObj(set: ModelSet, mm: ReturnType<typeof memoryManager>): Promise<Object3D> {
  const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
  const text = new TextDecoder().decode(set.main.bytes)
  const loader = new OBJLoader(mm.manager)
  const mtlRef = text.match(/^\s*mtllib\s+(.+?)\s*$/m)?.[1]
  if (mtlRef) {
    const mtlFile = findCompanion(set.files, mtlRef, set.main.name) ?? set.files.find((f) => extOf(f.name) === 'mtl')
    if (mtlFile) {
      const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js')
      const mtl = new MTLLoader(mm.manager).parse(new TextDecoder().decode(mtlFile.bytes), 'memory:///')
      mtl.preload()
      loader.setMaterials(mtl)
    }
  }
  return loader.parse(text)
}

async function loadStl(set: ModelSet): Promise<Object3D> {
  const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
  const geometry = new STLLoader().parse(toArrayBuffer(set.main.bytes))
  const hasColour = !!geometry.getAttribute('color')
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: hasColour ? 0xffffff : 0xb8b0a0, roughness: 0.8, vertexColors: hasColour }))
  mesh.name = set.main.name.replace(/\.[^.]+$/, '')
  const g = new Group()
  g.add(mesh)
  return g
}

async function loadFbx(set: ModelSet, mm: ReturnType<typeof memoryManager>): Promise<Object3D> {
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
  const { TGALoader } = await import('three/examples/jsm/loaders/TGALoader.js')
  mm.manager.addHandler(/\.tga$/i, new TGALoader(mm.manager))
  return new FBXLoader(mm.manager).parse(toArrayBuffer(set.main.bytes), 'memory:///')
}

async function loadDracoGltf(set: ModelSet, mm: ReturnType<typeof memoryManager>): Promise<Object3D> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js')
  const loader = new GLTFLoader(mm.manager)
  const draco = new DRACOLoader()
  loader.setDRACOLoader(draco)
  try {
    const data = set.format === 'glb' ? toArrayBuffer(set.main.bytes) : new TextDecoder().decode(set.main.bytes)
    const gltf = await loader.parseAsync(data, 'memory:///')
    gltf.scene.animations = gltf.animations
    return gltf.scene
  } finally {
    draco.dispose()
  }
}

/**
 * Converts a model set to GLB bytes in source units (no scaling or re-centring yet).
 * Throws ModelImportError('corrupt') when the loader cannot make sense of the file.
 */
export async function convertToGlb(set: ModelSet, warnings: string[] = []): Promise<Uint8Array> {
  const mm = memoryManager(set.files, set.main.name)
  let root: Object3D
  try {
    try {
      if (set.format === 'stl') root = await loadStl(set)
      else if (set.format === 'obj') root = await loadObj(set, mm)
      else if (set.format === 'fbx') root = await loadFbx(set, mm)
      else root = await loadDracoGltf(set, mm)
    } catch (e) {
      const label = set.format.toUpperCase()
      throw new ModelImportError('corrupt', `The ${label} file could not be read; it may be damaged or use a version the browser loader does not support (${errText(e)}).`)
    }
    await mm.idle()
    if (!countMeshes(root)) throw new ModelImportError('empty', 'The file has no visible geometry.')
    for (const url of mm.missing) warnings.push(`Missing file: ${url.split('/').pop()}`)
    standardiseMaterials(root)
    dropBrokenTextures(root, warnings)
    const exporter = new GLTFExporter()
    const out = await exporter.parseAsync(root, { binary: true, onlyVisible: false, animations: root.animations ?? [] })
    if (!(out instanceof ArrayBuffer)) throw new ModelImportError('corrupt', 'The converter did not produce a GLB.')
    return new Uint8Array(out)
  } finally {
    mm.dispose()
  }
}

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.length > 140 ? m.slice(0, 140) + '…' : m
}

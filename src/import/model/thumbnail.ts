/**
 * Offscreen thumbnails: one hidden WebGLRenderer, reused across imports (creating many WebGL
 * contexts hits browser limits), renders the optimised GLB from a fixed 3/4 camera with neutral
 * studio light on a transparent background, 256 px, WebP (PNG where the browser cannot encode WebP).
 */
import {
  AmbientLight, Box3, DirectionalLight, HemisphereLight, Mesh, PerspectiveCamera, PMREMGenerator, Scene, Sphere,
  SRGBColorSpace, Vector3, WebGLRenderer, type Material, type Object3D, type Texture,
} from 'three'
import { createGltfLoader } from '@/table/gltf'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export const THUMBNAIL_PX = 256

/** Camera direction: 45° around, 28° above the horizon, looking at the model's centre. */
export const THUMBNAIL_AZIMUTH = Math.PI / 4
export const THUMBNAIL_ELEVATION = (28 * Math.PI) / 180
const FOV = 30

let renderer: WebGLRenderer | null = null
let envMap: Texture | null = null

function getRenderer(): WebGLRenderer {
  if (renderer) return renderer
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = THUMBNAIL_PX
  renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(THUMBNAIL_PX, THUMBNAIL_PX, false)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  const pmrem = new PMREMGenerator(renderer)
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  return renderer
}

/** Camera distance that fits a sphere of `radius` in a vertical field of view `fovDeg`, with margin. */
export function fitDistance(radius: number, fovDeg = FOV, margin = 1.08): number {
  return (radius * margin) / Math.sin(((fovDeg * Math.PI) / 180) / 2)
}

/** Unit vector from the target to the camera for the standard 3/4 view. */
export function thumbnailDirection(): [number, number, number] {
  const c = Math.cos(THUMBNAIL_ELEVATION)
  return [Math.sin(THUMBNAIL_AZIMUTH) * c, Math.sin(THUMBNAIL_ELEVATION), Math.cos(THUMBNAIL_AZIMUTH) * c]
}

export async function loadGlb(glb: Uint8Array): Promise<{ scene: Object3D; dispose(): void }> {
  // The shared loader (src/table/gltf.ts): Draco, meshopt and, with the thumbnail renderer, KTX2.
  const loader = createGltfLoader(typeof document === 'undefined' ? {} : { renderer: getRenderer() })
  const buf = glb.byteOffset === 0 && glb.byteLength === glb.buffer.byteLength ? glb.buffer : glb.slice().buffer
  const gltf = await loader.parseAsync(buf as ArrayBuffer, '')
  return { scene: gltf.scene, dispose: () => disposeObject(gltf.scene) }
}

export function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(m as Material & Record<string, unknown>)) if ((v as Texture | null)?.isTexture) (v as Texture).dispose()
      m.dispose()
    }
  })
}

/** A studio set for a model: lights, environment and a camera framing it from the 3/4 view. */
export function stageModel(model: Object3D, aspect = 1): { scene: Scene; camera: PerspectiveCamera; radius: number; target: Vector3 } {
  const scene = new Scene()
  scene.environment = envMap
  scene.add(new HemisphereLight(0xfff4e0, 0x3a2a1a, 0.9))
  scene.add(new AmbientLight(0xffffff, 0.25))
  const key = new DirectionalLight(0xffffff, 2.2)
  key.position.set(3, 5, 4)
  scene.add(key)
  scene.add(model)
  const box = new Box3().setFromObject(model, true)
  const sphere = box.getBoundingSphere(new Sphere())
  const radius = Math.max(sphere.radius, 1e-3)
  const camera = new PerspectiveCamera(FOV, aspect, radius / 100, radius * 100)
  const d = fitDistance(radius)
  const [dx, dy, dz] = thumbnailDirection()
  camera.position.set(sphere.center.x + dx * d, sphere.center.y + dy * d, sphere.center.z + dz * d)
  camera.lookAt(sphere.center)
  return { scene, camera, radius, target: sphere.center.clone() }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('thumbnail encode failed'))), type, 0.9))
}

/** Renders the GLB to a 256 px WebP (PNG when the browser cannot encode WebP). */
export async function renderThumbnail(glb: Uint8Array): Promise<Blob> {
  const r = getRenderer()
  const { scene: model, dispose } = await loadGlb(glb)
  try {
    const { scene, camera } = stageModel(model)
    r.render(scene, camera)
    const canvas = r.domElement
    const webp = await canvasBlob(canvas, 'image/webp')
    return webp.type === 'image/webp' ? webp : await canvasBlob(canvas, 'image/png')
  } finally {
    dispose()
  }
}

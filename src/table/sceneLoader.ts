/**
 * GLB scene loader applying the Blender naming convention (see PLAN.md and
 * public/library/scenes/README.md):
 *
 *   COL_*   meshes  -> colliders + 2D wall segments for line-of-sight; hidden
 *   LIGHT_* lights  -> dynamic lights; custom props `flicker`, `color_temp`
 *   SPAWN_* empties -> token spawn points
 *   GRID    empty   -> grid origin; custom props `cell_size`, `type`
 *   FOG_*   meshes  -> regions that start hidden; hidden
 *   scene custom prop `ambient_audio` (or `AUDIO_ambient`) -> ambient track reference
 *
 * Decoding (Draco, meshopt, KTX2) goes through the shared loader in gltf.ts, with every decoder
 * bundled. KTX2/Basis textures need `{ renderer }` so the loader can detect GPU formats; without a
 * renderer, GLBs that use KHR_texture_basisu fail to load with a clear error.
 */
import {
  Box3, Color, Light, Mesh, Object3D, PointLight, SpotLight, Texture, Vector3,
  type WebGLRenderer,
} from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { loadGltf } from './gltf'
import type { GridSpec, GridType, Vec3 } from '@/core/geometry'
import { extractWallSegments, type WallSegment } from './walls'

export type { WallSegment } from './walls'

export interface LoadedScene {
  root: Object3D
  colliders: Object3D[]
  /** 2D wall segments on the XZ plane extracted from COL_* meshes, for line-of-sight. */
  walls: WallSegment[]
  lights: { object: Object3D; flicker?: number }[]
  spawns: Record<string, Vec3>
  grid: GridSpec | null
  fogRegions: Object3D[]
  ambientAudio?: string
  report: SceneValidationReport
  /** World-space bounds of everything (visible meshes and colliders). */
  bounds: Box3
  /** Highest floor-like surface found under the spawn points / origin; 0 when unknown. */
  floorY: number
}

export interface SceneValidationReport {
  found: string[]
  missing: string[]
  warnings: string[]
}

export interface LoadSceneOptions {
  /** Needed for KTX2 texture support (GPU format detection). */
  renderer?: WebGLRenderer
  /** Directory of the Draco decoder; default: the copy bundled with three. */
  dracoDecoderPath?: string
  /** Directory of the Basis transcoder; default: the copy bundled with three. */
  ktx2TranscoderPath?: string
  /** Asset hash of the scene model; its cost is recorded for `getModelStats` (gltf.ts). */
  sha256?: string
  /** Pass `fetch`-style abort control through to the loader. */
  signal?: AbortSignal
}

export { createGltfLoader } from './gltf'

/**
 * One readable sentence for a failed scene load, for the table banner and the Scenes list. The raw
 * error (asset resolution trail, HTTP status, parser output) belongs in the console, not on screen.
 */
export function describeLoadError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  const msg = raw.toLowerCase()
  if (/404|not found|could not resolve|no sources/.test(msg)) return 'The model file could not be found.'
  if (/hash mismatch|checksum/.test(msg)) return 'The downloaded file does not match the one the scene expects.'
  if (/failed to fetch|network|load failed|timed out|offline/.test(msg)) return 'The model could not be downloaded. Check the connection and try again.'
  if (/abort/.test(msg)) return 'Loading was interrupted.'
  if (/gltf|glb|json|unexpected|parse|invalid|magic|version|draco|ktx|basis|extension/.test(msg)) return 'The file is not a GLB this app can read.'
  return raw.length > 120 ? `${raw.slice(0, 119)}…` : raw
}

export async function loadSceneModel(url: string, opts: LoadSceneOptions = {}): Promise<LoadedScene> {
  const { gltf } = await loadGltf(url, opts)
  if (opts.signal?.aborted) throw new DOMException('scene load aborted', 'AbortError')
  return interpretScene(gltf)
}

/** Pure interpretation of a parsed glTF; exported for tests and for pre-loaded models. */
export function interpretScene(gltf: GLTF): LoadedScene {
  const root = gltf.scene
  root.updateMatrixWorld(true)
  const report: SceneValidationReport = { found: [], missing: [], warnings: [] }
  const colliders: Object3D[] = []
  const walls: WallSegment[] = []
  const lights: LoadedScene['lights'] = []
  const spawns: Record<string, Vec3> = {}
  const fogRegions: Object3D[] = []
  let grid: GridSpec | null = null
  const bounds = new Box3()
  const tmp = new Vector3()

  const lightsSeen = new Set<Light>()
  root.traverse((obj) => {
    const name = obj.name ?? ''
    if (obj instanceof Mesh) {
      if (name.startsWith('COL_')) {
        colliders.push(obj)
        obj.visible = false
        obj.userData.vttrpg = 'collider'
        walls.push(...extractWallSegments(obj.geometry, obj.matrixWorld))
        bounds.expandByObject(obj)
        report.found.push(name)
        return
      }
      if (name.startsWith('FOG_')) {
        fogRegions.push(obj)
        obj.visible = false
        obj.userData.vttrpg = 'fog'
        report.found.push(name)
        return
      }
      obj.castShadow = true
      obj.receiveShadow = true
      bounds.expandByObject(obj)
      return
    }
    if (obj instanceof Light) {
      if (lightsSeen.has(obj)) return
      lightsSeen.add(obj)
      // Blender exports the object as a node (named LIGHT_x) whose child is the light itself.
      const holder = obj.parent && obj.parent.name.startsWith('LIGHT_') ? obj.parent : obj
      const data = { ...holder.userData, ...obj.userData } as Record<string, unknown>
      const label = holder.name || obj.name || 'light'
      if (!label.startsWith('LIGHT_')) report.warnings.push(`light "${label}" does not follow the LIGHT_ convention; kept anyway`)
      else report.found.push(label)
      const flicker = num(data.flicker)
      const kelvin = num(data.color_temp)
      if (kelvin !== undefined) obj.color.copy(kelvinToColor(kelvin))
      if (obj instanceof PointLight || obj instanceof SpotLight) obj.decay = 2
      lights.push(flicker !== undefined ? { object: obj, flicker } : { object: obj })
      return
    }
    // Empties / plain nodes
    if (name.startsWith('SPAWN_')) {
      obj.getWorldPosition(tmp)
      spawns[name.slice('SPAWN_'.length) || 'player'] = { x: tmp.x, y: tmp.y, z: tmp.z }
      report.found.push(name)
      return
    }
    if (name === 'GRID' || name.startsWith('GRID.')) {
      obj.getWorldPosition(tmp)
      const cellSize = num(obj.userData.cell_size) ?? num(obj.userData.cellSize)
      const type = gridType(obj.userData.type)
      if (cellSize === undefined) report.warnings.push('GRID has no cell_size custom property; defaulting to 1')
      if (obj.userData.type !== undefined && !type) report.warnings.push(`GRID type "${String(obj.userData.type)}" unknown; using square`)
      grid = { type: type ?? 'square', cellSize: cellSize ?? 1, origin: { x: tmp.x, y: tmp.y, z: tmp.z } }
      report.found.push('GRID')
    }
  })

  const sceneData = { ...(gltf.userData ?? {}), ...(root.userData ?? {}) } as Record<string, unknown>
  const ambientAudio = str(sceneData.ambient_audio) ?? str(sceneData.AUDIO_ambient) ?? str(sceneData.ambientAudio)
  if (ambientAudio) report.found.push('ambient_audio')

  if (colliders.length === 0) report.missing.push('COL_* colliders (no walls: line-of-sight is unobstructed)')
  if (lights.length === 0) report.missing.push('LIGHT_* lights (scene will only have ambient light)')
  if (!spawns.player) report.missing.push('SPAWN_player')
  if (!grid) report.missing.push('GRID (grid origin and cell size)')
  if (fogRegions.length === 0) report.warnings.push('no FOG_* regions; the whole map starts unexplored')
  if (!ambientAudio) report.missing.push('ambient_audio scene property')
  if (bounds.isEmpty()) {
    report.warnings.push('scene has no meshes')
    bounds.set(new Vector3(-5, 0, -5), new Vector3(5, 3, 5))
  }

  const floorY = estimateFloorY(root, spawns, bounds)

  const scene: LoadedScene = {
    root, colliders, walls, lights, spawns, grid, fogRegions, report, bounds, floorY,
  }
  if (ambientAudio) scene.ambientAudio = ambientAudio
  return scene
}

/** Floor height: spawn point height if any, else the bottom of the bounds. */
function estimateFloorY(_root: Object3D, spawns: Record<string, Vec3>, bounds: Box3): number {
  const s = spawns.player ?? Object.values(spawns)[0]
  if (s) return s.y
  return bounds.min.y
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function gridType(v: unknown): GridType | undefined {
  if (v === 'square' || v === 'hex' || v === 'none') return v
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    if (s === 'squares' || s === 'sq') return 'square'
    if (s === 'hexes' || s === 'hexagon' || s === 'hexagonal') return 'hex'
  }
  return undefined
}

/** Approximate blackbody colour for a temperature in Kelvin (1000..40000). */
export function kelvinToColor(kelvin: number): Color {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100
  let r: number, g: number, b: number
  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592)
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492)
    b = 255
  }
  const clamp = (v: number) => Math.min(255, Math.max(0, v)) / 255
  return new Color(clamp(r), clamp(g), clamp(b))
}

/** Dispose geometries, materials and textures of a loaded scene. */
export function disposeScene(scene: LoadedScene): void {
  scene.root.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry.dispose()
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        for (const v of Object.values(m)) if (v instanceof Texture) v.dispose()
        m.dispose()
      }
    }
  })
}

// TODO(table session): implement the Blender naming convention loader (see PLAN.md).
import type { Object3D } from 'three'
import type { GridSpec, Vec3 } from '@/core/geometry'

export interface WallSegment { a: { x: number; z: number }; b: { x: number; z: number } }

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
}

export interface SceneValidationReport {
  found: string[]
  missing: string[]
  warnings: string[]
}

export async function loadSceneModel(_url: string): Promise<LoadedScene> {
  throw new Error('table: not implemented')
}

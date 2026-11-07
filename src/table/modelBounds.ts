/**
 * Footprints of loaded prop models in their own frame, by model hash. A visible wall or door model
 * without an explicit length takes its segment from these bounds (src/core/propParts.ts); the
 * renderers note them when a model loads, and `useModelBoundsVersion` lets the wall pipeline
 * recompute. No three.js here, so the controller can read it too.
 */
import { create } from 'zustand'
import type { Prop } from '@/core/doc'
import type { FootprintBounds } from '@/core/propParts'

const bounds = new Map<string, FootprintBounds>()

export const useModelBoundsVersion = create<{ version: number }>(() => ({ version: 0 }))

let pending = false
function bump() {
  if (pending) return
  pending = true
  queueMicrotask(() => {
    pending = false
    useModelBoundsVersion.setState((s) => ({ version: s.version + 1 }))
  })
}

const same = (a: FootprintBounds, b: FootprintBounds) =>
  Math.abs(a.min.x - b.min.x) < 1e-6 && Math.abs(a.min.z - b.min.z) < 1e-6 && Math.abs(a.max.x - b.max.x) < 1e-6 && Math.abs(a.max.z - b.max.z) < 1e-6

/** Records a model's footprint (from its local Box3), once per hash. */
export function noteModelBounds(sha256: string, box: { min: { x: number; z: number }; max: { x: number; y?: number; z: number } } | null | undefined): void {
  if (!box || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x) || box.max.x < box.min.x) return
  const next: FootprintBounds = { min: { x: box.min.x, z: box.min.z }, max: { x: box.max.x, z: box.max.z } }
  if (box.max.y !== undefined && Number.isFinite(box.max.y)) next.top = box.max.y
  const had = bounds.get(sha256)
  if (had && same(had, next)) return
  bounds.set(sha256, next)
  bump()
}

/** The measured footprint of a prop's model, when it has loaded on this client. */
export function modelBoundsOf(prop: Prop): FootprintBounds | undefined {
  return bounds.get(prop.model.sha256)
}

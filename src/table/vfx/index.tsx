/**
 * VFX layer: renders GameEvents of kind 'vfx' as particle/mesh effects inside the table <Canvas>.
 * Presets are named in `VfxCue.preset` (see src/core/pack.ts). Owned by the vfx workstream.
 */
import type { GameEvent } from '@/core/doc'

export interface VfxLayerProps {
  /** Events from the store; the layer plays each 'vfx' event once (keyed by id) and ignores events older than `since`. */
  events: GameEvent[]
  since: number
  /** Scene cell size, for scaling presets. */
  cellSize: number
}

// TODO(vfx): implement. Mount point is inside TableCanvas; tokens' positions come from the store.
export function VfxLayer(_props: VfxLayerProps) {
  return null
}

/** Weather presets a scene can enable (`scene.weather`). */
export type WeatherKind = 'none' | 'rain' | 'snow' | 'fog' | 'embers'
export function WeatherLayer(_props: { kind: WeatherKind; bounds: { min: [number, number, number]; max: [number, number, number] } }) {
  return null
}

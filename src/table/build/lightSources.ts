/**
 * The Lights shelf's light sources: invisible light props (warm, cold, spot) picked up and
 * stamped like any model. Colour, reach and flicker are then set in the Inspector.
 */
import { COLD_LIGHT, NO_MODEL, SPOT_LIGHT, WARM_LIGHT } from '@/core/propParts'
import type { PropLight } from '@/core/doc'
import type { HeldModel } from './placement'

export type LightSourceId = 'warm' | 'cold' | 'spot'

export const LIGHT_SOURCES: readonly { id: LightSourceId; title: string; hint: string; light: PropLight }[] = [
  { id: 'warm', title: 'Warm light', hint: 'Torchlight glow; flickers', light: WARM_LIGHT },
  { id: 'cold', title: 'Cold light', hint: 'Moonlight or magic, steady', light: COLD_LIGHT },
  { id: 'spot', title: 'Spotlight', hint: 'A cone shining down', light: SPOT_LIGHT },
]

/** What a click on a light source card puts in hand. */
export function lightSourceHeld(id: LightSourceId): HeldModel {
  const src = LIGHT_SOURCES.find((s) => s.id === id) ?? LIGHT_SOURCES[0]!
  return { title: src.title, model: NO_MODEL, scale: { x: 1, y: 1, z: 1 }, size: [0.3, 0.3, 0.3], fixtures: { light: { ...src.light } } }
}

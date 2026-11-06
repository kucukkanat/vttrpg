/** Weather volume helpers. Pure. */

export interface WeatherBounds {
  min: [number, number, number]
  max: [number, number, number]
}

export interface WeatherBox {
  minX: number; minY: number; minZ: number
  width: number; height: number; depth: number
  /** Floor area in square world units. */
  area: number
}

/** Normalize bounds into a box with a sane minimum height (clouds need headroom). */
export function weatherBox(b: WeatherBounds, minHeight = 3): WeatherBox {
  const minX = Math.min(b.min[0], b.max[0])
  const minY = Math.min(b.min[1], b.max[1])
  const minZ = Math.min(b.min[2], b.max[2])
  const width = Math.max(0.5, Math.abs(b.max[0] - b.min[0]))
  const depth = Math.max(0.5, Math.abs(b.max[2] - b.min[2]))
  const height = Math.max(minHeight, Math.abs(b.max[1] - b.min[1]))
  return { minX, minY, minZ, width, height, depth, area: width * depth }
}

/** Particle budget for a floor area: `perSqm` per square unit, clamped. */
export function particleBudget(area: number, perSqm: number, min: number, max: number, density = 1): number {
  const n = Math.round(area * perSqm * Math.max(0, density))
  return Math.min(max, Math.max(min, n))
}

export const RAIN_MAX = 2000
export const SNOW_MAX = 800
export const EMBERS_MAX = 400
export const FOG_MAX = 12

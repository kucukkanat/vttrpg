/**
 * Exposure and atmosphere for the table (TableCanvas): a cool fog tinted like the ambient light,
 * which is also the background, so the edge of the diorama melts into it; and the ambient floor
 * under the warm practical lights, high enough that dark scenes stay readable. Also the blob
 * shadow that grounds every token when shadow maps are off.
 * Pure numbers, tested; three.js objects are built in TableCanvas.
 */

/** Fog / background colour for a scene darkness in [0, 1]: dusky blue-grey when lit, deep indigo when dark. */
export function fogColor(darkness: number): string {
  const d = clamp01(darkness)
  const lit = [0x34, 0x36, 0x44]
  const dark = [0x12, 0x12, 0x1c]
  const hex = lit.map((v, i) => Math.round(v + (dark[i]! - v) * d).toString(16).padStart(2, '0')).join('')
  return `#${hex}`
}

/**
 * Fog start and end for a camera `distance` metres from what it looks at, in a scene of
 * horizontal `radius`: the near half of the diorama stays clear, the far edge and the void past it
 * fade out. Never starts closer than a few metres, so first person in a small room stays clear.
 */
export function fogRange(distance: number, radius: number): { near: number; far: number } {
  const r = Math.max(4, radius)
  const near = Math.max(6, distance + 0.35 * r)
  return { near, far: near + 2.2 * r }
}

/** Ambient and hemisphere intensities for a scene darkness: dark scenes keep a readable floor. */
export function ambientLevels(darkness: number): { ambient: number; hemisphere: number } {
  const lit = 1 - clamp01(darkness)
  return { ambient: 0.28 + 0.75 * lit, hemisphere: 0.22 + 0.5 * lit }
}

/**
 * Blob shadow under a token base, as a multiple of the base radius and an opacity: full under a
 * token on the floor, wider and fainter as it is lifted, never quite gone.
 */
export function blobShadowLook(elevation: number, cell: number): { scale: number; opacity: number } {
  const k = Math.max(0.15, 1 - Math.max(0, elevation) / (6 * cell))
  return { scale: 1.25 + 0.35 * (1 - k), opacity: 0.55 * k }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
}

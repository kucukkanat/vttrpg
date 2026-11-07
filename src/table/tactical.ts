/**
 * Tactical view maths (CameraRig): a top-down orbit camera that turns in 45° steps, entered from
 * the HUD, the T key, or by zooming out against the orbit camera's distance limit.
 * Angles follow OrbitControls: `phi` is measured from straight up, `theta` (azimuth) is
 * atan2(offset.x, offset.z) of the camera's offset from its target, so 0 looks north from the south.
 */

/** Polar angle of the tactical camera: practically straight down, but never exactly (lookAt needs a heading). */
export const TACTICAL_PHI = 0.02
/** Polar angle the camera tilts back to when tactical view ends (about 50° above the floor). */
export const EXIT_PHI = (40 * Math.PI) / 180
export const TACTICAL_STEP = Math.PI / 4

/** Azimuth for a heading of `turn` 45° steps, wrapped to (-PI, PI]. */
export function tacticalTheta(turn: number): number {
  return wrapAngle(turn * TACTICAL_STEP)
}

/** The 45° step nearest to an azimuth, so entering tactical view keeps roughly the current heading. */
export function nearestTurn(theta: number): number {
  return Math.round(theta / TACTICAL_STEP)
}

export function wrapAngle(a: number): number {
  const t = Math.PI * 2
  let r = ((a % t) + t) % t
  if (r > Math.PI) r -= t
  return r
}

/** `goal` moved by whole turns so it is the nearest equivalent of itself to `from` (no long way round). */
export function nearestEquivalent(from: number, goal: number): number {
  return from + wrapAngle(goal - from)
}

/**
 * Farthest the orbit camera may zoom out for a scene whose overview pose sits `overview` metres
 * from its target: some room past the overview, never closer than ten cells nor beyond 80 m.
 */
export function orbitMaxDistance(overview: number, cellSize: number): number {
  return Math.min(80, Math.max(10 * cellSize, overview * 1.4))
}

/**
 * Distance at which a straight-down camera with vertical field of view `vfov` (radians) and
 * `aspect` frames a `w` x `d` floor at any 45° heading (the larger side is used both ways).
 */
export function topDownDistance(w: number, d: number, vfov: number, aspect: number): number {
  const side = Math.max(w, d, 4)
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
  const fov = Math.min(vfov, hfov)
  return (side / 2 / Math.tan(fov / 2)) * 1.08
}

/** Zooming out at (or within 2 % of) the limit: the wheel or pinch has nowhere left to go. */
export function atZoomLimit(distance: number, max: number): boolean {
  return distance >= max * 0.98
}

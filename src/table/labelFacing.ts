/**
 * Keeps the initials on a token's top readable from any camera yaw: the label turns about the
 * vertical so its "up" follows the screen's up, projected onto the floor. Pure maths, tested.
 */

/**
 * Yaw (radians, about +Y) for a floor-lying label whose text-up is local -Z after it is laid flat
 * (`rotation-x = -PI/2`), given the camera's world up vector projected on the floor (`upX`, `upZ`)
 * and the yaw of the label's parent. Null when the camera looks level, where the projection
 * vanishes and the previous yaw should be kept.
 */
export function labelYaw(upX: number, upZ: number, parentYaw = 0): number | null {
  if (upX * upX + upZ * upZ < 1e-8) return null
  return Math.atan2(-upX, -upZ) - parentYaw
}

/** Smallest signed difference a - b, wrapped to (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

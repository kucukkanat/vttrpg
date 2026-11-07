/**
 * Hit-stop: a few frames where every running effect holds still, so a critical hit lands with
 * weight. Effects advance their own clocks through `useLifetime` (presets/common.ts), which asks
 * `advanceClock` how much of each frame to count; during a stop the answer is nothing. Only
 * criticals request one (VfxLayer), and never when the viewer prefers reduced motion. Pure apart
 * from the module-level deadline; one table per page.
 */

/** About five frames at 60 fps. */
export const HIT_STOP_MS = 85
/** Shake that goes with a critical hit: strength 0..1 and decay in ms. */
export const CRIT_SHAKE = { strength: 0.55, durationMs: 320 }

let stopUntil = 0

/** Freeze effects until `now + ms` (extends a running stop, never shortens it). */
export function requestHitStop(ms = HIT_STOP_MS, now = performance.now()): void {
  stopUntil = Math.max(stopUntil, now + Math.max(0, ms))
}

/** Whether a stop is holding effects at `now`. */
export function hitStopActive(now = performance.now()): boolean {
  return now < stopUntil
}

/** Forget any pending stop (tests, table unmount). */
export function resetHitStop(): void {
  stopUntil = 0
}

/**
 * An effect's clock after a frame of `dtSeconds` ending at `nowMs`: unchanged while a stop holds,
 * otherwise advanced by the frame (a frame that straddles the end of a stop counts only the part
 * after it).
 */
export function advanceClock(elapsedSeconds: number, dtSeconds: number, nowMs: number, until = stopUntil): number {
  if (nowMs <= until) return elapsedSeconds
  const free = Math.min(dtSeconds, (nowMs - until) / 1000)
  return elapsedSeconds + Math.max(0, free)
}

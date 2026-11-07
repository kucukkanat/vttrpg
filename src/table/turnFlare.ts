/** The turn-start flare `TurnRing` plays once when a combatant's turn begins. Pure; no three.js. */

/** The flare bursts from the token's footprint out to this many radii over FLARE_MS. */
export const FLARE_RADII = 3.2
export const FLARE_MS = 900

/** Scale (in radii) and opacity of the flare `ms` after the turn started; null before and after. */
export function flareAt(ms: number): { scale: number; opacity: number } | null {
  if (ms < 0 || ms >= FLARE_MS) return null
  const t = ms / FLARE_MS
  const ease = 1 - (1 - t) ** 3
  return { scale: 1 + (FLARE_RADII - 1) * ease, opacity: 0.95 * (1 - t) ** 1.5 }
}

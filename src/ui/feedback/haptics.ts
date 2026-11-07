/**
 * Short, semantic vibrations through the Web Vibration API. Most Android browsers have it; iOS
 * Safari and desktops do not, so every call is a silent no-op there and the visual and sound cues
 * carry the feel alone. The viewer can switch them off (`prefs.ts`, Players panel).
 *
 * Patterns stay short: a tick for a press, a double for a commit, a longer triple for "your turn".
 */
import { readPref } from './prefs'

export type HapticKind = 'press' | 'commit' | 'cancel' | 'turn' | 'crit'

/** Milliseconds on/off, as `navigator.vibrate` takes them. */
export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  press: 8,
  commit: [12, 40, 12],
  cancel: 20,
  turn: [30, 60, 30, 60, 60],
  crit: [40, 30, 60],
}

type VibrateNavigator = { vibrate?: (pattern: number | number[]) => boolean }

/** Whether this browser exposes the Vibration API at all (for showing the setting). */
export function hapticsSupported(nav: VibrateNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return !!nav && typeof nav.vibrate === 'function'
}

/** Vibrate for `kind` when supported and enabled. Returns whether a vibration was requested. */
export function haptic(kind: HapticKind, nav: VibrateNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator, enabled = readPref('haptics')): boolean {
  if (!enabled || !nav || typeof nav.vibrate !== 'function') return false
  try { return nav.vibrate(HAPTIC_PATTERNS[kind]) } catch { return false }
}

/**
 * Builder presence, the sending and drawing side (the table's Build layer loads it): what a
 * GM or co-GM in Build publishes, when it is cleared, and which other builders to draw. Receiving
 * and checking it is in presence.ts, which every client loads.
 */
import type { SceneId } from './ids'
import type { Vec3 } from './geometry'
import { cleanPoint, fixed, isAway, isId, MAX_BUILD_SELECTION, num, type Presence, type PresenceBuild } from './presence'

/** A builder who has not moved, turned, picked or selected anything for this long stops showing. */
export const BUILD_IDLE_MS = 30_000
/** Receivers hide a builder whose presence has been silent this long (a closed tab, a lost link). */
export const BUILD_STALE_MS = 45_000
/** The cursor goes out about ten times a second while it moves. */
export const BUILD_SEND_MS = 100

export interface BuilderState {
  scene: SceneId
  /** Floor point under the pointer, or null when it is off the board. */
  cursor: Vec3 | null
  /** The ghost in hand, or null. */
  held: { catalogue?: string | undefined; at: Vec3; yaw: number } | null
  selection: readonly string[]
}

/** The presence fields a builder sends: the cursor and the build payload, rounded and capped. */
export function encodeBuildPresence(s: BuilderState): Pick<Presence, 'cursor' | 'build'> {
  const build: PresenceBuild = { scene: s.scene }
  const at = s.held ? cleanPoint(s.held.at) : null
  if (s.held && at && num(s.held.yaw)) {
    build.held = { at, yaw: fixed(s.held.yaw, 3) }
    if (isId(s.held.catalogue)) build.held.id = s.held.catalogue
  }
  const sel = s.selection.filter(isId)
  if (sel.length) {
    build.sel = sel.slice(0, MAX_BUILD_SELECTION)
    if (sel.length > MAX_BUILD_SELECTION) build.more = sel.length - MAX_BUILD_SELECTION
  }
  const cursor = s.cursor ? cleanPoint(s.cursor) : null
  return { cursor: cursor ?? undefined, build }
}

/** Other builders working in `scene` now, by name. */
export function activeBuilders(presence: Readonly<Record<string, Presence>>, opts: { me: string; scene: SceneId; now: number }): Presence[] {
  return Object.values(presence)
    .filter((p) => p.pubkey !== opts.me && p.build?.scene === opts.scene && !isAway(p.lastSeen, opts.now, BUILD_STALE_MS))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The sending side: fed the builder's state every tick, it says what to publish. Nothing while
 * nothing changed; a clear (`cursor` and `build` undefined) once when the builder leaves Build or
 * has been idle for `BUILD_IDLE_MS`; the payload again on the next activity.
 */
export class BuildPresenceTracker {
  private lastActivity = -Infinity
  private lastKey = ''

  /** The builder did something (moved the pointer, turned the ghost, changed the selection). */
  touch(now: number): void {
    this.lastActivity = now
  }

  get showing(): boolean {
    return this.lastKey !== ''
  }

  idle(now: number): boolean {
    return now - this.lastActivity > BUILD_IDLE_MS
  }

  step(now: number, state: BuilderState | null): Pick<Presence, 'cursor' | 'build'> | null {
    if (!state || this.idle(now)) {
      if (!this.showing) return null
      this.lastKey = ''
      return { cursor: undefined, build: undefined }
    }
    const enc = encodeBuildPresence(state)
    const key = JSON.stringify(enc)
    if (key === this.lastKey) return null
    this.lastKey = key
    return enc
  }
}

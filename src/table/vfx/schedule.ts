/**
 * Pure scheduling and position resolution for VFX events. No three.js here so it stays testable.
 *
 * A `GameEvent` of kind 'vfx' carries a list of `VfxCue`s (preset + ms offset). `planEvent` turns
 * one event into a flat list of `ScheduledEffect`s with absolute fire times and resolved world
 * anchors; `splitDue` is called every frame to pop the ones whose time has come.
 */
import type { GameEvent, Token } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import type { TokenId } from '@/core/ids'
import type { VfxCue } from '@/core/pack'

export type VfxEvent = Extract<GameEvent, { kind: 'vfx' }>
export type VfxPreset = VfxCue['preset']
export type AnchorRef = NonNullable<VfxCue['from']>

/** A resolved world position: where the feet are and where the chest is. */
export interface Anchor {
  /** `token`: resolved from a token; `point`: from the event's point. Presets aim at chests of tokens, at the ground for points. */
  kind: 'token' | 'point'
  ground: Vec3
  chest: Vec3
}

export interface ScheduledEffect {
  /** Unique per instance: `${eventId}:${cueIndex}:${targetIndex}`. */
  key: string
  eventId: string
  preset: VfxPreset
  /** Absolute time (same clock as `now` passed to `planEvent`) at which the effect starts. */
  fireAt: number
  from: Anchor | null
  to: Anchor | null
  /** CSS color, cue tint or the preset default. */
  color: string
  /** Milliseconds the effect lasts (cue override or preset default). */
  duration: number
  /** World units: ring radius, aura radius. */
  radius: number
  /** 0..1, for `shake`. */
  strength: number
  cellSize: number
}

export interface PresetDefaults {
  color: string
  duration: number
  from?: AnchorRef
  to?: AnchorRef
  /** Whether the preset needs `from` (and `to`) to be resolvable; otherwise the instance is skipped. */
  needs: 'none' | 'from' | 'both'
}

export const PRESET_DEFAULTS: Record<VfxPreset, PresetDefaults> = {
  hit: { color: '#ffd27a', duration: 300, from: 'target', needs: 'from' },
  projectile: { color: '#ffb347', duration: 300, from: 'source', to: 'target', needs: 'both' },
  ring: { color: '#8ab4ff', duration: 600, from: 'target', needs: 'from' },
  aura: { color: '#7be0a0', duration: 1000, from: 'target', needs: 'from' },
  beam: { color: '#8ab4ff', duration: 300, from: 'source', to: 'target', needs: 'both' },
  shake: { color: '#ffffff', duration: 300, needs: 'none' },
  rain: { color: '#9fb8d8', duration: 2000, from: 'target', needs: 'from' },
  sound: { color: '#ffffff', duration: 0, needs: 'none' },
}

/** Default ring radius in cells when the cue says nothing. */
export const DEFAULT_RING_CELLS = 2
/** Default shake strength. */
export const DEFAULT_SHAKE_STRENGTH = 0.6
/** Chest height as a fraction of a cell (times the token's scale). */
export const CHEST_HEIGHT_CELLS = 0.5

/**
 * Returns the 'vfx' events not yet played and not older than `since`, and records them in
 * `played` so a second call with the same list yields nothing.
 */
export function takeNewEvents(events: readonly GameEvent[], since: number, played: Set<string>): VfxEvent[] {
  const fresh: VfxEvent[] = []
  for (const e of events) {
    if (e.kind !== 'vfx') continue
    if (e.at < since) continue
    if (played.has(e.id)) continue
    played.add(e.id)
    fresh.push(e)
  }
  return fresh
}

/** Forget played ids that are no longer in the doc so the set does not grow without bound. */
export function prunePlayed(events: readonly GameEvent[], played: Set<string>): void {
  const live = new Set(events.map((e) => e.id))
  for (const id of played) if (!live.has(id)) played.delete(id)
}

function tokenAnchor(token: Token | undefined, cellSize: number): Anchor | null {
  if (!token) return null
  const p = token.position
  const lift = CHEST_HEIGHT_CELLS * cellSize * (token.scale || 1)
  return { kind: 'token', ground: { x: p.x, y: p.y, z: p.z }, chest: { x: p.x, y: p.y + lift, z: p.z } }
}

function pointAnchor(point: Vec3 | undefined, cellSize: number): Anchor | null {
  if (!point) return null
  return { kind: 'point', ground: { ...point }, chest: { x: point.x, y: point.y + CHEST_HEIGHT_CELLS * cellSize, z: point.z } }
}

/** Where a projectile or beam ends: a token's chest, or just above the ground for a point. */
export function aimPoint(anchor: Anchor, cellSize: number): Vec3 {
  if (anchor.kind === 'token') return anchor.chest
  return { x: anchor.ground.x, y: anchor.ground.y + 0.05 * cellSize, z: anchor.ground.z }
}

/**
 * Resolve a cue reference to a world anchor. `target` resolves to `targetId` (or the event's
 * first target) and falls back to the event's `point`; `point` falls back to the first target.
 */
export function resolveAnchor(
  ref: AnchorRef,
  event: Pick<VfxEvent, 'targets'> & Partial<Pick<VfxEvent, 'source' | 'point'>>,
  tokens: Readonly<Record<string, Token>>,
  cellSize: number,
  targetId?: TokenId,
): Anchor | null {
  switch (ref) {
    case 'source':
      return event.source ? tokenAnchor(tokens[event.source], cellSize) : null
    case 'target': {
      const id = targetId ?? event.targets[0]
      return (id ? tokenAnchor(tokens[id], cellSize) : null) ?? pointAnchor(event.point, cellSize)
    }
    case 'point': {
      const first = event.targets[0]
      return pointAnchor(event.point, cellSize) ?? (first ? tokenAnchor(tokens[first], cellSize) : null)
    }
  }
}

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Ring radius in world units: an optional `radius` (cells) on the cue, else two cells. */
export function ringRadius(cue: VfxCue, cellSize: number): number {
  const cells = finite((cue as { radius?: unknown }).radius) ?? DEFAULT_RING_CELLS
  return Math.max(0.1, cells) * cellSize
}

/** Shake strength 0..1: an optional `strength` on the cue, else the default. */
export function shakeStrength(cue: VfxCue): number {
  const s = finite((cue as { strength?: unknown }).strength) ?? DEFAULT_SHAKE_STRENGTH
  return Math.min(1, Math.max(0, s))
}

/**
 * Expand one event into scheduled effect instances. Cues that reference `target` run once per
 * target. `sound` cues are dropped (audio plays them). Cues whose anchors cannot be resolved are
 * dropped too, so a stale token id never throws.
 */
export function planEvent(
  event: VfxEvent,
  tokens: Readonly<Record<string, Token>>,
  cellSize: number,
  now: number,
): ScheduledEffect[] {
  const out: ScheduledEffect[] = []
  const targets: (TokenId | undefined)[] = event.targets.length ? event.targets : [undefined]
  event.cues.forEach((cue, cueIndex) => {
    if (cue.preset === 'sound') return
    const def = PRESET_DEFAULTS[cue.preset]
    if (!def) return
    const fromRef = cue.from ?? def.from
    const toRef = cue.to ?? def.to
    const perTarget = fromRef === 'target' || toRef === 'target'
    const instances = perTarget ? targets : [targets[0]]
    instances.forEach((targetId, targetIndex) => {
      const from = fromRef ? resolveAnchor(fromRef, event, tokens, cellSize, targetId) : null
      const to = toRef ? resolveAnchor(toRef, event, tokens, cellSize, targetId) : null
      if (def.needs !== 'none' && !from) return
      if (def.needs === 'both' && !to) return
      const duration = finite(cue.duration)
      out.push({
        key: `${event.id}:${cueIndex}:${targetIndex}`,
        eventId: event.id,
        preset: cue.preset,
        fireAt: now + Math.max(0, finite(cue.at) ?? 0),
        from,
        to,
        color: cue.color ?? def.color,
        duration: duration !== undefined && duration > 0 ? duration : def.duration,
        radius: ringRadius(cue, cellSize),
        strength: shakeStrength(cue),
        cellSize,
      })
    })
  })
  return out.sort((a, b) => a.fireAt - b.fireAt)
}

/** Partition scheduled effects into those due at `now` and those still pending. Order is kept. */
export function splitDue<T extends { fireAt: number }>(list: readonly T[], now: number): { due: T[]; pending: T[] } {
  const due: T[] = []
  const pending: T[] = []
  for (const e of list) (e.fireAt <= now ? due : pending).push(e)
  return { due, pending }
}

/**
 * Pure planning for floating damage and heal numbers. A 'vfx' event may carry `numbers`
 * (resource deltas per token, see `ResourceDelta`); `planNumbers` turns them into timed, placed
 * specs the layer renders with `FloatingNumber`. No three.js here so it stays testable.
 */
import type { ResourceDelta, Token } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import { CHEST_HEIGHT_CELLS, type VfxEvent } from './schedule'

export interface FloatingNumberSpec {
  /** Unique per instance: `${eventId}:n:${index}`. */
  key: string
  eventId: string
  fireAt: number
  /** Where the number starts: just above the token's head. */
  position: Vec3
  delta: number
  /** Short resource tag drawn after the number (`hp`, or `crit!` / `down`). */
  resource: string
  color: string
  duration: number
  cellSize: number
  /** How loud the number is: ordinary hits stay restrained; crits and knock-downs are bigger. */
  tier: NumberTier
  /** Size relative to an ordinary number. */
  scale: number
}

/**
 * Feedback hierarchy for numbers: `normal` for every hit and heal, `down` when the hit took the
 * resource to zero, `crit` for a critical hit (the layer adds a hit-stop and a shake for these
 * alone, so the shake keeps meaning something). A crit that also downs reads as a crit.
 */
export type NumberTier = 'normal' | 'crit' | 'down'

export const DAMAGE_COLOR = '#ff5f52'
export const HEAL_COLOR = '#5fd36b'
/** Gold for criticals, a deep crimson for knock-downs; both carry a word tag too, so colour is never the only cue. */
export const CRIT_COLOR = '#ffc93c'
export const DOWN_COLOR = '#ff2e4d'
export const NUMBER_DURATION_MS = 1100
/** Crits and knock-downs linger a little longer. */
export const LOUD_NUMBER_DURATION_MS = 1500
export const TIER_SCALE: Record<NumberTier, number> = { normal: 1, down: 1.35, crit: 1.6 }

export function numberTier(n: Pick<ResourceDelta, 'delta' | 'crit' | 'down'>): NumberTier {
  if (n.delta >= 0) return 'normal'
  if (n.crit) return 'crit'
  if (n.down) return 'down'
  return 'normal'
}
/** Delay after the event so the number follows the hit flash instead of preceding it. */
export const NUMBER_DELAY_MS = 120
/** Spacing between several numbers on the same token. */
export const NUMBER_STAGGER_MS = 180

/** "-3" or "+2"; zero never reaches here. */
export function formatDelta(delta: number): string {
  const n = Math.round(Math.abs(delta))
  return `${delta < 0 ? '-' : '+'}${n}`
}

/** Last path segment of a resource key, short enough for a tag: `hp.current` -> `hp`. */
export function resourceTag(resource: string): string {
  const parts = resource.split('.')
  const tail = parts[parts.length - 1] === 'current' && parts.length > 1 ? parts[parts.length - 2]! : parts[parts.length - 1]!
  return tail.slice(0, 6).toLowerCase()
}

/**
 * One spec per delta whose token still exists. Numbers on the same token are staggered so they
 * do not overlap; the order of the event's list is kept.
 */
export function planNumbers(event: VfxEvent, tokens: Readonly<Record<string, Token>>, cellSize: number, now: number): FloatingNumberSpec[] {
  const out: FloatingNumberSpec[] = []
  const perToken = new Map<string, number>()
  ;(event.numbers ?? []).forEach((n, index) => {
    if (!Number.isFinite(n.delta) || Math.round(n.delta) === 0) return
    const t = tokens[n.token]
    if (!t) return
    const k = perToken.get(n.token) ?? 0
    perToken.set(n.token, k + 1)
    const head = (CHEST_HEIGHT_CELLS * 2 + 0.1) * cellSize * (t.scale || 1) + (t.elevation ?? 0)
    const tier = numberTier(n)
    out.push({
      key: `${event.id}:n:${index}`,
      eventId: event.id,
      fireAt: now + NUMBER_DELAY_MS + k * NUMBER_STAGGER_MS,
      position: { x: t.position.x, y: t.position.y + head, z: t.position.z },
      delta: n.delta,
      resource: tier === 'crit' ? 'crit!' : tier === 'down' ? 'down' : resourceTag(n.resource),
      color: tier === 'crit' ? CRIT_COLOR : tier === 'down' ? DOWN_COLOR : n.delta < 0 ? DAMAGE_COLOR : HEAL_COLOR,
      duration: tier === 'normal' ? NUMBER_DURATION_MS : LOUD_NUMBER_DURATION_MS,
      cellSize,
      tier,
      scale: TIER_SCALE[tier],
    })
  })
  return out.sort((a, b) => a.fireAt - b.fireAt)
}

/**
 * A cue-less 'vfx' event that only floats numbers: what the GM appends when they change a
 * resource by hand (the token bar's HP −/+), so every table shows the same number a skill would.
 * Null when every delta rounds to zero.
 */
export function numbersEvent(id: string, at: number, scene: VfxEvent['scene'], numbers: NonNullable<VfxEvent['numbers']>): VfxEvent | null {
  const kept = numbers.filter((n) => Number.isFinite(n.delta) && Math.round(n.delta) !== 0)
  if (!kept.length) return null
  return { id, at, kind: 'vfx', cues: [], scene, targets: [...new Set(kept.map((n) => n.token))], numbers: kept }
}

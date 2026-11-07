/**
 * Pure planning for floating damage and heal numbers. A 'vfx' event may carry `numbers`
 * (resource deltas per token, see `ResourceDelta`); `planNumbers` turns them into timed, placed
 * specs the layer renders with `FloatingNumber`. No three.js here so it stays testable.
 */
import type { Token } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import { CHEST_HEIGHT_CELLS, type VfxEvent } from './schedule'
import { DAMAGE, HEAL } from '@/ui/theme/palette'

export interface FloatingNumberSpec {
  /** Unique per instance: `${eventId}:n:${index}`. */
  key: string
  eventId: string
  fireAt: number
  /** Where the number starts: just above the token's head. */
  position: Vec3
  delta: number
  /** Short resource tag drawn after the number (`hp`). */
  resource: string
  color: string
  duration: number
  cellSize: number
}

export const DAMAGE_COLOR = DAMAGE
export const HEAL_COLOR = HEAL
export const NUMBER_DURATION_MS = 1100
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
    out.push({
      key: `${event.id}:n:${index}`,
      eventId: event.id,
      fireAt: now + NUMBER_DELAY_MS + k * NUMBER_STAGGER_MS,
      position: { x: t.position.x, y: t.position.y + head, z: t.position.z },
      delta: n.delta,
      resource: resourceTag(n.resource),
      color: n.delta < 0 ? DAMAGE_COLOR : HEAL_COLOR,
      duration: NUMBER_DURATION_MS,
      cellSize,
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

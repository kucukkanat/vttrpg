/**
 * Relay health and rotation, pure. The pool reports per-relay health (`RelayHealth`); the GM's
 * connection asks `planRelayRotation` every so often whether the game needs more relays and
 * which reserves to bring in. Players follow: the manifest lists the relays the GM writes to,
 * and every client adds the ones it does not know yet.
 */
import { normalizeURL } from 'nostr-tools/utils'
import type { RelayHealth } from './pool'

/**
 * Public relays tried, in order, when too few of a game's relays work. They carry the same
 * kinds as the defaults (30078 replaceable, 1078 regular, 21078/21079 ephemeral).
 */
export const RESERVE_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.nostr.net',
  'wss://offchain.pub',
  'wss://nostr.oxtr.dev',
]

/** Below this many healthy relays the GM brings in reserves. */
export const MIN_HEALTHY_RELAYS = 3
/** A game never grows past this many relays through rotation. */
export const MAX_GAME_RELAYS = 8
/** Refused publishes in a row after which an open relay no longer counts as healthy. */
export const REJECT_STREAK_UNHEALTHY = 3

export type RelayGrade = 'good' | 'refusing' | 'connecting' | 'down'

/** One word per relay for the status list. */
export function gradeRelay(h: RelayHealth): RelayGrade {
  if (h.state === 'open') return h.rejectStreak >= REJECT_STREAK_UNHEALTHY ? 'refusing' : 'good'
  return h.state === 'down' ? 'down' : 'connecting'
}

export const isHealthy = (h: RelayHealth) => gradeRelay(h) === 'good'

export interface RotationInput {
  health: RelayHealth[]
  /** Relays the game uses now (any spelling; compared normalized). */
  current: string[]
  reserves?: string[]
  minHealthy?: number
  maxRelays?: number
}

/**
 * Which reserves to add so that, once they connect, at least `minHealthy` relays could be
 * healthy. Relays still connecting for the first time count as maybe-healthy, so a cold start
 * does not pull in every reserve at once. Never adds a relay already in use, and never grows the
 * game past `maxRelays`.
 */
export function planRelayRotation(input: RotationInput): string[] {
  const min = input.minHealthy ?? MIN_HEALTHY_RELAYS
  const max = input.maxRelays ?? MAX_GAME_RELAYS
  const norm = (u: string) => {
    try {
      return normalizeURL(u)
    } catch {
      return u
    }
  }
  const current = new Set(input.current.map(norm))
  const byUrl = new Map(input.health.map((h) => [norm(h.url), h]))
  let hopeful = 0
  for (const url of current) {
    const h = byUrl.get(url)
    if (!h) {
      hopeful++
      continue
    }
    if (isHealthy(h) || (h.state === 'connecting' && h.failures === 0) || h.state === 'idle') hopeful++
  }
  const room = max - current.size
  const want = Math.min(Math.max(0, min - hopeful), Math.max(0, room))
  if (want === 0) return []
  const out: string[] = []
  for (const r of input.reserves ?? RESERVE_RELAYS) {
    const url = norm(r)
    if (current.has(url) || out.includes(url)) continue
    out.push(url)
    if (out.length >= want) break
  }
  return out
}

/** Relays in `next` that are not in `known` (normalized), keeping `next`'s order, capped at `max` in total. */
export function relaysToAdd(known: string[], next: string[], max = MAX_GAME_RELAYS + 2): string[] {
  const norm = (u: string) => {
    try {
      return normalizeURL(u)
    } catch {
      return ''
    }
  }
  const have = new Set(known.map(norm))
  const out: string[] = []
  for (const r of next) {
    if (typeof r !== 'string' || !/^wss?:\/\//i.test(r)) continue
    const url = norm(r)
    if (!url || have.has(url)) continue
    if (have.size >= max) break
    have.add(url)
    out.push(url)
  }
  return out
}

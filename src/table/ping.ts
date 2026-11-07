/**
 * Ping rules, pure so they can be tested without a canvas. A ping is `presence.ping`: it rides on
 * the next presence publish (ephemeral, encrypted, never stored) and every client plays each
 * distinct one once. See PingLayer for the gestures and the drawing.
 */
import type { PlayerPubkey } from '@/core/ids'
import type { Presence, PresencePing } from '@/core/presence'

/** A ping to draw: where, in which colour, and who sent it. */
export interface PingEvent extends PresencePing {
  pubkey: PlayerPubkey
  name: string
}

/** How long the ring plays. */
export const PING_DURATION_MS = 2000
/** How long the pinger's name stays over the spot. */
export const PING_LABEL_MS = 1500
/**
 * A ping older than this on arrival is not played: the sender's beacons keep carrying it for a
 * moment, and a client that joins then should not see a ring from the past.
 */
export const PING_MAX_AGE_MS = 15_000
/** The sender drops the ping from its presence this long after sending it. */
export const PING_CLEAR_MS = 3000
/** Two taps this close in time and on screen are a double tap. */
export const DOUBLE_TAP_MS = 400
export const DOUBLE_TAP_PX = 24
/** A steady touch this long on empty floor pings. */
export const LONG_PRESS_MS = 500
/** A touch that moves this far is a drag, not a press. */
export const PRESS_SLOP_PX = 10

/**
 * The ping in `p` when it is new for that sender (by `at`) and fresh; null otherwise. Records what
 * it saw in `seen` (pubkey -> last `at`) so the same ping arriving on later beacons is ignored.
 * Falls back to the presence colour when the ping carries none.
 */
export function takePing(seen: Map<string, number>, p: Presence, now = Date.now()): PingEvent | null {
  const ping = p.ping
  if (!ping) return null
  if (ping.at <= (seen.get(p.pubkey) ?? 0)) return null
  seen.set(p.pubkey, ping.at)
  if (now - ping.at > PING_MAX_AGE_MS) return null
  return { ...ping, color: ping.color || p.color, pubkey: p.pubkey, name: p.name }
}

type PingSender = (p: { x: number; z: number }) => void
let pingSender: PingSender | null = null

/** The mounted PingLayer registers how it sends; returns the unregister function. */
export function setPingSender(send: PingSender): () => void {
  pingSender = send
  return () => { if (pingSender === send) pingSender = null }
}

/** Ping a floor spot for everyone from outside the canvas (the token menu's Ping). False when no table is mounted. */
export function pingAt(x: number, z: number): boolean {
  if (!pingSender) return false
  pingSender({ x, z })
  return true
}

/** A tap on screen: client pixels and a local clock in ms. */
export interface Tap { x: number; y: number; at: number }

/** True when `next` lands within DOUBLE_TAP_MS and DOUBLE_TAP_PX of `prev`. */
export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev) return false
  return next.at - prev.at <= DOUBLE_TAP_MS && Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_PX
}

/**
 * Who may write the game, pure. The founder (the manifest's author, pinned by the invite's
 * naddr) is the root of trust and can never be replaced. In their signed manifest they may list
 * co-GMs, each with a validity window, and name a `host`: the writer who should process player
 * intents first. Every client derives the same answers from the same manifest. See
 * ARCHITECTURE.md, "Co-GM and handover".
 */
import type { PlayerPubkey } from '@/core/ids'
import type { CoGmGrant, Manifest } from './codec'

/**
 * Seconds a co-GM's grant reaches back before the founder's clock at grant time, so a co-GM
 * whose clock runs a little behind is not refused for their first edits.
 */
export const GRANT_SKEW_S = 120

/** How long a writer that just opened listens to presence before it processes intents (multi-writer games only). */
export const PROCESS_GRACE_MS = 12_000

export interface Authority {
  founder: PlayerPubkey
  /** Every grant ever made, revoked ones included (their window still covers what they wrote). */
  grants: CoGmGrant[]
  /** Preferred intent processor; the founder when unset or no longer a writer. */
  host: PlayerPubkey
}

const HEX64 = /^[0-9a-f]{64}$/

/** Keeps only well-formed grants: hex pubkey, numeric since, optional numeric until, never the founder, one per pubkey (last wins). */
export function sanitizeGrants(raw: unknown, founder: string): CoGmGrant[] {
  if (!Array.isArray(raw)) return []
  const byKey = new Map<string, CoGmGrant>()
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue
    const { pubkey, since, until } = g as Record<string, unknown>
    if (typeof pubkey !== 'string' || !HEX64.test(pubkey) || pubkey === founder) continue
    if (typeof since !== 'number' || !Number.isFinite(since)) continue
    if (until !== undefined && (typeof until !== 'number' || !Number.isFinite(until) || until < since)) continue
    byKey.set(pubkey, until === undefined ? { pubkey: pubkey as PlayerPubkey, since } : { pubkey: pubkey as PlayerPubkey, since, until })
  }
  return [...byKey.values()]
}

export function authorityOf(m: Pick<Manifest, 'gm' | 'coGms' | 'host'>): Authority {
  const grants = sanitizeGrants(m.coGms, m.gm)
  const host = m.host && (m.host === m.gm || grants.some((g) => g.pubkey === m.host && g.until === undefined)) ? m.host : m.gm
  return { founder: m.gm, grants, host }
}

/** A co-GM right now: granted and not revoked. */
export function isActiveCoGm(a: Authority, pubkey: string): boolean {
  return a.grants.some((g) => g.pubkey === pubkey && g.until === undefined)
}

/** Founder or an active co-GM. */
export function isWriter(a: Authority, pubkey: string): boolean {
  return pubkey === a.founder || isActiveCoGm(a, pubkey)
}

/** Was `pubkey` allowed to write a delta stamped `createdAt` (unix seconds)? */
export function canWriteAt(a: Authority, pubkey: string, createdAt: number): boolean {
  if (pubkey === a.founder) return true
  const g = a.grants.find((x) => x.pubkey === pubkey)
  if (!g) return false
  return createdAt >= g.since - GRANT_SKEW_S && (g.until === undefined || createdAt <= g.until)
}

/** Every pubkey whose deltas can matter (for the relay `authors` filter). */
export function deltaAuthors(a: Authority): PlayerPubkey[] {
  return [a.founder, ...a.grants.map((g) => g.pubkey)]
}

/** Who processes intents first: the host, then the founder, then active co-GMs in grant order. */
export function processorOrder(a: Authority): PlayerPubkey[] {
  const out: PlayerPubkey[] = [a.host]
  if (!out.includes(a.founder)) out.push(a.founder)
  for (const g of a.grants) if (g.until === undefined && !out.includes(g.pubkey)) out.push(g.pubkey)
  return out
}

// --- founder edits -----------------------------------------------------------------------------

/** Adds (or re-activates) a co-GM. Refuses the founder and malformed keys. */
export function grantCoGm(m: Manifest, pubkey: string, nowSec: number): Manifest {
  if (!HEX64.test(pubkey)) throw new Error('net: a co-GM must be a hex pubkey')
  if (pubkey === m.gm) throw new Error('net: the founder is already the GM')
  const grants = sanitizeGrants(m.coGms, m.gm).filter((g) => g.pubkey !== pubkey)
  return { ...m, coGms: [...grants, { pubkey: pubkey as PlayerPubkey, since: nowSec }] }
}

/** Ends a co-GM's window now; a host who loses the grant hands hosting back to the founder. */
export function revokeCoGm(m: Manifest, pubkey: string, nowSec: number): Manifest {
  const grants = sanitizeGrants(m.coGms, m.gm).map((g) => (g.pubkey === pubkey && g.until === undefined ? { ...g, until: Math.max(g.since, nowSec) } : g))
  const next: Manifest = { ...m, coGms: grants }
  if (next.host === pubkey) delete next.host
  return next
}

/** Names the preferred intent processor: the founder (clears it) or an active co-GM. */
export function setHost(m: Manifest, pubkey: string | undefined): Manifest {
  const next: Manifest = { ...m }
  if (!pubkey || pubkey === m.gm) {
    delete next.host
    return next
  }
  if (!isActiveCoGm(authorityOf(m), pubkey)) throw new Error('net: only an active co-GM can host')
  next.host = pubkey as PlayerPubkey
  return next
}

/**
 * Tells the local player what just happened to them. `diffNotices` is a pure function over two
 * snapshots of the game state; `useGameNotices` runs it on every store change and turns each
 * notice into a toast (ui/toasts.ts) plus a local-only system line in Chat (store `notices`).
 * Nothing here reaches the shared document or the network.
 *
 *   - a token became mine while I owned none      "You are Pip"             + frame the camera on it
 *   - another token became mine                   "GM gave you Rat Guard"
 *   - a token I owned was deleted                 "GM removed Pip"
 *   - a token I owned went to someone else        "Pip is no longer yours"
 *   - a note became visible to me                 "New handout · Map"       + Open (Journal panel)
 *   - the GM's presence went stale for 15 s       "GM is away" / "GM is back"
 *
 * The GM gets none of these: every one of them is something the GM did.
 */
import { useEffect } from 'react'
import type { Note, Token } from '@/core/doc'
import type { NoteId, PlayerPubkey, TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import { focusToken } from '@/table/tableState'
import type { GameController } from './controller'
import { pushToast } from './toasts'

/** GM presence older than this counts as away. The beacon fires every 10 s. */
export const GM_AWAY_AFTER_MS = 15_000
/** How often the hook re-checks presence age without any store change. */
export const GM_AWAY_TICK_MS = 5_000

export interface NoticeSnapshot {
  /** False until the document has arrived; the first loaded snapshot is a baseline, not a change. */
  loaded: boolean
  tokens: Record<TokenId, Token>
  notes: Record<NoteId, Note>
  /** GM presence stale; null while the GM has never been seen. */
  gmAway: boolean | null
}

export interface NoticeContext {
  me: PlayerPubkey
  isGm: boolean
}

export type Notice =
  | { kind: 'claimed'; token: TokenId; text: string }
  | { kind: 'given'; token: TokenId; text: string }
  | { kind: 'removed'; token: TokenId; text: string }
  | { kind: 'handout'; note: NoteId; text: string }
  | { kind: 'gm-away'; text: string }
  | { kind: 'gm-back'; text: string }

/** Same rule as the Journal panel: 'all', or an explicit list naming me. (The GM sees all.) */
export function noteVisible(note: Note, me: PlayerPubkey, isGm: boolean): boolean {
  if (isGm) return true
  if (note.sharedWith === 'all') return true
  return Array.isArray(note.sharedWith) && note.sharedWith.includes(me)
}

/** Everything that changed for `ctx.me` between `prev` and `next`, in a stable order. */
export function diffNotices(prev: NoticeSnapshot, next: NoticeSnapshot, ctx: NoticeContext): Notice[] {
  if (ctx.isGm) return []
  // The document arriving is not a stream of events that happened to me.
  if (!prev.loaded || !next.loaded) return []
  const out: Notice[] = []
  const { me } = ctx

  const ownedBefore = Object.values(prev.tokens).filter((t) => t.owner === me)
  let hadOne = ownedBefore.length > 0
  for (const t of Object.values(next.tokens)) {
    if (t.owner !== me) continue
    const was = prev.tokens[t.id]
    if (was?.owner === me) continue
    if (was && !was.owner && !hadOne) {
      out.push({ kind: 'claimed', token: t.id, text: `You are ${t.name}` })
      hadOne = true
    } else {
      out.push({ kind: 'given', token: t.id, text: `GM gave you ${t.name}` })
    }
  }
  for (const t of ownedBefore) {
    const now = next.tokens[t.id]
    if (!now) out.push({ kind: 'removed', token: t.id, text: `GM removed ${t.name}` })
    else if (now.owner !== me) out.push({ kind: 'removed', token: t.id, text: `${t.name} is no longer yours` })
  }

  for (const n of Object.values(next.notes)) {
    if (!noteVisible(n, me, false)) continue
    const was = prev.notes[n.id]
    if (was && noteVisible(was, me, false)) continue
    out.push({ kind: 'handout', note: n.id, text: `New handout · ${n.title || 'Untitled'}` })
  }

  if (prev.gmAway !== null && next.gmAway !== null && prev.gmAway !== next.gmAway) {
    out.push(next.gmAway ? { kind: 'gm-away', text: 'GM is away' } : { kind: 'gm-back', text: 'GM is back' })
  }
  return out
}

/** Snapshot of the store for the diff; `now` decides whether the GM counts as away. */
export function snapshotFor(gm: PlayerPubkey, now: number): NoticeSnapshot {
  const s = useGame.getState()
  const seen = s.presence[gm]?.lastSeen
  return {
    loaded: s.meta !== null,
    tokens: s.tokens,
    notes: s.notes,
    gmAway: seen === undefined ? null : now - seen > GM_AWAY_AFTER_MS,
  }
}

export interface GameNoticesOptions {
  /** Opens a panel by id ('journal' for handouts); the shell passes its `openPanel`. */
  onOpenPanel?(id: string): void
}

/**
 * Watches the store on behalf of `controller.pubkey` and surfaces each notice as a toast and a
 * local chat line. Mount once per game screen (see shell/GameNotices.tsx).
 */
export function useGameNotices(controller: GameController, opts: GameNoticesOptions = {}): void {
  const me = controller.pubkey
  const gm = controller.connection.gm
  const isGm = controller.connection.isGm
  const onOpenPanel = opts.onOpenPanel
  useEffect(() => {
    if (isGm) return
    let prev = snapshotFor(gm, Date.now())
    const check = () => {
      const now = Date.now()
      const next = snapshotFor(gm, now)
      const notices = diffNotices(prev, next, { me, isGm })
      prev = next
      for (const n of notices) deliver(n, now, onOpenPanel)
    }
    const unsubscribe = useGame.subscribe(check)
    const tick = setInterval(check, GM_AWAY_TICK_MS)
    return () => { unsubscribe(); clearInterval(tick) }
  }, [me, gm, isGm, onOpenPanel])
}

function deliver(n: Notice, at: number, onOpenPanel?: (id: string) => void): void {
  useGame.getState().pushNotice(n.text, at)
  switch (n.kind) {
    case 'claimed':
      useGame.getState().setSelectedToken(n.token)
      focusToken(n.token)
      pushToast({ text: n.text, key: `token:${n.token}` })
      break
    case 'given':
    case 'removed':
      pushToast({ text: n.text, key: `token:${n.token}` })
      break
    case 'handout':
      pushToast({ text: n.text, ttl: 8000, key: `note:${n.note}`, action: onOpenPanel ? { label: 'Open', run: () => onOpenPanel('journal') } : undefined })
      break
    case 'gm-away':
      pushToast({ text: n.text, ttl: 0, key: 'gm-presence' })
      break
    case 'gm-back':
      pushToast({ text: n.text, key: 'gm-presence' })
      break
  }
}

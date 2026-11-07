/**
 * "Pick your mouse": a bottom sheet for players who own no token in the active scene. Lists the
 * unowned tokens that have a character sheet with a big "Play as" button each, plus "Just watch".
 * Claiming dispatches `token.claim`; the sheet stays up (with a pending state) until the GM's
 * delta makes the token ours. The Players panel reopens it later ("Pick a character").
 *
 * `PresenceBeacon` announces this client to the others on join and every few seconds; without it
 * presence only went out while dragging a token, so a fresh player never showed up in anyone's
 * Players panel until they owned something.
 */
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import type { Character, Token } from '@/core/doc'
import type { AttributeDef } from '@/core/pack'
import type { TokenId } from '@/core/ids'

interface ClaimPromptState {
  /** Opened on purpose (Players panel); shown regardless of `dismissed`. */
  open: boolean
  /** "Just watch" was tapped this session: the automatic prompt stays away. */
  dismissed: boolean
  show(): void
  hide(): void
  dismiss(): void
}

export const useClaimPrompt = create<ClaimPromptState>((set) => ({
  open: false,
  dismissed: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  dismiss: () => set({ open: false, dismissed: true }),
}))

/** How long a claim may go unanswered before the sheet offers to try again. */
export const CLAIM_TIMEOUT_MS = 8000
/** Presence re-announce period. */
export const PRESENCE_BEACON_MS = 10_000

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

/** Number or `{ current, max }` resource, as text; null when the sheet has nothing usable there. */
function statText(v: unknown): string | null {
  if (typeof v === 'number') return String(v)
  if (v && typeof v === 'object') {
    const r = v as { current?: unknown; max?: unknown }
    if (typeof r.current === 'number') return typeof r.max === 'number' && r.max !== r.current ? `${r.current}/${r.max}` : String(r.current)
    if (typeof r.max === 'number') return String(r.max)
  }
  return null
}

/** One cheap line about a sheet: background (if a string) and the pack's attributes. */
export function sheetSummary(character: Character, attributes: readonly AttributeDef[]): string {
  const parts: string[] = []
  const d = character.data ?? {}
  const bg = d.background
  if (typeof bg === 'string' && bg.trim()) parts.push(bg.trim())
  const stats = attributes
    .map((a) => {
      const t = statText(d[a.id])
      return t ? `${(a.abbr ?? a.name).toUpperCase()} ${t}` : null
    })
    .filter((s): s is string => s !== null)
  if (stats.length) parts.push(stats.join(' · '))
  const hp = statText(d.hp)
  if (hp) parts.push(`HP ${hp}`)
  return parts.join(' — ')
}

const css = `
.claim-sheet { position: absolute; left: 0; right: 0; bottom: 0; z-index: 6; max-height: 85%; display: flex; flex-direction: column;
  background: var(--panel); border-top: 1px solid var(--border); border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: var(--shadow-lg); padding: var(--sp-3) calc(var(--sp-4) + var(--sar)) calc(var(--sp-4) + var(--sab)) calc(var(--sp-4) + var(--sal));
  animation: claim-in .25s ease; }
.claim-sheet .grip { align-self: center; width: 36px; height: 4px; border-radius: 2px; background: var(--border); margin-bottom: var(--sp-2); }
.claim-sheet h2 { margin: 0 0 2px; font-size: var(--fs-xl); }
.claim-sheet .lead { color: var(--muted); margin: 0 0 var(--sp-3); }
.claim-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); overflow: auto; min-height: 0; -webkit-overflow-scrolling: touch; }
.claim-row { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2); border: 1px solid var(--border); border-radius: var(--r-md); background: var(--panel-2); }
.claim-avatar { flex: none; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; color: #111; font-size: var(--fs-lg); }
.claim-text { flex: 1; min-width: 0; display: grid; gap: 2px; }
.claim-name { font-weight: 600; font-size: var(--fs-lg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.claim-sum { color: var(--muted); font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.claim-row > button { flex: none; min-height: 48px; min-width: 104px; font-size: var(--fs-lg); border-radius: var(--r-md); }
.claim-foot { display: flex; gap: var(--sp-2); margin-top: var(--sp-3); flex-wrap: wrap; }
.claim-foot button { flex: 1 1 140px; min-height: 48px; font-size: var(--fs-lg); border-radius: var(--r-md); }
.claim-note { color: var(--accent); margin: var(--sp-2) 0 0; }
@keyframes claim-in { from { transform: translateY(24px); opacity: 0; } }
@media (min-width: 700px) { .claim-sheet { left: 50%; right: auto; width: min(520px, calc(100% - 32px)); transform: translateX(-50%); border: 1px solid var(--border); border-radius: var(--r-lg); bottom: var(--sp-4); } }
@media (prefers-reduced-motion: reduce) { .claim-sheet { animation: none; } }
`

export function ClaimPrompt({ controller }: { controller: GameController }) {
  const isGm = controller.connection.isGm
  const me = controller.pubkey
  const meta = useGame((s) => s.meta)
  const tokens = useGame((s) => s.tokens)
  const characters = useGame((s) => s.characters)
  const select = useGame((s) => s.setSelectedToken)
  const { open, dismissed, hide, dismiss } = useClaimPrompt()
  const [pending, setPending] = useState<TokenId | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const scene = meta?.activeScene ?? null
  const inScene = useMemo(() => Object.values(tokens).filter((t) => t.scene === scene), [tokens, scene])
  const mine = useMemo(() => inScene.filter((t) => t.owner === me), [inScene, me])
  const candidates = useMemo(
    () => inScene.filter((t) => !t.owner && !t.hidden && t.character && characters[t.character]).sort((a, b) => a.name.localeCompare(b.name)),
    [inScene, characters],
  )
  const attributes = controller.rules?.pack.attributes ?? []

  // The claim went through (the GM's delta made the token ours) or someone else got there first.
  useEffect(() => {
    if (!pending) return
    const t = tokens[pending]
    if (!t) { setPending(null); setNote('That token is gone.'); return }
    if (t.owner === me) {
      setPending(null); setNote(null)
      select(pending)
      hide()
    } else if (t.owner) {
      setPending(null); setNote(`${t.name} was taken by someone else. Pick another.`)
    }
  }, [pending, tokens, me, select, hide])
  useEffect(() => {
    if (!pending) return
    const id = setTimeout(() => {
      setPending(null)
      setNote('No answer from the GM yet. Is the GM online? Try again.')
    }, CLAIM_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [pending])

  if (isGm || !scene) return null
  const automatic = !dismissed && mine.length === 0 && candidates.length > 0
  if (!open && !automatic) return null

  const claim = (t: Token) => {
    setNote(null)
    setPending(t.id as TokenId)
    void controller.dispatch({ type: 'token.claim', token: t.id as TokenId })
  }

  return (
    <div className="claim-sheet" role="dialog" aria-modal="false" aria-labelledby="claim-title">
      <style>{css}</style>
      <span className="grip" aria-hidden />
      <h2 id="claim-title">{mine.length ? 'Pick a character' : 'Who are you playing?'}</h2>
      <p className="lead">
        {mine.length
          ? `You are playing ${mine.map((t) => t.name).join(', ')}.${candidates.length ? ' You can also take:' : ''}`
          : candidates.length
            ? 'These characters are free. Tap one to play it; you can change later from the Players panel.'
            : 'No free characters in this scene right now. The GM can assign you one from the Tokens panel.'}
      </p>
      <ul className="claim-list">
        {candidates.map((t) => {
          const c = characters[t.character!]!
          const summary = sheetSummary(c, attributes)
          const busy = pending === t.id
          return (
            <li key={t.id} className="claim-row">
              <span className="claim-avatar" style={{ background: t.color }} aria-hidden>{initials(c.name || t.name)}</span>
              <span className="claim-text">
                <span className="claim-name">{t.name}{c.name && c.name !== t.name ? <span className="muted small"> · {c.name}</span> : null}</span>
                {summary && <span className="claim-sum" title={summary}>{summary}</span>}
              </span>
              <button type="button" className="primary" disabled={pending !== null} onClick={() => claim(t)} aria-label={`Play as ${t.name}`}>
                {busy ? 'Claiming…' : 'Play as'}
              </button>
            </li>
          )
        })}
      </ul>
      {note && <p className="claim-note" role="status">{note}</p>}
      <div className="claim-foot">
        {open ? (
          <button type="button" onClick={hide}>Close</button>
        ) : (
          <button type="button" onClick={dismiss}>Just watch</button>
        )}
      </div>
    </div>
  )
}

/** Announces this client's presence on mount, when the active scene changes, and every few seconds. */
export function PresenceBeacon({ controller }: { controller: GameController }) {
  const scene = useGame((s) => s.meta?.activeScene ?? null)
  useEffect(() => {
    controller.presence({ scene })
    const id = setInterval(() => controller.presence({}), PRESENCE_BEACON_MS)
    return () => clearInterval(id)
  }, [controller, scene])
  return null
}

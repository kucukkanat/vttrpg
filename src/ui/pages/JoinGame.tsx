import { useCallback, useEffect, useRef, useState } from 'react'
import { Shell } from '../components'
import { navigate } from '../router'
import { useSession } from '../session'
import { startGame } from '../bootstrap'
import { games } from '../games'
import { currentProfile, parseInvite, DEFAULT_RELAYS, type InviteInfo } from '@/net'
import { BUILTIN_PACKS } from '@/rules'
import { describeRelays, previewGame, type GamePreview } from '../invite'
import { Reconnecting, useRejoin } from './Games'

const touch = { minHeight: 48, padding: '10px 18px', fontSize: 15 } as const

/** What the join is doing, by elapsed time; the manifest lookup alone can take two relay rounds. */
function joinProgress(seconds: number): string {
  if (seconds < 3) return 'Connecting to the relays…'
  if (seconds < 25) return 'Looking up the game on the relays…'
  if (seconds < 45) return 'Still looking; public relays can be slow on a cold start…'
  return 'Loading the game state…'
}

type Preview =
  | { state: 'loading' }
  | { state: 'ready'; game: GamePreview }
  | { state: 'error'; message: string }

/** Looks the game up on its relays as soon as the page opens; `retry` runs it again. */
function useGamePreview(info: InviteInfo | null, knownName: string | undefined, enabled: boolean): { preview: Preview; retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const [preview, setPreview] = useState<Preview>(() => (knownName ? { state: 'ready', game: { name: knownName, gm: info?.gm ?? '' } } : { state: 'loading' }))
  useEffect(() => {
    if (!info || !enabled) return
    const ctrl = new AbortController()
    if (!knownName || attempt > 0) setPreview({ state: 'loading' })
    const relays = info.relays.length ? info.relays : DEFAULT_RELAYS
    previewGame(info, relays, { signal: ctrl.signal })
      .then((game) => { if (!ctrl.signal.aborted) setPreview({ state: 'ready', game }) })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        // A device that has seen the game keeps showing the saved name instead of an error.
        if (knownName) { setPreview({ state: 'ready', game: { name: knownName, gm: info.gm } }); return }
        setPreview({ state: 'error', message: e instanceof Error ? e.message : String(e) })
      })
    return () => ctrl.abort()
  }, [info, knownName, attempt, enabled])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { preview, retry }
}

function packName(id: string | undefined): string | undefined {
  if (!id) return undefined
  return BUILTIN_PACKS.find((p) => p.id === id)?.name ?? id
}

export function JoinGame({ invite }: { invite: string }) {
  const { setController } = useSession()
  // parseInvite is pure; memoize on the string so effects keyed on `info` do not rerun every render.
  const [info] = useState(() => parseInvite(invite))
  const profile = currentProfile()
  const [displayName, setDisplayName] = useState(profile ?? 'Player')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const { rejoin, busyId, error: rejoinError } = useRejoin()

  // A link for a game this device already knows: rejoin with the saved role instead of joining fresh.
  // The registry is shared between dev profiles, so a profile tab never trusts it and always joins fresh.
  const known = info && !profile ? games.get(info.gameId) : undefined
  // Any registry entry is good enough for the name and ruleset, even under a dev profile.
  const seen = info ? games.get(info.gameId) : undefined
  const system = packName(seen?.pack)
  const [autoRejoin, setAutoRejoin] = useState(!!known)
  // While an automatic rejoin is running it already talks to the relays; look the game up only otherwise.
  const { preview, retry } = useGamePreview(info, seen?.name || undefined, !(known && autoRejoin))
  const started = useRef(false)
  const cancelled = useRef(false)
  useEffect(() => {
    if (!known || !autoRejoin || started.current) return
    started.current = true
    cancelled.current = false
    void rejoin(known.gameId, () => cancelled.current).then((ok) => {
      if (!ok) setAutoRejoin(false)
    })
  }, [known, autoRejoin, rejoin])

  useEffect(() => {
    if (!busy) return
    setElapsed(0)
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [busy])

  async function join() {
    const name = displayName.trim()
    if (!name) { setError('Pick a name first.'); return }
    setBusy(true); setError(null)
    // A profile tab shares the device registry with the default identity (typically the GM):
    // joining overwrites that game's entry, so put the previous one back afterwards.
    const previous = profile && info ? games.get(info.gameId) : undefined
    try {
      const c = await startGame({ mode: 'join', invite, displayName: name })
      if (previous) games.remember(previous)
      setController(c)
      navigate('/game')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  if (known && autoRejoin) {
    return (
      <Shell title="Join game">
        <Reconnecting game={known} onCancel={() => { cancelled.current = true; setAutoRejoin(false) }} />
      </Shell>
    )
  }

  if (!info) {
    return (
      <Shell title="Join game">
        <p className="error">This is not a valid invite link. Ask the GM to copy it again from the table.</p>
        <div className="row">
          <button style={touch} onClick={() => navigate('/')}>Back</button>
        </div>
      </Shell>
    )
  }

  const relays = info.relays.length ? info.relays : DEFAULT_RELAYS
  return (
    <Shell title="Join game">
      <GameHeading preview={preview} system={system} relays={relays} onRetry={retry} />
      {profile && <p className="muted small">Dev profile <strong>{profile}</strong>: this tab uses its own identity.</p>}
      {known && rejoinError && <p className="muted">You have opened this game before, but rejoining failed: {rejoinError}</p>}
      <label>
        Your name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" disabled={busy} style={{ minHeight: 48, fontSize: 16 }} />
        <span className="muted small">Shown to the GM and the other players.</span>
      </label>
      {error && (
        <div role="alert">
          <p className="error">Could not join: {error}</p>
          <p className="muted small">Check your connection; the GM needs to be online for a first join.</p>
        </div>
      )}
      {busy && (
        <p className="muted small" role="status" aria-live="polite">
          {joinProgress(elapsed)} {elapsed >= 5 ? `(${elapsed}s)` : ''}
        </p>
      )}
      <div className="row">
        <button className="primary" style={touch} disabled={busy || busyId !== null} onClick={join}>{busy ? 'Joining…' : error ? 'Try again' : 'Join'}</button>
        {known && <button style={touch} disabled={busy || busyId !== null} onClick={() => { started.current = false; setAutoRejoin(true) }}>Rejoin as {known.isGm ? 'GM' : 'player'}</button>}
        <button style={touch} onClick={() => navigate('/')}>Back</button>
      </div>
    </Shell>
  )
}

/** "You're joining Audit table (Mausritter)", or what stands in for it while the relays answer. */
function GameHeading({ preview, system, relays, onRetry }: { preview: Preview; system: string | undefined; relays: string[]; onRetry: () => void }) {
  if (preview.state === 'loading') {
    return (
      <p className="muted" role="status" aria-live="polite">
        <Spinner /> Looking up the game on {describeRelays(relays)}…
      </p>
    )
  }
  if (preview.state === 'error') {
    return (
      <div role="alert" style={{ marginBottom: 12 }}>
        <p className="error">Could not find this game on {describeRelays(relays)}.</p>
        <p className="muted small">The GM may be offline, or the relays are slow. You can still try to join.</p>
        <button type="button" style={touch} onClick={onRetry}>Retry</button>
      </div>
    )
  }
  const name = preview.game.name.trim()
  return (
    <p style={{ fontSize: 16 }}>
      You're joining <strong>{name || 'an unnamed game'}</strong>{system ? <span className="muted"> ({system})</span> : null}
    </p>
  )
}

function Spinner() {
  return (
    <>
      <span aria-hidden style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', marginRight: 8, verticalAlign: '-1px', animation: 'spin 1s linear infinite' }} />
      <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Shell } from '../components'
import { navigate } from '../router'
import { useSession } from '../session'
import { startGame } from '../bootstrap'
import { games } from '../games'
import { currentProfile, parseInvite } from '@/net'
import { Reconnecting, useRejoin } from './Games'

const touch = { minHeight: 48, padding: '10px 18px', fontSize: 15 } as const

/** What the join is doing, by elapsed time; the manifest lookup alone can take two relay rounds. */
function joinProgress(seconds: number): string {
  if (seconds < 3) return 'Connecting to the relays…'
  if (seconds < 25) return 'Looking up the game on the relays…'
  if (seconds < 45) return 'Still looking; public relays can be slow on a cold start…'
  return 'Loading the game state…'
}

export function JoinGame({ invite }: { invite: string }) {
  const { setController } = useSession()
  const info = parseInvite(invite)
  const profile = currentProfile()
  const [displayName, setDisplayName] = useState(profile ?? 'Player')
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const { rejoin, busyId, error: rejoinError } = useRejoin()

  // A link for a game this device already knows: rejoin with the saved role instead of joining fresh.
  // The registry is shared between dev profiles, so a profile tab never trusts it and always joins fresh.
  const known = info && !profile ? games.get(info.gameId) : undefined
  const [autoRejoin, setAutoRejoin] = useState(!!known)
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

  return (
    <Shell title="Join game">
      {!info && <p className="error">This is not a valid invite link. Ask the GM to copy it again from the table.</p>}
      {profile && <p className="muted small">Dev profile <strong>{profile}</strong>: this tab uses its own identity.</p>}
      {known && <p className="muted">You have opened <strong>{known.name || 'this game'}</strong> before{rejoinError ? `, but rejoining failed: ${rejoinError}` : ''}.</p>}
      <label>Your name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" disabled={busy} style={{ minHeight: 48, fontSize: 16 }} /></label>
      {error && <p className="error">{error}</p>}
      {busy && (
        <p className="muted small" role="status" aria-live="polite">
          {joinProgress(elapsed)} {elapsed >= 5 ? `(${elapsed}s)` : ''}
        </p>
      )}
      <div className="row">
        <button className="primary" style={touch} disabled={busy || busyId !== null || !info} onClick={join}>{busy ? 'Joining…' : 'Join'}</button>
        {known && <button style={touch} disabled={busy || busyId !== null} onClick={() => { started.current = false; setAutoRejoin(true) }}>Rejoin as {known.isGm ? 'GM' : 'player'}</button>}
        <button style={touch} onClick={() => navigate('/')}>Back</button>
      </div>
    </Shell>
  )
}

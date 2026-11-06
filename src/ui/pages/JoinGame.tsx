import { useEffect, useRef, useState } from 'react'
import { Shell } from '../components'
import { navigate } from '../router'
import { useSession } from '../session'
import { startGame } from '../bootstrap'
import { games } from '../games'
import { parseInvite } from '@/net'
import { Reconnecting, useRejoin } from './Games'

const touch = { minHeight: 48, padding: '10px 18px', fontSize: 15 } as const

export function JoinGame({ invite }: { invite: string }) {
  const { setController } = useSession()
  const [displayName, setDisplayName] = useState('Player')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { rejoin, busyId, error: rejoinError } = useRejoin()

  // A link for a game this device already knows: rejoin with the saved role instead of joining fresh.
  const known = (() => {
    const info = parseInvite(invite)
    return info ? games.get(info.gameId) : undefined
  })()
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

  async function join() {
    setBusy(true); setError(null)
    try {
      const c = await startGame({ mode: 'join', invite, displayName })
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
      {known && <p className="muted">You have opened <strong>{known.name || 'this game'}</strong> before{rejoinError ? `, but rejoining failed: ${rejoinError}` : ''}.</p>}
      <label>Your name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" style={touch} disabled={busy || busyId !== null} onClick={join}>{busy ? 'Joining…' : 'Join'}</button>
        {known && <button style={touch} disabled={busy || busyId !== null} onClick={() => { started.current = false; setAutoRejoin(true) }}>Rejoin as {known.isGm ? 'GM' : 'player'}</button>}
        <button style={touch} onClick={() => navigate('/')}>Back</button>
      </div>
    </Shell>
  )
}

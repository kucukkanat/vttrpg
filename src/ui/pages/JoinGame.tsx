import { useState } from 'react'
import { Shell } from '../components'
import { navigate } from '../router'
import { useSession } from '../session'
import { startGame } from '../bootstrap'

export function JoinGame({ invite }: { invite: string }) {
  const { setController } = useSession()
  const [displayName, setDisplayName] = useState('Player')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <Shell title="Join game">
      <label>Your name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={join}>{busy ? 'Joining…' : 'Join'}</button>
        <button onClick={() => navigate('/')}>Back</button>
      </div>
    </Shell>
  )
}

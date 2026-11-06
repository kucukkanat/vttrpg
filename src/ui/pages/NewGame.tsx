import { useState } from 'react'
import { Shell } from '../components'
import { navigate } from '../router'
import { useSession } from '../session'
import { startGame } from '../bootstrap'
import { BUILTIN_PACKS } from '@/rules'

export function NewGame() {
  const { setController } = useSession()
  const [name, setName] = useState('My table')
  const [pack, setPack] = useState(BUILTIN_PACKS[0]?.id ?? 'mausritter')
  const [displayName, setDisplayName] = useState('GM')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true); setError(null)
    try {
      const c = await startGame({ mode: 'create', name, packId: pack, displayName })
      setController(c)
      navigate('/game')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <Shell title="New game">
      <label>Game name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>System
        <select value={pack} onChange={(e) => setPack(e.target.value)}>
          {BUILTIN_PACKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label>Your name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create and open table'}</button>
        <button onClick={() => navigate('/')}>Back</button>
      </div>
    </Shell>
  )
}

import type { GameController } from '../controller'
import { useGame } from '@/state/store'

export function PlayersPanel({ controller }: { controller: GameController }) {
  const presence = useGame((s) => s.presence)
  const gm = controller.connection.gm
  return (
    <div className="panel">
      <h3>Players</h3>
      <ul className="list">
        {Object.values(presence).map((p) => (
          <li key={p.pubkey}><span className="dot" style={{ background: p.color }} /> {p.name} {p.pubkey === gm && <span className="muted small">GM</span>}</li>
        ))}
      </ul>
    </div>
  )
}

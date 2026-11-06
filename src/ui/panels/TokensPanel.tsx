import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newId } from '@/core/ids'
import type { TokenId } from '@/core/ids'

export function TokensPanel({ controller }: { controller: GameController }) {
  const tokens = useGame((s) => s.tokens)
  const meta = useGame((s) => s.meta)
  const selected = useGame((s) => s.selectedToken)
  const select = useGame((s) => s.setSelectedToken)
  const add = () => {
    if (!meta?.activeScene) return
    void controller.dispatch({
      type: 'token.add',
      token: {
        id: newId<'TokenId'>(), scene: meta.activeScene, name: 'Token', color: '#e0a458',
        position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 4, light: 0, hidden: false, conditions: [],
      },
    })
  }
  return (
    <div className="panel">
      <h3>Tokens {controller.connection.isGm && <button onClick={add} disabled={!meta?.activeScene}>+</button>}</h3>
      <ul className="list">
        {Object.values(tokens).map((t) => (
          <li key={t.id} className={t.id === selected ? 'selected' : ''} onClick={() => select(t.id as TokenId)}>
            <span className="dot" style={{ background: t.color }} /> {t.name}
          </li>
        ))}
      </ul>
    </div>
  )
}

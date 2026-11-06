import { useEffect } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newId } from '@/core/ids'
import type { PlayerPubkey, TokenId } from '@/core/ids'
import type { Token } from '@/core/doc'
import { ModelPicker } from './ObjectPanel'

const COLORS = ['#e0a458', '#7cc4ff', '#8fd18f', '#f28b82', '#c58af9', '#ffd166', '#9aa0a6']

export function TokensPanel({ controller }: { controller: GameController }) {
  const tokens = useGame((s) => s.tokens)
  const meta = useGame((s) => s.meta)
  const selected = useGame((s) => s.selectedToken)
  const select = useGame((s) => s.setSelectedToken)
  const isGm = controller.connection.isGm
  const visible = Object.values(tokens).filter((t) => t.scene === meta?.activeScene && (isGm || !t.hidden))

  const remove = (id: TokenId) => {
    void controller.dispatch({ type: 'token.remove', token: id })
    if (selected === id) select(null)
  }
  // Delete / Backspace removes the selected token when focus is not in a text field.
  useEffect(() => {
    if (!isGm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) return
      const id = useGame.getState().selectedToken
      if (id) { e.preventDefault(); remove(id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGm])

  const add = () => {
    if (!meta?.activeScene) return
    const id = newId<'TokenId'>()
    void controller.dispatch({
      type: 'token.add',
      token: {
        id, scene: meta.activeScene, name: `Token ${visible.length + 1}`, color: COLORS[visible.length % COLORS.length],
        position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 4, light: 0, hidden: false, conditions: [],
      },
    })
    select(id)
  }

  return (
    <div className="panel">
      <h3>Tokens {isGm && <button onClick={add} disabled={!meta?.activeScene} aria-label="Add token">+</button>}</h3>
      <ul className="list">
        {visible.map((t) => (
          <li key={t.id} className={t.id === selected ? 'selected' : ''} onClick={() => select(t.id === selected ? null : (t.id as TokenId))}>
            <span className="dot" style={{ background: t.color }} />
            <span style={{ flex: 1 }}>{t.name}</span>
            {t.owner === controller.pubkey && <span className="muted small">you</span>}
            {t.hidden && <span className="muted small">hidden</span>}
            {isGm && <button className="icon" aria-label={`Remove ${t.name}`} title="Remove" onClick={(e) => { e.stopPropagation(); remove(t.id as TokenId) }}>🗑</button>}
          </li>
        ))}
      </ul>
      {selected && tokens[selected] && <TokenProps controller={controller} token={tokens[selected]} />}
    </div>
  )
}

function TokenProps({ controller, token }: { controller: GameController; token: Token }) {
  const isGm = controller.connection.isGm
  const mine = token.owner === controller.pubkey
  const presence = useGame((s) => s.presence)
  const patch = (p: Partial<Token>) => void controller.dispatch({ type: 'token.update', token: token.id, patch: p })

  if (!isGm && !mine) {
    return (
      <div className="props">
        {!token.owner && <button className="wide" onClick={() => void controller.dispatch({ type: 'token.claim', token: token.id })}>Claim {token.name}</button>}
        {token.owner && <p className="muted small">Owned by {token.owner.slice(0, 8)}</p>}
      </div>
    )
  }

  return (
    <div className="props">
      <label>Name<input value={token.name} onChange={(e) => patch({ name: e.target.value })} /></label>
      <div className="swatches">
        {COLORS.map((c) => <button key={c} className={`swatch ${c === token.color ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => patch({ color: c })} />)}
      </div>
      <div className="grid2">
        <label>Vision<input type="number" min={0} max={30} value={token.vision} onChange={(e) => patch({ vision: Number(e.target.value) })} /></label>
        <label>Light<input type="number" min={0} max={30} value={token.light} onChange={(e) => patch({ light: Number(e.target.value) })} /></label>
        <label>Size<input type="number" min={0.25} max={4} step={0.25} value={token.scale} onChange={(e) => patch({ scale: Number(e.target.value) })} /></label>
        {isGm && <label className="check"><input type="checkbox" checked={token.hidden} onChange={(e) => patch({ hidden: e.target.checked })} /> Hidden</label>}
      </div>
      {isGm && (
        <label>Owner
          <select value={token.owner ?? ''} onChange={(e) => void controller.dispatch({ type: 'token.claim', token: token.id, owner: (e.target.value || controller.pubkey) as PlayerPubkey })}>
            <option value="">GM</option>
            {Object.values(presence).filter((p) => p.pubkey !== controller.pubkey).map((p) => <option key={p.pubkey} value={p.pubkey}>{p.name}</option>)}
            {token.owner && token.owner !== controller.pubkey && !presence[token.owner] && <option value={token.owner}>{token.owner.slice(0, 8)} (offline)</option>}
          </select>
        </label>
      )}
      <ModelPicker
        controller={controller}
        title="Model"
        actionLabel="Use"
        current={token.model ? (token.model.name?.replace(/\.glb$/i, '') ?? 'custom model') : 'disc with initials'}
        onPick={(model) => patch({ model })}
        onClear={token.model ? () => patch({ model: undefined }) : undefined}
      />
      {isGm && <button className="danger wide" onClick={() => void controller.dispatch({ type: 'token.remove', token: token.id })}>Remove token</button>}
      <p className="muted small">Tip: Delete key removes the selected token.</p>
    </div>
  )
}

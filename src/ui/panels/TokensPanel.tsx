/**
 * Tokens panel: the list (with a filter once it gets long), ownership, visibility and removal.
 * Size, rotation, elevation and the model live in the Edit panel; the row's pencil and the
 * "Edit size and model" button send the selection there.
 */
import { useEffect, useRef, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newId } from '@/core/ids'
import type { PlayerPubkey, TokenId } from '@/core/ids'
import type { Token } from '@/core/doc'
import { isTypingTarget, requestOpenPanel } from '../shell/useShortcuts'
import './tokens.css'

const COLORS = ['#e0a458', '#7cc4ff', '#8fd18f', '#f28b82', '#c58af9', '#ffd166', '#9aa0a6']
/** Above this many rows the list gets a filter box and scrolls on its own. */
export const FILTER_THRESHOLD = 15

/** Case-insensitive substring match on the name; an empty needle keeps everything. */
export function filterTokens<T extends { name: string }>(tokens: readonly T[], needle: string): T[] {
  const q = needle.trim().toLowerCase()
  return q ? tokens.filter((t) => t.name.toLowerCase().includes(q)) : [...tokens]
}

export function TokensPanel({ controller }: { controller: GameController }) {
  const tokens = useGame((s) => s.tokens)
  const meta = useGame((s) => s.meta)
  const selected = useGame((s) => s.selectedToken)
  const select = useGame((s) => s.setSelectedToken)
  const isGm = controller.connection.isGm
  const visible = Object.values(tokens).filter((t) => t.scene === meta?.activeScene && (isGm || !t.hidden))
  const long = visible.length > FILTER_THRESHOLD
  const [filter, setFilter] = useState('')
  const rows = long ? filterTokens(visible, filter) : visible
  const list = useRef<HTMLUListElement>(null)

  // A tap on the table changes the selection; keep that row on screen in a long list.
  useEffect(() => {
    if (!selected) return
    list.current?.querySelector<HTMLElement>('li.selected')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  const remove = (id: TokenId) => {
    void controller.dispatch({ type: 'token.remove', token: id })
    if (selected === id) select(null)
  }
  // Delete removes the selected token when focus is not in a field. Backspace is deliberately not a
  // delete key: it is too easy to hit while the focus is on the canvas. Removal is undoable (Cmd/Ctrl+Z).
  useEffect(() => {
    if (!isGm) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(document.activeElement)) return
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

  const edit = (id: TokenId) => {
    select(id)
    requestOpenPanel('object')
  }

  return (
    <div className="panel">
      <h3>Tokens {isGm && <button onClick={add} disabled={!meta?.activeScene} aria-label="Add token">+</button>}</h3>
      {long && (
        <input
          className="tokens-filter"
          type="search"
          value={filter}
          placeholder={`Filter ${visible.length} tokens…`}
          aria-label="Filter tokens by name"
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <ul className={`list tokens-list ${long ? 'long' : ''}`} ref={list}>
        {rows.map((t) => {
          const editable = isGm || t.owner === controller.pubkey
          return (
            <li key={t.id} className={t.id === selected ? 'selected' : ''} onClick={() => select(t.id === selected ? null : (t.id as TokenId))}>
              <span className="dot" style={{ background: t.color }} />
              <span className="name">{t.name}</span>
              {t.owner === controller.pubkey && <span className="muted small">you</span>}
              {t.hidden && <span className="muted small">hidden</span>}
              {editable && <button className="icon" aria-label={`Edit ${t.name}`} title="Size, rotation and model" onClick={(e) => { e.stopPropagation(); edit(t.id as TokenId) }}>✎</button>}
              {isGm && <button className="icon" aria-label={`Remove ${t.name}`} title="Remove" onClick={(e) => { e.stopPropagation(); remove(t.id as TokenId) }}>🗑</button>}
            </li>
          )
        })}
      </ul>
      {long && rows.length === 0 && <p className="muted small tokens-empty">No token matches “{filter.trim()}”.</p>}
      {selected && tokens[selected] && <TokenProps controller={controller} token={tokens[selected]} onEdit={() => edit(selected)} />}
    </div>
  )
}

function TokenProps({ controller, token, onEdit }: { controller: GameController; token: Token; onEdit(): void }) {
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
      <button className="wide" onClick={onEdit}>Edit size, rotation and model ›</button>
      {isGm && <button className="danger wide" onClick={() => void controller.dispatch({ type: 'token.remove', token: token.id })}>Remove token</button>}
      <p className="muted small">Tip: Delete removes the selected token; Cmd/Ctrl+Z brings it back.</p>
    </div>
  )
}

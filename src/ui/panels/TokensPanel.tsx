/**
 * Tokens card (players; the GM's tokens are the Library's "In this scene" filter and the
 * Inspector): the list (with a filter once it gets long), claiming, and the token editor on the
 * player's own tokens. Rotation, elevation and the model live in edit mode's Details; the row's
 * pencil and "Edit rotation and model" send the selection there.
 */
import { useEffect, useRef, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newId } from '@/core/ids'
import type { TokenId } from '@/core/ids'
import type { Token } from '@/core/doc'
import { isTypingTarget } from '../shell/useShortcuts'
import { startEditing } from '@/table/editTap'
import { TOKEN_COLORS as COLORS, TokenEditor } from '../build/panes/TokenPane'
import './tokens.css'
import { Icon } from '@/ui/icons'

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

  const edit = (id: TokenId) => startEditing({ kind: 'token', id })

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
              {editable && <button className="icon" aria-label={`Edit ${t.name}`} title="Size, rotation and model" onClick={(e) => { e.stopPropagation(); edit(t.id as TokenId) }}><Icon name="pencil" /></button>}
              {isGm && <button className="icon" aria-label={`Remove ${t.name}`} title="Remove" onClick={(e) => { e.stopPropagation(); remove(t.id as TokenId) }}><Icon name="trash" /></button>}
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
  if (!isGm && !mine) {
    return (
      <div className="props">
        {!token.owner && <button className="wide" onClick={() => void controller.dispatch({ type: 'token.claim', token: token.id })}>Claim {token.name}</button>}
        {token.owner && <p className="muted small">Owned by {token.owner.slice(0, 8)}</p>}
      </div>
    )
  }
  // The same editor as the Inspector's token context.
  return (
    <div className="props">
      <TokenEditor controller={controller} token={token} />
      <button className="wide" onClick={onEdit}>Edit rotation and model ›</button>
    </div>
  )
}

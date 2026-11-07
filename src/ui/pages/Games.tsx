/**
 * "Your games": the local registry rendered as a list with Rejoin / Forget, plus the
 * rejoin flow shared by Home (reload, list) and JoinGame (invite for a known game).
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useSession } from '../session'
import { navigate } from '../router'
import { startGame } from '../bootstrap'
import { formatLastOpened, games, type SavedGame } from '../games'
import { localGameStore } from '@/net'
import type { GameId } from '@/core/ids'

const touch: CSSProperties = { minHeight: 48, minWidth: 96, padding: '10px 16px', fontSize: 15 }
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 0',
  borderBottom: '1px solid var(--border)',
  flexWrap: 'wrap',
}
const badge = (gm: boolean): CSSProperties => ({
  fontSize: 12,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  color: gm ? 'var(--accent-fg)' : 'var(--muted)',
  background: gm ? 'var(--accent)' : 'transparent',
  fontWeight: gm ? 600 : 400,
})

export function useSavedGames(): SavedGame[] {
  const [list, setList] = useState(() => games.list())
  useEffect(() => {
    const refresh = () => setList(games.list())
    const off = games.subscribe(refresh)
    window.addEventListener('storage', refresh)
    return () => {
      off()
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return list
}

/** Drives `startGame({ mode: 'rejoin' })` and puts the controller in the session. */
export function useRejoin() {
  const { setController } = useSession()
  const [busyId, setBusyId] = useState<GameId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** `isCancelled` is polled once the connection is up: a cancelled rejoin disposes it instead of opening the table. */
  const rejoin = useCallback(async (gameId: GameId, isCancelled: () => boolean = () => false) => {
    setBusyId(gameId)
    setError(null)
    try {
      const c = await startGame({ mode: 'rejoin', gameId })
      if (isCancelled()) {
        c.dispose()
        return false
      }
      if (c.notice) setNotice(c.notice)
      setController(c)
      navigate('/game')
      return true
    } catch (e) {
      if (!isCancelled()) setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusyId(null)
    }
  }, [setController])

  return { rejoin, busyId, error, notice, clearError: () => setError(null) }
}

export function YourGames({ onRejoin, busyId }: { onRejoin: (gameId: GameId) => void; busyId: GameId | null }) {
  const list = useSavedGames()
  const [confirmForget, setConfirmForget] = useState<GameId | null>(null)
  if (!list.length) return null
  return (
    <section aria-label="Your games" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', margin: '0 0 4px' }}>Your games</h2>
      <ul className="list" style={{ margin: 0 }}>
        {list.map((g) => {
          const busy = busyId === g.gameId
          const asking = confirmForget === g.gameId
          return (
            <li key={g.gameId} style={{ ...rowStyle, cursor: 'default' }}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name || 'Untitled game'}</strong>
                  <span style={badge(g.isGm)}>{g.isGm ? 'GM' : 'Player'}</span>
                </div>
                <div className="muted small">Last opened {formatLastOpened(g.lastOpened)}{g.pack ? ` · ${g.pack}` : ''}</div>
              </div>
              {asking ? (
                <div className="row" style={{ marginTop: 0 }}>
                  <button style={touch} onClick={() => { games.forget(g.gameId); void localGameStore().remove(g.gameId).catch(() => {}); setConfirmForget(null) }}>Yes, forget</button>
                  <button style={touch} onClick={() => setConfirmForget(null)}>Keep</button>
                </div>
              ) : (
                <div className="row" style={{ marginTop: 0 }}>
                  <button className="primary" style={touch} disabled={busyId !== null} onClick={() => onRejoin(g.gameId)}>
                    {busy ? 'Reconnecting…' : 'Rejoin'}
                  </button>
                  <button style={touch} disabled={busyId !== null} onClick={() => setConfirmForget(g.gameId)}>Forget</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function Reconnecting({ game, onCancel }: { game: SavedGame | undefined; onCancel: () => void }) {
  return (
    <div role="status" style={{ padding: '16px 0' }}>
      <p>
        <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', marginRight: 10, animation: 'spin 1s linear infinite' }} />
        Reconnecting to <strong>{game?.name || 'your game'}</strong> as {game?.isGm ? 'GM' : 'player'}…
      </p>
      <p className="muted small">Fetching the latest snapshot and deltas from the relays.</p>
      <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
      <div className="row">
        <button style={touch} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

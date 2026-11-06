import { useEffect, useRef, useState } from 'react'
import { navigate, takeReloadedIntoGame } from '../router'
import { Shell } from '../components'
import { useSession } from '../session'
import { games } from '../games'
import { Reconnecting, YourGames, useRejoin } from './Games'
import type { GameId } from '@/core/ids'

const touch = { minHeight: 48, padding: '10px 18px', fontSize: 15 } as const

export function Home() {
  const { controller } = useSession()
  const { rejoin, busyId, error, notice } = useRejoin()
  const [reconnecting, setReconnecting] = useState<GameId | null>(null)
  const cancelled = useRef(false)

  // Page reloaded while on #/game: there is no live controller, so reconnect to the most recent game.
  useEffect(() => {
    if (!takeReloadedIntoGame() || controller) return
    const recent = games.mostRecent()
    if (!recent) return
    cancelled.current = false
    setReconnecting(recent.gameId)
    void rejoin(recent.gameId, () => cancelled.current).then((ok) => {
      if (!ok) setReconnecting(null)
    })
  }, [controller, rejoin])

  const onRejoin = (gameId: GameId) => {
    cancelled.current = false
    setReconnecting(gameId)
    void rejoin(gameId, () => cancelled.current).then(() => setReconnecting(null))
  }

  return (
    <Shell title="VTTRPG">
      <p className="muted">A 3D tabletop for any ruleset. No accounts, no servers.</p>
      {error && <p className="error">{error}</p>}
      {notice && <p className="muted">{notice}</p>}
      {controller && (
        <div className="row">
          <button className="primary" style={touch} onClick={() => navigate('/game')}>Back to table</button>
        </div>
      )}
      {reconnecting && busyId ? (
        <Reconnecting
          game={games.get(reconnecting)}
          onCancel={() => {
            cancelled.current = true
            setReconnecting(null)
          }}
        />
      ) : (
        <YourGames onRejoin={onRejoin} busyId={busyId} />
      )}
      <div className="row">
        <button className="primary" style={touch} onClick={() => navigate('/new')}>New game</button>
        <button style={touch} onClick={() => {
          const link = prompt('Paste an invite link')
          if (link) window.location.href = link
        }}>Join with a link</button>
      </div>
      <p className="muted small">Dev stories: <a href="#/dev/table">table</a> · <a href="#/dev/dice">dice</a> · <a href="#/dev/net">net</a></p>
    </Shell>
  )
}

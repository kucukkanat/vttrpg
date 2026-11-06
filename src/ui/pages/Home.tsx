import { useEffect, useRef, useState } from 'react'
import { navigate, takeReloadedIntoGame } from '../router'
import { Shell } from '../components'
import { useSession } from '../session'
import { games } from '../games'
import { Reconnecting, YourGames, useRejoin } from './Games'
import { useCoarsePointer, verb } from '../useMediaQuery'
import type { GameId } from '@/core/ids'

const touch = { minHeight: 48, padding: '10px 18px', fontSize: 15 } as const

export function Home() {
  const { controller } = useSession()
  const { rejoin, busyId, error, notice } = useRejoin()
  const coarse = useCoarsePointer()
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
      <p className="muted small">
        {verb(coarse)} <strong>New game</strong> to host a table. Players join from the link you share, in any browser; nothing to install.
      </p>
      {import.meta.env.DEV && (
        <p className="muted small">Dev stories: <a href="#/dev/table">table</a> · <a href="#/dev/dice">dice</a> · <a href="#/dev/net">net</a></p>
      )}
    </Shell>
  )
}

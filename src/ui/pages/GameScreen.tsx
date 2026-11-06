import { useEffect } from 'react'
import { useSession } from '../session'
import { navigate } from '../router'
import { useGame } from '@/state/store'
import { TableCanvas } from '@/table'
import { ChatPanel } from '../panels/ChatPanel'
import { TokensPanel } from '../panels/TokensPanel'
import { PlayersPanel } from '../panels/PlayersPanel'
import { TopBar } from '../panels/TopBar'

export function GameScreen() {
  const { controller } = useSession()
  const meta = useGame((s) => s.meta)
  useEffect(() => { if (!controller) navigate('/') }, [controller])
  if (!controller) return null

  return (
    <div className="game">
      <TopBar controller={controller} />
      <aside className="left">
        <TokensPanel controller={controller} />
        <PlayersPanel controller={controller} />
      </aside>
      <section className="table">
        {meta?.activeScene ? (
          <TableCanvas
            onIntent={(i) => void controller.dispatch(i)}
            onPresence={(p) => controller.presence(p)}
          />
        ) : (
          <div className="empty">No active scene. {controller.connection.isGm ? 'Add one from the Scenes menu.' : 'Waiting for the GM.'}</div>
        )}
      </section>
      <aside className="right">
        <ChatPanel controller={controller} />
      </aside>
    </div>
  )
}

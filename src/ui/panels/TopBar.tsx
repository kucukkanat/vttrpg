import { useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'

export function TopBar({ controller, compact = false }: { controller: GameController; compact?: boolean }) {
  const meta = useGame((s) => s.meta)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(controller.connection.inviteLink())
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  return (
    <header className="topbar">
      <strong className="title">{meta?.name ?? 'Game'}</strong>
      <span className={`status ${controller.connection.status}`} title={controller.connection.status} />
      {!compact && <span className="muted small">{controller.connection.isGm ? 'GM' : 'Player'} · {controller.connection.status}</span>}
      <span className="spacer" />
      {controller.connection.isGm && <button onClick={copy}>{copied ? 'Copied' : compact ? 'Invite' : 'Copy invite link'}</button>}
      <button onClick={() => { controller.dispose(); window.location.hash = '/' }}>Leave</button>
    </header>
  )
}

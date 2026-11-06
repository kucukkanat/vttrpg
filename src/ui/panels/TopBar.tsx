import { useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'

export function TopBar({ controller }: { controller: GameController }) {
  const meta = useGame((s) => s.meta)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(controller.connection.inviteLink())
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  return (
    <header className="topbar">
      <strong>{meta?.name ?? 'Game'}</strong>
      <span className="muted small">{controller.connection.isGm ? 'GM' : 'Player'} · {controller.connection.status}</span>
      <span className="spacer" />
      {controller.connection.isGm && <button onClick={copy}>{copied ? 'Copied' : 'Copy invite link'}</button>}
      <button onClick={() => { controller.dispose(); window.location.hash = '/' }}>Leave</button>
    </header>
  )
}

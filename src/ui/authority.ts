/**
 * Who runs the game, for the UI: this identity's role, the co-GMs and the host from the
 * founder's manifest, and whether this client is processing intents right now. The net layer
 * holds the truth (`connection.authority`); this only mirrors it into React.
 */
import { useEffect, useState } from 'react'
import type { GameAuthority } from '@/net'
import type { GameController } from './controller'
import { games } from './games'

export interface AuthorityView {
  role: 'gm' | 'co-gm' | 'player'
  authority: GameAuthority
  processing: boolean
  /** The role this connection runs in differs from the manifest's: a grant or revocation needs a reopen. */
  needsReopen: boolean
}

/** Processing changes with presence, which has no event of its own here; re-read this often. */
export const AUTHORITY_POLL_MS = 2000

type Conn = GameController['connection']

export function readAuthority(connection: Conn): AuthorityView {
  const role = connection.role ?? (connection.isGm ? 'gm' : 'player')
  const authority = connection.authority ?? { founder: connection.gm, coGms: [], host: connection.gm }
  const writerNow = role !== 'player'
  return { role, authority, processing: connection.processing ?? connection.isGm, needsReopen: writerNow !== connection.isGm }
}

const same = (a: AuthorityView, b: AuthorityView) =>
  a.role === b.role && a.processing === b.processing && a.needsReopen === b.needsReopen && a.authority.host === b.authority.host && a.authority.coGms.join() === b.authority.coGms.join()

export function useAuthority(controller: GameController): AuthorityView {
  const [view, setView] = useState(() => readAuthority(controller.connection))
  useEffect(() => {
    const { connection } = controller
    const read = () => setView((prev) => { const next = readAuthority(connection); return same(prev, next) ? prev : next })
    read()
    const off = connection.onAuthority?.(read) ?? (() => {})
    const timer = setInterval(read, AUTHORITY_POLL_MS)
    return () => { off(); clearInterval(timer) }
  }, [controller])
  return view
}

/** Short label for the top bar. */
export function roleLabel(role: AuthorityView['role']): string {
  return role === 'gm' ? 'GM' : role === 'co-gm' ? 'Co-GM' : 'Player'
}

/**
 * Reopen the game in the role the founder's manifest now gives this identity: the registry
 * records it, and the page reloads into the Home rejoin of the most recent game.
 */
export function reopenInRole(controller: GameController, role: AuthorityView['role']) {
  games.touch(controller.connection.gameId, { isGm: role !== 'player' })
  controller.dispose()
  window.location.hash = '/'
  window.location.reload()
}

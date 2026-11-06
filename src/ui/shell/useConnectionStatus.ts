import { useEffect, useState } from 'react'
import type { GameController } from '../controller'

export type ConnectionStatus = GameController['connection']['status']

export interface ConnectionView {
  /** Relay status: connecting, connected (any relay open) or offline. */
  status: ConnectionStatus
  /** Player: no presence from the GM for a while; moves and chat queue, rolls are refused. */
  gmAway: boolean
}

/** Live relay status plus the GM-away flag, both straight from the connection. */
export function useConnectionStatus(controller: GameController): ConnectionView {
  const [status, setStatus] = useState<ConnectionStatus>(controller.connection.status)
  const [gmAway, setGmAway] = useState<boolean>(controller.connection.gmAway)
  useEffect(() => {
    const { connection } = controller
    setStatus(connection.status)
    setGmAway(connection.gmAway)
    const offStatus = connection.onStatus(setStatus)
    const offAway = connection.onGmAway(setGmAway)
    return () => { offStatus(); offAway() }
  }, [controller])
  return { status, gmAway }
}

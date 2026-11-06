import { useEffect, useState } from 'react'
import type { GameController } from '../controller'

export type ConnectionStatus = GameController['connection']['status']

export interface ConnectionView {
  /** Relay status: connecting, connected (any relay open) or offline. */
  status: ConnectionStatus
  /** Player: no presence from the GM for a while; moves and chat queue, rolls are refused. */
  gmAway: boolean
  /** Relays with an open socket right now; 0 while offline. */
  relaysOpen: number
  /** Relays this connection was opened with. */
  relaysTotal: number
}

/** Open-relay counts have no event of their own, so they are re-read this often while mounted. */
export const RELAY_POLL_MS = 3000

/** Live relay status, the GM-away flag and the open-relay count, all straight from the connection. */
export function useConnectionStatus(controller: GameController): ConnectionView {
  const [status, setStatus] = useState<ConnectionStatus>(controller.connection.status)
  const [gmAway, setGmAway] = useState<boolean>(controller.connection.gmAway)
  const [relaysOpen, setRelaysOpen] = useState<number>(controller.connection.relayCount)
  useEffect(() => {
    const { connection } = controller
    const readRelays = () => setRelaysOpen(connection.status === 'offline' ? 0 : connection.relayCount)
    setStatus(connection.status)
    setGmAway(connection.gmAway)
    readRelays()
    const offStatus = connection.onStatus((s) => { setStatus(s); readRelays() })
    const offAway = connection.onGmAway(setGmAway)
    const timer = setInterval(readRelays, RELAY_POLL_MS)
    return () => { offStatus(); offAway(); clearInterval(timer) }
  }, [controller])
  return { status, gmAway, relaysOpen, relaysTotal: controller.connection.relays.length }
}

import { useEffect, useState } from 'react'
import type { GameController } from '../controller'

export type ConnectionStatus = GameController['connection']['status']

export function useConnectionStatus(controller: GameController): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(controller.connection.status)
  useEffect(() => {
    setStatus(controller.connection.status)
    return controller.connection.onStatus(setStatus)
  }, [controller])
  return status
}

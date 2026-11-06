import { useEffect } from 'react'
import { useSession } from '../session'
import { navigate } from '../router'
import { GameShell } from '../shell'

/** Route `/game`: hands the live controller to the responsive shell. */
export function GameScreen() {
  const { controller } = useSession()
  useEffect(() => { if (!controller) navigate('/') }, [controller])
  if (!controller) return null
  return <GameShell controller={controller} />
}

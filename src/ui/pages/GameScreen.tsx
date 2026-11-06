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

// Default export for `React.lazy` in App; the route is loaded on first visit.
export default GameScreen

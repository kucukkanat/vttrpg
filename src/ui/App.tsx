import { lazy, Suspense } from 'react'
import { useRoute } from './router'
import { Home } from './pages/Home'
import { NewGame } from './pages/NewGame'
import { JoinGame } from './pages/JoinGame'
import { DevStories } from './pages/DevStories'
import { SessionProvider } from './session'
import { AudioBridge } from './AudioBridge'

// The game screen (shell, panels, table, dice) is its own chunk: the home, new and join pages
// only need the network layer, so they render before any of it downloads.
const GameScreen = lazy(() => import('./pages/GameScreen'))
// The table display for a TV or second screen: the table alone, no shell.
const DisplayScreen = lazy(() => import('./pages/DisplayScreen'))

function GameLoading() {
  return (
    <div className="empty">
      <div><p className="muted">Loading table…</p></div>
    </div>
  )
}

export function App() {
  const route = useRoute()
  return (
    <SessionProvider>
      {route.name === 'home' && <Home />}
      {route.name === 'new' && <NewGame />}
      {route.name === 'join' && <JoinGame invite={route.invite} />}
      {route.name === 'game' && <Suspense fallback={<GameLoading />}><GameScreen /></Suspense>}
      {route.name === 'dev' && <DevStories story={route.story} />}
      {route.name === 'display' && <Suspense fallback={<GameLoading />}><DisplayScreen href={route.href} /></Suspense>}
      {route.name === 'game' && <AudioBridge />}
    </SessionProvider>
  )
}

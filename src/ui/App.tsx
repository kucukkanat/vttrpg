import { useRoute } from './router'
import { Home } from './pages/Home'
import { NewGame } from './pages/NewGame'
import { JoinGame } from './pages/JoinGame'
import { GameScreen } from './pages/GameScreen'
import { DevStories } from './pages/DevStories'
import { SessionProvider } from './session'
import { AudioBridge } from './AudioBridge'

export function App() {
  const route = useRoute()
  return (
    <SessionProvider>
      {route.name === 'home' && <Home />}
      {route.name === 'new' && <NewGame />}
      {route.name === 'join' && <JoinGame invite={route.invite} />}
      {route.name === 'game' && <GameScreen />}
      {route.name === 'dev' && <DevStories story={route.story} />}
      {route.name === 'game' && <AudioBridge />}
    </SessionProvider>
  )
}

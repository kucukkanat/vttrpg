import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './ui/global.css'
import { registerPwa } from './pwa'
import { BuildTag } from './ui/BuildTag'

registerPwa()
console.info(`VTTRPG build ${__BUILD_ID__} (${__BUILD_TIME__})`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <BuildTag />
  </StrictMode>,
)

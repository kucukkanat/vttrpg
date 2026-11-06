/** Holds the live GameController for the current tab. */
import { createContext, useContext, useState, type ReactNode } from 'react'
import type { GameController } from './controller'

interface SessionCtx {
  controller: GameController | null
  setController(c: GameController | null): void
}
const Ctx = createContext<SessionCtx>({ controller: null, setController: () => {} })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [controller, setController] = useState<GameController | null>(null)
  return <Ctx.Provider value={{ controller, setController }}>{children}</Ctx.Provider>
}
export const useSession = () => useContext(Ctx)

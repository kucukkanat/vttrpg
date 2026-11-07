import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GameController } from '../controller'

// Server rendering reads a zustand hook's initial snapshot; read the live state instead.
type Hook<S> = { getState(): S }
function liveHook<S>(hook: Hook<S>) {
  return Object.assign((selector: (s: S) => unknown) => selector(hook.getState()), hook)
}
vi.mock('@/table/tableState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/table/tableState')>()
  return { ...actual, useTableUi: liveHook(actual.useTableUi) }
})
vi.mock('@/table/build/buildState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/table/build/buildState')>()
  return { ...actual, useBuildUi: liveHook(actual.useBuildUi) }
})
let session: GameController | null = null
vi.mock('../session', () => ({ useSession: () => ({ controller: session, setController: () => {} }) }))

const { CameraPill } = await import('./Hud')
const { useTableUi } = await import('@/table/tableState')
const { useBuildUi } = await import('@/table/build/buildState')

const controller = (isGm: boolean) => ({ connection: { isGm }, pubkey: 'me', rules: null, dispatch: async () => {} } as unknown as GameController)

describe('Fog on the tool rail', () => {
  beforeEach(() => {
    useTableUi.getState().set({ cameraActive: { mode: 'orbit', canFollow: false } })
    useBuildUi.getState().set({ tool: null })
  })

  it('shows the GM a Fog button', () => {
    session = controller(true)
    expect(renderToStaticMarkup(<CameraPill />)).toContain('cam-fog')
  })

  it('lights up while the fog brush is in hand', () => {
    session = controller(true)
    useBuildUi.getState().set({ tool: 'fog-hide' })
    expect(renderToStaticMarkup(<CameraPill />)).toMatch(/class="cam-btn cam-fog on" aria-pressed="true"/)
  })

  it('is not there for players', () => {
    session = controller(false)
    expect(renderToStaticMarkup(<CameraPill />)).not.toContain('cam-fog')
  })
})

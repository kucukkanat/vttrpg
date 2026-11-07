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
vi.mock('./tableLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tableLayout')>()
  return { ...actual, useTableLayout: liveHook(actual.useTableLayout) }
})
vi.mock('@/table/build/buildState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/table/build/buildState')>()
  return { ...actual, useBuildUi: liveHook(actual.useBuildUi) }
})
let session: GameController | null = null
vi.mock('../session', () => ({ useSession: () => ({ controller: session, setController: () => {} }) }))

const { CameraPill } = await import('./Hud')
const { useTableUi } = await import('@/table/tableState')
const { useTableLayout } = await import('./tableLayout')
const { useBuildUi } = await import('@/table/build/buildState')

const controller = (isGm: boolean) => ({ connection: { isGm }, pubkey: 'me', rules: null, dispatch: async () => {} } as unknown as GameController)

describe('Fog on the Play tool rail', () => {
  beforeEach(() => {
    useTableUi.getState().set({ cameraActive: { mode: 'orbit', canFollow: false } })
    useTableLayout.getState().set({ mode: 'play' })
    useBuildUi.getState().set({ tool: null })
  })

  it('shows the GM a Fog button in Play', () => {
    session = controller(true)
    expect(renderToStaticMarkup(<CameraPill />)).toContain('cam-fog')
  })

  it('lights up while the fog brush is in hand', () => {
    session = controller(true)
    useBuildUi.getState().set({ tool: 'fog-hide' })
    expect(renderToStaticMarkup(<CameraPill />)).toMatch(/class="cam-btn cam-fog on" aria-pressed="true"/)
  })

  it('is not there for players, nor in Build (the tool strip has fog there)', () => {
    session = controller(false)
    expect(renderToStaticMarkup(<CameraPill />)).not.toContain('cam-fog')
    session = controller(true)
    useTableLayout.getState().set({ mode: 'build' })
    expect(renderToStaticMarkup(<CameraPill />)).not.toContain('cam-fog')
  })
})

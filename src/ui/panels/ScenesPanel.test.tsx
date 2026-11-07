import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GameMeta, Scene } from '@/core/doc'
import type { PlayerPubkey, SceneId } from '@/core/ids'
import { useGame } from '@/state/store'
import { setSceneError, useTableUi } from '@/table/tableState'
import type { GameController } from '../controller'
import { ScenesPanel } from './ScenesPanel'

// Server rendering reads a zustand hook's *initial* snapshot; read the live state instead so the
// panel can be rendered to markup against the store the tests fill.
type Hook<S> = { getState(): S }
function liveHook<S>(hook: Hook<S>) {
  return Object.assign((selector: (s: S) => unknown) => selector(hook.getState()), hook)
}
vi.mock('@/state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/state/store')>()
  return { ...actual, useGame: liveHook(actual.useGame) }
})
vi.mock('@/table/tableState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/table/tableState')>()
  return { ...actual, useTableUi: liveHook(actual.useTableUi) }
})

const grid = { type: 'square' as const, cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }
const tavern: Scene = { id: 't' as SceneId, name: 'Tavern', grid, cameraMode: 'orbit', darkness: 0.8 }
const dungeon: Scene = { id: 'd' as SceneId, name: 'Dungeon', grid, cameraMode: 'token', darkness: 0 }
const meta: GameMeta = { name: 'g', gm: 'gm' as PlayerPubkey, pack: 'p' as GameMeta['pack'], activeScene: tavern.id, createdAt: 0 }

const controller = (isGm: boolean) => ({ connection: { isGm }, rules: null, dispatch: async () => {} } as unknown as GameController)
const render = (isGm = true) => renderToStaticMarkup(<ScenesPanel controller={controller(isGm)} />)

describe('ScenesPanel', () => {
  beforeEach(() => {
    useGame.getState()._replaceFromDoc({ meta, scenes: { [tavern.id]: tavern, [dungeon.id]: dungeon }, fog: {} })
    useTableUi.getState().set({ sceneErrors: {} })
  })

  it('marks the live scene and offers Switch on the others', () => {
    const html = render()
    expect(html).toMatch(/Tavern<\/span>.*?class="scene-live"/)
    expect(html).toMatch(/Dungeon<\/span>.*?class="scene-switch"/)
    expect(html.match(/class="scene-live"/g)).toHaveLength(1)
    expect(html.match(/class="scene-switch"/g)).toHaveLength(1)
  })
  it('offers Preview on the scenes that are not live and marks the one being previewed', () => {
    let html = render()
    expect(html.match(/class="scene-preview"/g)).toHaveLength(1)
    expect(html).toMatch(/Dungeon<\/span>.*?class="scene-preview" aria-pressed="false"/)
    useTableUi.getState().set({ previewScene: dungeon.id })
    html = render()
    expect(html).toMatch(/class="scene-preview primary" aria-pressed="true"[^>]*>Previewing</)
    useTableUi.getState().set({ previewScene: null })
  })
  it('has no per-scene camera control (the camera always orbits; Eyes is on the table)', () => {
    const html = render()
    expect(html).not.toContain('scene-camera')
  })
  it('disables Remove on the live scene only', () => {
    const html = render()
    expect(html).toMatch(/class="icon scene-remove" disabled="" title="[^"]*" aria-label="Remove Tavern"/)
    expect(html).toMatch(/class="icon scene-remove" title="Remove Dungeon" aria-label="Remove Dungeon"/)
  })
  it('flags scenes whose model failed to load', () => {
    setSceneError(dungeon.id, 'The model file could not be found.')
    const html = render()
    expect(html).toContain('title="Couldn&#x27;t load Dungeon: The model file could not be found."')
    expect(html.match(/class="scene-warn"/g)).toHaveLength(1)
  })
  it('shows the fog status and controls for the live scene', () => {
    useGame.getState()._replaceFromDoc({ fog: { [tavern.id]: { scene: tavern.id, revealed: ['0,0', '1,0'] } } })
    const html = render()
    expect(html).toContain('fog on · 2 cells explored')
    expect(html).toMatch(/<input type="checkbox" checked=""/)
    expect(html).toMatch(/>Reveal all<\/button>/)
    expect(html).toMatch(/>Hide all<\/button>/)
    expect(html).toContain('Darkness <span class="muted">80%</span>')
  })
  it('reports fog off when darkness is zero and nothing says otherwise', () => {
    useGame.getState()._replaceFromDoc({ meta: { ...meta, activeScene: dungeon.id } })
    expect(render()).toContain('fog off')
    useGame.getState()._replaceFromDoc({ scenes: { [tavern.id]: tavern, [dungeon.id]: { ...dungeon, fogEnabled: true } } })
    expect(render()).toContain('fog on · 0 cells explored')
  })
  it('gives players the list with the Live badge and nothing to press', () => {
    const html = render(false)
    expect(html).toContain('class="scene-live"')
    expect(html).not.toContain('scene-switch')
    expect(html).not.toContain('scene-remove')
    expect(html).not.toContain('Fog of war')
  })
})

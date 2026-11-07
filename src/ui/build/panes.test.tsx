import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GameMeta, Scene, Token } from '@/core/doc'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import type { GameController } from '../controller'
import { useFolds } from './folds'
import { FogOptions } from './panes/ToolOptions'
import { ScenePane } from './panes/ScenePane'
import { TokenEditor } from './panes/TokenPane'
import { Fold } from './Fold'

// Server rendering reads a zustand hook's initial snapshot; read the live state instead.
type Hook<S> = { getState(): S }
function liveHook<S>(hook: Hook<S>) {
  return Object.assign((selector: (s: S) => unknown) => selector(hook.getState()), hook)
}
vi.mock('@/state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/state/store')>()
  return { ...actual, useGame: liveHook(actual.useGame) }
})
vi.mock('./folds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./folds')>()
  return { ...actual, useFolds: liveHook(actual.useFolds) }
})

const grid = { type: 'square' as const, cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }
const tavern: Scene = { id: 't' as SceneId, name: 'Tavern', grid, cameraMode: 'orbit', darkness: 0.8 }
const dungeon: Scene = { id: 'd' as SceneId, name: 'Dungeon', grid, cameraMode: 'orbit', darkness: 0 }
const meta: GameMeta = { name: 'g', gm: 'gm' as PlayerPubkey, pack: 'p' as GameMeta['pack'], activeScene: tavern.id, createdAt: 0 }
const pip: Token = { id: 'pip' as TokenId, scene: tavern.id, name: 'Pip', color: '#e0a458', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 6, light: 2, hidden: true, conditions: [] }

const controller = (isGm = true) => ({ connection: { isGm, inviteLink: () => 'https://x/#/join/abc' }, pubkey: 'gm', rules: null, dispatch: async () => {} } as unknown as GameController)

describe('Inspector panes', () => {
  beforeEach(() => {
    useGame.getState()._replaceFromDoc({ meta, scenes: { [tavern.id]: tavern, [dungeon.id]: dungeon }, fog: {}, tokens: { [pip.id]: pip } })
    useFolds.setState({ open: {} })
  })

  it('Fog shows the fog status and Reveal all / Hide all / Reset', () => {
    useGame.getState()._replaceFromDoc({ fog: { [tavern.id]: { scene: tavern.id, revealed: ['0,0', '1,0'] } } })
    const html = renderToStaticMarkup(<FogOptions controller={controller()} />)
    expect(html).toContain('fog on · 2 cells explored')
    expect(html).toMatch(/>Reveal all<\/button>/)
    expect(html).toMatch(/>Hide all<\/button>/)
    expect(html).toMatch(/>Reset<\/button>/)
    expect(html).toContain('Brush size')
  })

  it('Fog reports fog off when darkness is zero and nothing says otherwise', () => {
    useGame.getState()._replaceFromDoc({ meta: { ...meta, activeScene: dungeon.id } })
    expect(renderToStaticMarkup(<FogOptions controller={controller()} />)).toContain('fog off')
  })

  it('the scene context is folded sections, each remembered', () => {
    let html = renderToStaticMarkup(<ScenePane controller={controller()} />)
    for (const title of ['Name and map', 'Grid', 'Light and weather', 'Starting fog', 'Table display']) expect(html).toContain(title)
    expect(html).not.toContain('Darkness')
    expect(html).toContain('Credits')
    useFolds.setState({ open: { 'scene.mood': true, 'scene.fog': true } })
    html = renderToStaticMarkup(<ScenePane controller={controller()} />)
    expect(html).toContain('Darkness <span class="muted">80%</span>')
    expect(html).toContain('Fog of war')
    expect(html).not.toContain('Open display')
  })

  it('the token editor links the sheet and skills, and folds the rest', () => {
    const html = renderToStaticMarkup(<TokenEditor controller={controller()} token={pip} Section={Fold} />)
    expect(html).toContain('value="Pip"')
    expect(html).toContain('Sheet ›')
    expect(html).toContain('Skills ›')
    expect(html).toContain('Start combat')
    expect(html).toContain('GM · hidden')
    expect(html).not.toContain('Hidden from players')
  })

  it('players get the same editor without owner, visibility, skills or initiative', () => {
    const html = renderToStaticMarkup(<TokenEditor controller={controller(false)} token={pip} />)
    expect(html).toContain('Vision')
    expect(html).toContain('Sheet ›')
    expect(html).not.toContain('Skills ›')
    expect(html).not.toContain('Owner')
    expect(html).not.toContain('combat')
  })
})

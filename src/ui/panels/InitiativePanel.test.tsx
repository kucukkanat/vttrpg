import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GameMeta, Token } from '@/core/doc'
import type { CharacterId, PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import { useGame } from '@/state/store'
import type { GameController } from '../controller'
import { InitiativeChip, InitiativePanel } from './InitiativePanel'

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

const gm = 'gm'.padEnd(64, '0') as PlayerPubkey
const alice = 'alice'.padEnd(64, '0') as PlayerPubkey
const scene = 'tavern' as SceneId
const meta: GameMeta = { name: 'g', gm, pack: 'mausritter' as GameMeta['pack'], activeScene: scene, createdAt: 0 }
const token = (id: string, over: Partial<Token> = {}): Token => ({
  id: id as TokenId, scene, name: id, color: '#fff', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [], ...over,
})
const pip = token('Pip', { owner: alice, character: 'c1' as CharacterId })
const rat = token('Rat', { character: 'c2' as CharacterId })
const ghost = token('Ghost', { character: 'c3' as CharacterId, hidden: true })
const tokens = { [pip.id]: pip, [rat.id]: rat, [ghost.id]: ghost } as Record<TokenId, Token>

const controller = (isGm: boolean) => ({ connection: { isGm, gm }, pubkey: isGm ? gm : alice, rules: null, dispatch: async () => {} } as unknown as GameController)
const render = (isGm: boolean) => renderToStaticMarkup(<InitiativePanel controller={controller(isGm)} />)
let session: GameController | null = null
vi.mock('../session', () => ({ useSession: () => ({ controller: session, setController: () => {} }) }))

describe('InitiativePanel', () => {
  beforeEach(() => {
    useGame.getState()._replaceFromDoc({ meta, tokens, characters: {}, initiative: null })
  })

  it('offers Start to the GM between encounters and tells players to wait', () => {
    expect(render(true)).toContain('>Start<')
    expect(render(true)).toContain('Start rolls initiative for 2 tokens')
    expect(render(false)).not.toContain('>Start<')
    expect(render(false)).toContain('when the GM starts an encounter')
  })

  it('lists the order with the current turn marked, Next and End for the GM', () => {
    useGame.getState()._replaceFromDoc({
      initiative: { active: true, round: 2, turn: 1, order: [{ token: rat.id, score: 15 }, { token: pip.id, score: 9 }, { token: ghost.id, score: 4 }] },
    })
    const html = render(true)
    expect(html).toContain('Round <strong>2</strong>')
    expect(html).toContain('Pip&#x27;s turn')
    expect(html).toContain('aria-label="Next turn"')
    expect(html).toContain('>End<')
    expect(html.match(/class="list-row init-row/g)).toHaveLength(3)
    expect(html).toMatch(/class="list-row init-row current"[^>]*>.*?Pip/)
    expect(html).toContain('>hidden<')
  })

  it('shows players a read-only list without hidden tokens and marks their own token', () => {
    useGame.getState()._replaceFromDoc({
      initiative: { active: true, round: 1, turn: 2, order: [{ token: rat.id, score: 15 }, { token: pip.id, score: 9 }, { token: ghost.id, score: 4 }] },
    })
    const html = render(false)
    expect(html.match(/class="list-row init-row/g)).toHaveLength(2)
    expect(html).not.toContain('Ghost')
    expect(html).toContain('Someone&#x27;s turn')
    expect(html).toMatch(/init-row mine/)
    expect(html).toContain('>you<')
    expect(html).not.toContain('aria-label="Next turn"')
    expect(html).not.toContain('init-add')
  })
})

describe('InitiativeChip', () => {
  beforeEach(() => {
    useGame.getState()._replaceFromDoc({ meta, tokens, characters: {}, initiative: null })
  })
  it('renders nothing between encounters and the round and turn during one', () => {
    session = controller(false)
    expect(renderToStaticMarkup(<InitiativeChip />)).toBe('')
    useGame.getState()._replaceFromDoc({ initiative: { active: true, round: 3, turn: 0, order: [{ token: pip.id, score: 9 }] } })
    const html = renderToStaticMarkup(<InitiativeChip />)
    expect(html).toContain('Round 3 · Pip&#x27;s turn')
    expect(html).toContain('class="chip init-chip"')
    session = null
    expect(renderToStaticMarkup(<InitiativeChip />)).toBe('')
  })
})

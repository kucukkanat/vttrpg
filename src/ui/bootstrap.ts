/** Builds a GameController for a new or joined game. */
import { createGame, joinGame, loadIdentity, parseInvite, DEFAULT_RELAYS } from '@/net'
import { createAssetResolver } from '@/assets'
import { createRulesEngine, loadPack, BUILTIN_PACKS } from '@/rules'
import { createController, type GameController } from './controller'
import type { GameMeta } from '@/core/doc'
import type { PackId } from '@/core/ids'

type Start =
  | { mode: 'create'; name: string; packId: string; displayName: string }
  | { mode: 'join'; invite: string; displayName: string }

const packUrl = (id: string) =>
  BUILTIN_PACKS.find((p) => p.id === id)?.url ?? `packs/${id}/`

async function tryRules(packId: string) {
  try {
    const pack = await loadPack(import.meta.env.BASE_URL + packUrl(packId))
    return createRulesEngine(pack)
  } catch (e) {
    console.warn('rules engine unavailable:', e)
    return null
  }
}

export async function startGame(start: Start): Promise<GameController> {
  const identity = await loadIdentity()
  const assets = createAssetResolver({ libraryBase: import.meta.env.BASE_URL + 'library/' })

  if (start.mode === 'create') {
    const connection = await createGame({ relays: DEFAULT_RELAYS, identity, name: start.name })
    const meta: GameMeta = {
      name: start.name,
      gm: identity.pubkey,
      pack: start.packId as PackId,
      activeScene: null,
      createdAt: Date.now(),
    }
    const m = connection.doc.getMap('meta')
    connection.doc.transact(() => { for (const [k, v] of Object.entries(meta)) m.set(k, v) })
    const rules = await tryRules(start.packId)
    return createController({ connection, rules, assets, displayName: start.displayName })
  }

  const info = parseInvite(start.invite)
  if (!info) throw new Error('That is not a valid invite link.')
  const connection = await joinGame({ relays: info.relays.length ? info.relays : DEFAULT_RELAYS, identity, gameId: info.gameId, gameKey: info.gameKey, isGm: false })
  const packId = (connection.doc.getMap('meta').get('pack') as string | undefined) ?? 'mausritter'
  const rules = await tryRules(packId)
  return createController({ connection, rules, assets, displayName: start.displayName })
}

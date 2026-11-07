/**
 * Table display (`#/display/<naddr>?k=…`): a read-only viewer for a TV or second screen. It joins
 * with a throwaway identity, never publishes presence or intents, and starts from this device's
 * local copy of the game when there is one (the GM's own machine) without writing to it.
 */
import { DEFAULT_RELAYS, ephemeralIdentity, joinGame, localGameStore, parseInvite, readOnlyGameStore } from '@/net'
import { createAssetResolver } from '@/assets'
import { BUILTIN_PACKS, createRulesEngine, loadPack } from '@/rules'
import type { DisplayLink } from '@/table/view'
import { createController, type GameController } from './controller'

async function rulesFor(packId: string) {
  try {
    const url = BUILTIN_PACKS.find((p) => p.id === packId)?.url ?? `packs/${packId}/`
    return createRulesEngine(await loadPack(import.meta.env.BASE_URL + url))
  } catch (e) {
    console.warn('display: rules engine unavailable:', e)
    return null
  }
}

export async function startDisplay(link: DisplayLink): Promise<GameController> {
  const info = parseInvite(link.invite)
  if (!info) throw new Error('This display link is not valid. Copy it again from the scene card (the scene title).')
  const identity = ephemeralIdentity()
  const assets = createAssetResolver({ libraryBase: import.meta.env.BASE_URL + 'library/' })
  const connection = await joinGame({
    relays: info.relays.length ? info.relays : DEFAULT_RELAYS,
    identity,
    gameId: info.gameId,
    gameKey: info.gameKey,
    isGm: false,
    local: readOnlyGameStore(localGameStore()),
  })
  const packId = (connection.doc.getMap('meta').get('pack') as string | undefined) ?? 'mausritter'
  const rules = await rulesFor(packId)
  return createController({ connection, rules, assets, displayName: 'Table display', pubkey: identity.pubkey })
}

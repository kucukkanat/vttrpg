/**
 * Builds a GameController for a new, joined or rejoined game, records the game
 * in the local registry, and runs the GM snapshot loop.
 *
 *   startGame({ mode: 'create', name, packId, displayName })
 *   startGame({ mode: 'join', invite, displayName })
 *   startGame({ mode: 'rejoin', gameId, displayName? })  // from the registry, with the saved role
 */
import { createGame, joinGame, loadIdentity, parseInvite, createSnapshotLoop, DEFAULT_RELAYS, type GameConnection, type Identity } from '@/net'
import { createAssetResolver, DEFAULT_BLOSSOM_SERVERS, type AssetResolver } from '@/assets'
import { createRulesEngine, loadPack, BUILTIN_PACKS } from '@/rules'
import { createController, type GameController } from './controller'
import { games, decideRejoin } from './games'
import type { GameMeta } from '@/core/doc'
import type { GameId, PackId } from '@/core/ids'

export type Start =
  | { mode: 'create'; name: string; packId: string; displayName: string }
  | { mode: 'join'; invite: string; displayName: string }
  | { mode: 'rejoin'; gameId: GameId; displayName?: string }

/** A controller plus an optional message worth showing (e.g. a GM demoted to player on rejoin). */
export type StartedGame = GameController & { notice?: string }

/** Dev only: `localStorage.setItem('vttrpg.relays', JSON.stringify(['ws://localhost:7777']))` points new games at other relays. */
function relayList(): string[] {
  if (!import.meta.env.DEV) return DEFAULT_RELAYS
  try {
    const raw = localStorage.getItem('vttrpg.relays')
    const list: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(list) && list.length && list.every((r) => typeof r === 'string')) return list as string[]
  } catch {
    // ignore
  }
  return DEFAULT_RELAYS
}

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

const metaOf = (connection: GameConnection) => connection.doc.getMap('meta')

function remember(connection: GameConnection, extra: { name: string; pack: string; displayName: string }) {
  const invite = connection.inviteLink()
  games.remember({
    gameId: connection.gameId,
    naddr: '',
    invite,
    name: extra.name,
    isGm: connection.isGm,
    gm: connection.gm,
    relays: connection.relays,
    pack: extra.pack,
    displayName: extra.displayName,
  })
}

/** Blossom upload through the asset resolver, shaped for the net snapshot loop. */
function snapshotUploader(assets: AssetResolver, identity: Identity) {
  const server = DEFAULT_BLOSSOM_SERVERS[0]
  return async (bytes: Uint8Array): Promise<{ url: string; sha256: string }> => {
    const file = new File([bytes as BlobPart], 'snapshot.yjs', { type: 'application/octet-stream' })
    const ref = await assets.importFile(file)
    const uploaded = await assets.uploadToBlossom(ref, server, (ev) => identity.sign(ev))
    const url = uploaded.sources.find((s) => s.includes(ref.sha256)) ?? uploaded.sources[uploaded.sources.length - 1]
    if (!url) throw new Error('Blossom returned no URL for the snapshot')
    return { url, sha256: ref.sha256 }
  }
}

function finish(opts: {
  connection: GameConnection
  identity: Identity
  assets: AssetResolver
  displayName: string
  packId: string
  notice?: string
}): Promise<StartedGame> {
  return tryRules(opts.packId).then((rules) => {
    const controller = createController({ connection: opts.connection, rules, assets: opts.assets, displayName: opts.displayName, pubkey: opts.identity.pubkey })
    let stopSnapshots = () => {}
    // Snapshot pointers live in the founder's manifest, so only the founder runs the loop; a co-GM's
    // edits reach late joiners as deltas on top of the founder's latest snapshot.
    if (opts.connection.isGm && opts.connection.role === 'gm') {
      const loop = createSnapshotLoop(opts.connection, {
        upload: snapshotUploader(opts.assets, opts.identity),
        prune: (intent) => controller.dispatch(intent),
      })
      stopSnapshots = loop.stop
      // Dev console: `await __vttSnapshot()` forces a snapshot upload right now.
      if (import.meta.env.DEV) (window as unknown as { __vttSnapshot?: () => Promise<boolean> }).__vttSnapshot = () => loop.flush(true)
    }
    const dispose = controller.dispose
    controller.dispose = () => {
      stopSnapshots()
      dispose()
    }
    return Object.assign(controller, opts.notice ? { notice: opts.notice } : {})
  })
}

export async function startGame(start: Start): Promise<StartedGame> {
  const identity = await loadIdentity()
  const assets = createAssetResolver({ libraryBase: import.meta.env.BASE_URL + 'library/' })

  if (start.mode === 'create') {
    const connection = await createGame({ relays: relayList(), identity, name: start.name })
    const meta: GameMeta = {
      name: start.name,
      gm: identity.pubkey,
      pack: start.packId as PackId,
      activeScene: null,
      createdAt: Date.now(),
    }
    const m = metaOf(connection)
    connection.doc.transact(() => { for (const [k, v] of Object.entries(meta)) m.set(k, v) })
    remember(connection, { name: start.name, pack: start.packId, displayName: start.displayName })
    return finish({ connection, identity, assets, displayName: start.displayName, packId: start.packId })
  }

  if (start.mode === 'join') {
    const info = parseInvite(start.invite)
    if (!info) throw new Error('That is not a valid invite link.')
    const connection = await joinGame({ relays: info.relays.length ? info.relays : relayList(), identity, gameId: info.gameId, gameKey: info.gameKey, gm: info.gm, isGm: false })
    const m = metaOf(connection)
    const packId = (m.get('pack') as string | undefined) ?? 'mausritter'
    remember(connection, { name: (m.get('name') as string | undefined) ?? '', pack: packId, displayName: start.displayName })
    return finish({ connection, identity, assets, displayName: start.displayName, packId })
  }

  // rejoin
  const saved = games.get(start.gameId)
  if (!saved) throw new Error('This game is not on this device any more. Open its invite link to join again.')
  const info = parseInvite(saved.invite)
  if (!info) {
    games.forget(start.gameId)
    throw new Error('The saved invite for this game is unreadable; it was removed. Open a fresh invite link.')
  }
  const displayName = start.displayName ?? saved.displayName ?? (saved.isGm ? 'GM' : 'Player')
  const relays = info.relays.length ? info.relays : saved.relays.length ? saved.relays : relayList()
  // joinGame replays snapshot + deltas before resolving, for GMs too; the doc is complete when we read meta.
  const connection = await joinGame({ relays, identity, gameId: info.gameId, gameKey: info.gameKey, gm: info.gm, isGm: saved.isGm })
  const m = metaOf(connection)
  const metaGm = m.get('gm') as string | undefined
  const decision = decideRejoin({ saved, pubkey: identity.pubkey, connectionIsGm: connection.isGm, connectionRole: connection.role, metaGm })
  if (decision.role === 'error') {
    connection.close()
    throw new Error(decision.message)
  }
  let notice: string | undefined
  if (decision.role === 'player' && saved.isGm) {
    // net already refused GM powers (manifest gm != us); make the registry agree.
    if (connection.isGm) {
      // Manifest matched but meta.gm disagrees: do not act as authority over a doc that names another GM.
      connection.close()
      throw new Error('The game document names a different GM than this identity; refusing to take over. Open the invite link to join as a player.')
    }
    notice = decision.notice
    console.warn('rejoin:', notice)
  }
  console.log(`rejoin: ${decision.role === 'gm' ? 'GM' : 'player'} restored ${saved.name || saved.gameId} from relays`)
  const packId = (m.get('pack') as string | undefined) ?? saved.pack ?? 'mausritter'
  games.touch(start.gameId, { isGm: connection.isGm, name: (m.get('name') as string | undefined) ?? saved.name, pack: packId, displayName, relays: connection.relays })
  return finish({ connection, identity, assets, displayName, packId, notice })
}

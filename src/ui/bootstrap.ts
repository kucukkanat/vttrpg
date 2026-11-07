/**
 * Builds a GameController for a new, joined or rejoined game, records the game
 * in the local registry, and runs the GM snapshot loop.
 *
 *   startGame({ mode: 'create', name, packId, displayName })
 *   startGame({ mode: 'join', invite, displayName })
 *   startGame({ mode: 'rejoin', gameId, displayName? })  // from the registry, with the saved role
 */
import { createGame, joinGame, loadIdentity, parseInvite, createSnapshotLoop, DEFAULT_RELAYS, type GameConnection, type Identity } from '@/net'
import { createAssetResolver, DEFAULT_BLOSSOM_SERVERS, putBlobWithRetry, trackUnshared, type AssetResolver } from '@/assets'
import { sha256Hex } from '@/assets/hash'
import { createController, type GameController } from './controller'
import { games, decideRejoin } from './games'
import type { GameMeta } from '@/core/doc'
import type { GameId, PackId } from '@/core/ids'
import { packChoiceOf, rulesForChoice, type PackChoice } from './packSource'

export type Start =
  | { mode: 'create'; name: string; packId: string; displayName: string; packSource?: string; packAsset?: GameMeta['packAsset'] }
  | { mode: 'join'; invite: string; displayName: string }
  | { mode: 'rejoin'; gameId: GameId; displayName?: string }

/** A controller plus an optional message worth showing (e.g. a GM demoted to player on rejoin). */
export type StartedGame = GameController & { notice?: string }

/** Dev only: a list of URLs from localStorage, else `fallback`. */
function devList(key: string, fallback: string[]): string[] {
  if (!import.meta.env.DEV) return fallback
  try {
    const raw = localStorage.getItem(key)
    const list: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(list) && list.length && list.every((r) => typeof r === 'string')) return list as string[]
  } catch {
    // ignore
  }
  return fallback
}

/** Dev only: `localStorage.setItem('vttrpg.relays', JSON.stringify(['ws://localhost:7777']))` points new games at other relays. */
const relayList = () => devList('vttrpg.relays', DEFAULT_RELAYS)

/** Dev only: `localStorage.setItem('vttrpg.blossom', JSON.stringify(['http://localhost:3000']))` uploads and fetches assets and snapshots there. */
const blossomList = () => devList('vttrpg.blossom', DEFAULT_BLOSSOM_SERVERS)


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

/**
 * Blossom upload shaped for the net snapshot loop. The loop hands over ciphertext (it encrypts each
 * snapshot itself), so this only uploads; the snapshot is not kept in the local asset cache.
 */
export function snapshotUploader(identity: Pick<Identity, 'sign'>, servers: string[] = DEFAULT_BLOSSOM_SERVERS, delaysMs = [3_000, 10_000]) {
  return async (bytes: Uint8Array): Promise<{ url: string; sha256: string }> => {
    const sha256 = await sha256Hex(bytes)
    const { url } = await putBlobWithRetry(servers, new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), {
      sha256,
      mime: 'application/octet-stream',
      name: 'snapshot',
      sign: (ev) => identity.sign(ev),
      delaysMs,
    })
    return { url, sha256 }
  }
}

let trackingUnshared = false

/**
 * The game's asset resolver: uploads are signed by this identity, encrypted, and retried.
 * Unfinished uploads are remembered across reloads so the GM's next start sends them again.
 */
export function gameAssets(identity: Pick<Identity, 'sign'>): AssetResolver {
  if (!trackingUnshared) { trackingUnshared = true; trackUnshared() }
  return createAssetResolver({
    libraryBase: import.meta.env.BASE_URL + 'library/',
    blossomServers: blossomList(),
    uploader: { sign: (ev) => identity.sign(ev) },
  })
}

function finish(opts: {
  connection: GameConnection
  identity: Identity
  assets: AssetResolver
  displayName: string
  pack: PackChoice
  notice?: string
}): Promise<StartedGame> {
  return rulesForChoice(opts.pack, opts.assets, import.meta.env.BASE_URL).then(({ rules, error }) => {
    // A third-party pack that fails to load leaves the table usable without rules; say why.
    const packNotice = error && (opts.pack.source || opts.pack.asset) ? `The game's system pack could not load, so sheets and skills are off. ${error}` : undefined
    if (packNotice) opts.notice = opts.notice ? `${opts.notice} ${packNotice}` : packNotice
    const controller = createController({ connection: opts.connection, rules, assets: opts.assets, displayName: opts.displayName, pubkey: opts.identity.pubkey })
    let stopSnapshots = () => {}
    // Snapshot pointers live in the founder's manifest, so only the founder runs the loop; a co-GM's
    // edits reach late joiners as deltas on top of the founder's latest snapshot.
    if (opts.connection.isGm && opts.connection.role === 'gm') {
      const loop = createSnapshotLoop(opts.connection, {
        upload: snapshotUploader(opts.identity, blossomList()),
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
  const assets = gameAssets(identity)

  if (start.mode === 'create') {
    const connection = await createGame({ relays: relayList(), identity, name: start.name })
    const meta: GameMeta = {
      name: start.name,
      gm: identity.pubkey,
      pack: start.packId as PackId,
      activeScene: null,
      createdAt: Date.now(),
      ...(start.packSource ? { packSource: start.packSource } : {}),
      ...(start.packAsset ? { packAsset: start.packAsset } : {}),
    }
    const m = metaOf(connection)
    connection.doc.transact(() => { for (const [k, v] of Object.entries(meta)) m.set(k, v) })
    remember(connection, { name: start.name, pack: start.packId, displayName: start.displayName })
    return finish({ connection, identity, assets, displayName: start.displayName, pack: packChoiceOf(meta, start.packId) })
  }

  if (start.mode === 'join') {
    const info = parseInvite(start.invite)
    if (!info) throw new Error('That is not a valid invite link.')
    const connection = await joinGame({ relays: info.relays.length ? info.relays : relayList(), identity, gameId: info.gameId, gameKey: info.gameKey, gm: info.gm, isGm: false })
    const m = metaOf(connection)
    const packId = (m.get('pack') as string | undefined) ?? 'mausritter'
    remember(connection, { name: (m.get('name') as string | undefined) ?? '', pack: packId, displayName: start.displayName })
    return finish({ connection, identity, assets, displayName: start.displayName, pack: packChoiceOf(m.toJSON() as Partial<GameMeta>, packId) })
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
  return finish({ connection, identity, assets, displayName, pack: packChoiceOf(m.toJSON() as Partial<GameMeta>, packId), notice })
}

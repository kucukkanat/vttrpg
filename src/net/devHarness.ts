/**
 * Dev harness: a GM and a player with two throwaway keys in one tab, logging
 * the doc as it syncs. Not imported by the app. From the browser console:
 *
 *   const h = await import('/src/net/devHarness.ts'); await h.runDevHarness()
 *   await h.runDevHarness({ inMemory: true })   // no network, FakeRelay
 *
 * Returns both connections so you can poke at `gm.doc` / `player.doc`.
 */
import { generateSecretKey } from 'nostr-tools'
import type { GameId } from '@/core/ids'
import { DEFAULT_RELAYS, createGame, joinGame, parseInvite } from './impl'
import { localIdentity } from './identity'
import { fetchManifest, openConnection } from './connection'
import { randomGameKey, type Manifest } from './codec'
import { StatusTracker } from './pool'
import { FakePool, FakeRelay } from './testing'
import type { GameConnection } from './index'

export interface HarnessOptions {
  relays?: string[]
  /** Use the in-memory FakeRelay instead of public relays. */
  inMemory?: boolean
  log?: (...args: unknown[]) => void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runDevHarness(opts: HarnessOptions = {}): Promise<{ gm: GameConnection; player: GameConnection; invite: string }> {
  const log = opts.log ?? ((...a: unknown[]) => console.log('[net harness]', ...a))
  const relays = opts.relays ?? DEFAULT_RELAYS
  const gmId = localIdentity(generateSecretKey())
  const playerId = localIdentity(generateSecretKey())
  log('gm', gmId.pubkey.slice(0, 12), 'player', playerId.pubkey.slice(0, 12), opts.inMemory ? '(in-memory relay)' : relays)

  let gm: GameConnection
  let player: GameConnection
  let invite: string

  if (opts.inMemory) {
    const relay = new FakeRelay({ async: true })
    const gameId = crypto.randomUUID() as GameId
    const gameKey = randomGameKey()
    const manifest: Manifest = { name: 'Harness', gm: gmId.pubkey, relays }
    gm = await openConnection({ relays, identity: gmId, gameId, gameKey, isGm: true, pool: new FakePool(relay), tracker: new StatusTracker(relays, 0), manifest, fresh: true, log })
    invite = gm.inviteLink()
    const pool = new FakePool(relay)
    const found = await fetchManifest(pool, relays, gameKey, gameId)
    player = await openConnection({ relays, identity: playerId, gameId, gameKey, isGm: false, pool, tracker: new StatusTracker(relays, 0), manifest: found.manifest, log })
  } else {
    gm = await createGame({ relays, identity: gmId, name: 'Harness' })
    invite = gm.inviteLink()
    const info = parseInvite(invite)
    if (!info) throw new Error('harness: invite did not parse')
    log('invite', invite)
    player = await joinGame({ relays: info.relays, identity: playerId, gameId: info.gameId, gameKey: info.gameKey, isGm: false })
  }

  gm.onStatus((s) => log('gm status', s))
  player.onStatus((s) => log('player status', s))
  player.doc.on('update', () => log('player doc', JSON.stringify(player.doc.getMap('meta').toJSON())))
  gm.onIntent((i) => {
    log('gm got intent', i.intent.type, 'from', i.from.slice(0, 12))
    if (i.intent.type === 'chat.say') gm.doc.getArray('chat').push([{ from: i.from, text: i.intent.text }])
  })
  gm.onPresence((p) => log('gm sees presence', p.name, p.cursor))

  gm.doc.getMap('meta').set('name', 'Harness game')
  gm.doc.getMap('meta').set('createdAt', Date.now())
  await sleep(1500)
  player.sendIntent({ id: crypto.randomUUID(), from: playerId.pubkey, at: Date.now(), intent: { type: 'chat.say', text: 'hello from the player' } })
  player.publishPresence({ pubkey: playerId.pubkey, name: 'Player', color: '#f80', scene: null, cursor: { x: 1, y: 0, z: 2 }, lastSeen: Date.now() })
  await sleep(1500)
  log('gm chat', gm.doc.getArray('chat').toJSON(), 'player chat', player.doc.getArray('chat').toJSON())
  log('in sync:', JSON.stringify(gm.doc.toJSON()) === JSON.stringify(player.doc.toJSON()))
  return { gm, player, invite }
}

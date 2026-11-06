# `src/net` — sync over Nostr

No backend. Every message is a Nostr event on public relays, encrypted with a per-game
32-byte symmetric key that only travels inside the invite link. The GM client is the sole
authority: players send intents, the GM applies them to the Yjs doc and publishes deltas.

## Files

| File | Role |
|---|---|
| `index.ts` | Contract used by the rest of the app |
| `impl.ts` | `loadIdentity`, `parseInvite`, `createGame`, `joinGame`, `DEFAULT_RELAYS` |
| `codec.ts` | Pure: kinds, tags, NIP-44 under the game key, chunking, invite format |
| `identity.ts` | NIP-07 extension if present, else a local key in `localStorage` (`vttrpg.nostr.secret`); `?as=<name>` dev profiles |
| `pool.ts` | `RelayPool`: one socket per relay, exponential backoff, subscriptions re-attached on (re)connect; `StatusTracker` |
| `localStore.ts` | IndexedDB copy of each game (doc update + manifest) so a device is self-sufficient |
| `connection.ts` | `GameConnection`: manifest, deltas, intents, presence, snapshots |
| `snapshots.ts` | `startSnapshotLoop`: GM-side periodic snapshot upload + manifest pointer, event pruning |
| `testing.ts` | In-memory relay/pool for tests and the dev harness |
| `devHarness.ts` | GM + player in one tab, logs the doc syncing |

## Event kinds

| Kind | Type | Author | Tags | Content (all NIP-44 v2, game key as conversation key) |
|---|---|---|---|---|
| `30078` | parameterized replaceable | GM | `d`=gameId, `t`=`vttrpg` | JSON `{ name, gm, relays, snapshot?: { url, sha256, at } }` |
| `1078` | regular | GM only | `a`=`30078:<gm>:<gameId>`, `g`=gameId, optional `chunk`=`i/n` + `batch`=id | base64 of one Yjs update (or one chunk of it) |
| `21078` | ephemeral | players | `g`=gameId | JSON `IntentEnvelope`; `from` is overwritten with the event signer |
| `21079` | ephemeral | everyone | `g`=gameId | JSON `Presence`; `pubkey` is overwritten with the signer; throttled to 10/s |

Receivers ignore `1078` events whose author is not the GM, and dedupe every kind by event id.

## Encryption

`nip44.v2.encrypt(plaintext, gameKey)` with the raw 32-byte game key as the conversation key
(no ECDH). NIP-44 is authenticated, so a manifest that decrypts under the key *and* whose
`gm` matches the event author is the game; that is how `joinGame` finds it by `#d` without
knowing the GM in advance. Binary payloads are base64 before encryption.

## Chunking

Updates over `CHUNK_BYTES` (30 KiB raw) are split across events sharing a `batch` id with
`chunk i/n` tags, reassembled by `Reassembler` once all parts arrive; incomplete batches
are dropped after 5 minutes. 30 KiB raw -> ~54 KB encrypted, under the 64 KB message limit
of most relays and NIP-44's 65 535-byte plaintext cap. Players never publish deltas.

## Join sequence

1. Fetch manifest (`kinds:[30078] #d #t`), decrypt with the key, newest wins.
2. If it has `snapshot`: download, verify sha256, `Y.applyUpdate`; replay `since = at`.
   On any failure fall back to a full replay.
3. Subscribe to `1078` from the GM, buffer until EOSE, sort by `created_at`, apply, go live.
4. GM only: subscribe to `21078` intents. Everyone: subscribe to `21079` presence.
5. GM: `publishSnapshotPointer(url, sha256)` republishes the manifest after uploading `snapshot()`.

## Snapshot loop (GM)

`startSnapshotLoop(connection, { upload, prune })` runs on the GM client. Every 2 minutes, if
the doc changed since the last snapshot, or at once when 200 local updates piled up, it encodes
`snapshot()`, hands the bytes to the injected `upload(bytes) -> { url, sha256 }` (the UI wires
this to Blossom through `src/assets`), then calls `publishSnapshotPointer`. On every tick it
also passes `{ type: 'event.prune', before: now - 2 min }` to `prune` (the controller's
dispatch). Failures log and retry next tick; nothing throws. Returns a stop function.
`createSnapshotLoop` returns the same with `flush()` and counters for tests.

## Returning GM

`joinGame({ ..., isGm: true })` with the GM's own identity restores the local copy (or replays
snapshot + deltas like a player), and only then attaches the local-update publisher and the
intent subscription, so nothing replayed is re-sent. `isGm` on the connection is only true when the manifest's `gm`
matches the identity; any other identity asking for `isGm: true` gets a player connection.
The UI (`src/ui/bootstrap.ts`, mode `rejoin`) additionally checks `meta.gm` in the restored doc.

## Relay pool

`RelayPool` replaces `SimplePool`, which opened a new socket for every publish or subscribe to a
relay that was not connected and never retried a relay whose first connect failed; with presence
at 10/s that was a storm of half-open sockets. The pool keeps exactly one connection attempt per
relay at a time (20 s connect timeout), retries with exponential backoff (1 s doubling to 60 s,
±20 % jitter, reset on a successful open), publishes only to open relays (the rest reject at
once), and (re)attaches every open subscription when a relay comes up, with
`since = lastEmitted + 1` after a drop. A subscription's `oneose` fires once every relay that
was open at subscribe time has answered, or after `maxWait` when none was. Built-in ping and
reconnect of nostr-tools' `Relay` are off. `pool.onOpen(cb)` reports each opened socket.

## Local copy

With `local` (default: the app-wide IndexedDB store `vttrpg-games`), every connection writes the
whole doc (debounced 500 ms, plus on close) and the decrypted manifest per game id. On open the
local copy is applied first and the connection resolves at once (`hasLocalCopy`), the relay
replay of deltas since the saved `lastDeltaAt` runs behind it. `joinGame` uses the local manifest
when there is one (for a GM only if its `gm` is this identity), so a GM device never depends on
a relay having kept the manifest; `createGame` retries the manifest publish with backoff for up
to 20 s until one relay accepts, logs which relays did, and otherwise continues with the local
copy. The GM republishes the manifest (with the current snapshot pointer) whenever a relay opens
and on a 30 s check for open relays that have not accepted it.

## Status

`connecting` until one relay is open, `connected` while any is, `offline` when all drop or
all initial attempts fail (the pool keeps retrying; status goes back to `connected` when a relay
comes up). `connection.relayCount` is the number of relays
with an open socket right now and `connection.relays` the list it was opened with.

## Invite link

```
<origin><base>#/join/<naddr>?k=<base64url 32-byte game key>
```

`naddr` = `nip19.naddrEncode({ kind: 30078, pubkey: gm, identifier: gameId, relays })`.
The key lives in the fragment, so it is never sent to the host. `parseInvite` also accepts
just the fragment or a bare `naddr1...?k=...`.

## Testing with two identities

One browser normally has one identity: the local secret key under `vttrpg.nostr.secret`
(or the NIP-07 extension). To play a GM and a player in two tabs of the same browser, open
the second tab with a **profile**:

```
http://localhost:5173/?as=player1#/join/naddr1...?k=...
http://localhost:5173/#/join/naddr1...?k=...&as=player1
```

`as=<name>` (`[A-Za-z0-9_-]{1,32}`, page query wins over hash query) makes `loadIdentity`
persist and read that tab's key under `vttrpg.nostr.secret.<name>` and skip the extension.
`currentProfile()` and `profileSuffix()` (`.<name>` or `''`) are exported from `@/net` for
anything else that should be per identity.

Flow: GM tab `New game` → copy the invite link (or `window.__vtt.connection.inviteLink()` in
dev) → second tab with `?as=player1` before the `#` → `Join`. The join page shows the active
profile and never auto-rejoins with the device's saved role.

Limits: the games registry (`vttrpg.games`) and the IndexedDB local copy are shared across
profiles. A profile tab therefore always joins fresh from the invite link (the join page puts
the default identity's registry entry back afterwards), and its "Your games" list is the
default identity's. Its presence name is whatever was typed on the join page; the Players panel
labels the tab itself with the profile name. Because the local copy is shared, a profile tab
opens the doc from IndexedDB at once; live deltas, intents and presence still go over the relays.

## Known limits

- A player who misses a delta keeps it as a Yjs pending struct until a snapshot catches them up.
- NIP-07 identities cannot derive `conversationKey`; nothing in sync needs it.

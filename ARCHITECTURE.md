# Architecture notes for contributors

Read `PLAN.md` first. This file covers module boundaries.

## Modules

| Folder | Owns | May import |
|---|---|---|
| `src/core` | Shared types and ids only. No runtime deps. | nothing |
| `src/net` | Nostr identity, rooms, NIP-44, Yjs provider, presence, intents transport | core, yjs, nostr-tools |
| `src/assets` | Content-addressed asset resolver, IndexedDB cache, Blossom | core |
| `src/rules` | Pack loader, expression DSL, dice resolution, chargen, skills | core, dice/fair |
| `src/dice` | `fair.ts` (pure commit/reveal + seeded dice), `DiceTray` (R3F + Rapier) | core, three, r3f |
| `src/table` | Everything inside `<Canvas>`: scene loader, grid, tokens, cameras, lighting, fog, VFX | core, state, three, r3f, drei |
| `src/state` | Zustand mirror of the Yjs doc + local UI state | core, yjs, zustand |
| `src/ui` | App shell, panels, sheet renderer host, chat | everything above via `index.ts` |

Each module exposes its contract in `index.ts`. Other modules import only from `@/module`, never from
inner files. Stubs throw `not implemented` until the owning branch lands.

## Rules for parallel work

- One branch per module. Do not edit another module's folder; if you need a contract change, change
  `src/core` or the module's `index.ts` minimally and call it out in your summary.
- Keep `npm run typecheck` green on your branch.
- Unit tests with Vitest next to the code (`*.test.ts`). Pure code (dice, rules, net encoding) must
  have tests.
- No new dependencies without a one-line justification in the commit message.
- Public assets go in `public/library/` (small, CC0 only, with a `LICENSE` note per folder).

## Conventions

- TypeScript strict. Named exports. No default exports except where a framework requires one.
- Ids are branded (`src/core/ids.ts`). Cast at the boundary where ids enter (network, files).
- World units are meters. Grid cell size per scene. +Y up. Blender exports with +Y up.
- Nostr pubkeys are hex, not npub, inside the app.

## What players can read

The game document is one Yjs doc, and every delta is NIP-44 encrypted under the single game key
that travels in the invite link (`src/net/README.md`). Every invited player therefore decrypts
**the whole document**. "GM only" is a UI rule, not a cryptographic one:

- Journal notes with `sharedWith: 'gm'` are filtered out in `JournalPanel` and `ui/notices.ts`.
- Encounters (`encounters`) and game creature templates (`creatures`) are hidden by the Prep
  panel being GM-only.
- Hidden tokens and their sheets (including monster hit points) are skipped by the table and the
  initiative names, but they are in the doc.

A player who opens the dev tools can read all of it. That is acceptable for a group that trusts
each other with spoilers, and it is what lets encounters follow the GM across devices with no
server. Do not put anything in the doc that must stay secret from players.

### GM-private section (designed, not built)

The way to make GM data truly private without a server:

1. A second Yjs doc, `gmDoc`, holding `encounters`, `creatures` and GM notes.
2. Its updates go out as kind `1078` events tagged `g` = `<gameId>:gm` (players never subscribe),
   with content NIP-44 encrypted under a key only the GM holds: the NIP-44 conversation key of the
   GM with their own pubkey (`identity.conversationKey(gm)`), or, for NIP-07 identities that cannot
   export it, `window.nostr.nip44.encrypt(gm, plaintext)` to self.
3. The GM's other devices sign in with the same identity, derive the same key and replay the
   `:gm` deltas; the local IndexedDB copy and the snapshot loop gain a second record for it.
4. Placing an encounter copies what players should see (tokens, their sheets) into the shared doc,
   as today.

It needs a second delta stream, local-copy record and snapshot pointer in `src/net`
(`connection.ts`, `localStore.ts`, `snapshots.ts`). The move of encounters into the doc keeps them
in maps of their own (`encounters`, `creatures`) and behind the `encounter.*` and `creature.*`
intents, so moving them into `gmDoc` later only changes where `applyIntent` writes those keys and
where the store reads them.
## Co-GM and handover

`PLAN.md` deferred co-GM because the GM client is the only writer and every player holds the
game key, so the key cannot say who the GM is. The design keeps one root of trust and adds
nothing a player could forge.

- **Founder.** The manifest's author, named by the invite's `naddr` pubkey. Clients pin it:
  `joinGame({ gm })` asks the relays for manifests by that author only and `readManifest`
  refuses any other signer. (Before this, the newest manifest that decrypted under the game key
  won, so any player could publish one naming themselves GM and capture new joiners.) The
  founder can never be replaced; the game's coordinate, `d` tag and invite are built from it.
- **Co-GMs.** The founder's signed manifest lists grants `{ pubkey, since, until? }`
  (`src/net/authority.ts`). A delta counts when its author is the founder, or a co-GM whose
  window covers the event's `created_at` (with 120 s of clock skew before `since`). Revoking sets
  `until`; from then on a live event from that key is refused whatever timestamp it claims, so
  a revoked co-GM cannot slip in back-dated edits on clients that were online. Earlier edits stay.
- **Who applies intents.** Every writer receives player intents; exactly one should apply them.
  Writers rank `host` (set by the founder; "hand over hosting"), then the founder, then co-GMs
  in grant order. A writer applies intents when it is the first one it sees as *established*:
  present (presence within `GM_AWAY_AFTER_MS`) for `PROCESS_GRACE_MS` (12 s, above the 10 s
  beacon) without a gap, or itself once open that long. A writer that just opened buffers
  intents during its grace and drops them at the end if it saw another writer meanwhile (that
  writer handled them). Single-writer games skip all of this.
- **Manifest updates.** Everyone follows the founder's manifest live; newer `updatedAt` wins.
  Grants, revocations, the host, relays and the snapshot pointer change without a reload. A
  client whose own role changed is asked to reopen the game; a revoked writer stops publishing
  at once.
- **What stays founder-only.** Granting, revoking, choosing the host, snapshot pointers (they
  live in the founder's manifest) and relay rotation.

Known limits: two writers can both apply an intent during a hand-over moment when their
views of each other's presence differ (one beacon's latency after a grace); the effect is a
duplicate chat line or roll, not a lost or forged one. A co-GM-hosted session adds no snapshots,
so late joiners replay the co-GM's deltas on top of the founder's last snapshot. A client that
was offline during a revocation and replays from before it applies the revoked co-GM's events
by their timestamps, so a back-dated forgery inside the old window can still reach it; the
founder's next snapshot bounds that window. A co-GM can read GM-only notes, as can anyone with
the game key (the doc is not split by role).

## Relay resilience

`RelayPool` tracks health per relay (state, failures since last open, next retry, last error,
publishes accepted and refused in a row). The founder checks every 30 s, once the relays had
20 s to come up and only while at least one relay is open (a device offline is not a relay
problem): when fewer than three relays work or are still coming up, `planRelayRotation` adds
spare relays from `RESERVE_RELAYS` (up to eight in total), and the founder republishes the
manifest with them. Players and co-GMs follow the manifest's relay list. The top bar's status
pill opens the per-relay list with a "Retry now" that skips the backoff.

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

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

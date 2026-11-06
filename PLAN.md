# VTTRPG — Plan

A browser-based, 3D virtual tabletop that works for any ruleset, from Mausritter to D&D 5e.
No backend: multiplayer runs over public Nostr relays, the app is a static site on GitHub Pages
(`kucukkanat/vttrpg`).

## Decisions

| Area | Decision |
|---|---|
| Audience | One GM and their group first; public polish later |
| Look | Immersive 3D scenes. GM picks per scene: free orbit camera or token-locked vision |
| First system | Mausritter, then D&D 5e SRD (CC content only) |
| Authority | GM client is the sole writer of committed state. Game pauses when the GM is offline |
| Stack | Vite + React + TypeScript, react-three-fiber + drei, Rapier (wasm), Zustand, Yjs, nostr-tools |
| Privacy | NIP-44 encryption per game; the game key travels in the invite link |
| Content | Blender-authored GLB scenes following a naming convention; in-app kit snapping and GLB import later |
| Minis | Static GLBs with procedural motion first; rigs and clip library later |
| Skills | Visual editor over a JSON schema. No user scripting |
| Assets | Resolver by SHA-256 over sources: local cache, Pages starter library, pasted URL, Blossom. WebRTC later |
| Devices | Desktop browsers and iPad players. WebGL2 baseline. Voice stays in Discord |
| Pace | Full-time, first real session in 2–3 weeks, foundations done properly |

## Architecture

Three layers; each is ignorant of the one above it.

1. **Table engine** (`src/table`): 3D scene, grid, tokens, cameras, lighting/fog/LoS, dice, VFX, audio.
   Knows nothing about rules.
2. **Rules engine** (`src/rules`): data-driven system packs. Attributes, resources, dice resolution,
   sheet schema, skills. Knows nothing about rendering or networking.
3. **Sync layer** (`src/net`): Nostr identity, game rooms, encryption, a Yjs document shipped as
   signed, encrypted deltas. Knows nothing about either.

Shared types live in `src/core`. The Yjs document (`GameDoc`) is the single source of truth; React
state (`Zustand`) is derived from it.

### Sync over Nostr

- A game is a parameterized replaceable event (kind 30078-style, app-specific d-tag) holding the
  encrypted manifest: name, system pack ref, relay list, GM pubkey, current snapshot pointer.
- Players publish **intents** (move token, roll dice, use skill). The GM client validates against the
  pack, applies to the Yjs doc, and publishes the resulting delta. Players apply optimistically and
  roll back on disagreement.
- **Ephemeral events** (kind 2xxxx) carry cursors, token drags, dice seeds. Never stored.
- **Snapshots**: the GM periodically uploads the full Yjs state to Blossom and points the manifest at
  it, so late joiners don't replay hours of deltas. Deltas over the relay size limit are chunked.
- **Dice fairness**: commit-reveal. Roller publishes `hash(seed)`, then `seed`. Every client derives
  the same result from the seed. Physics dice are cosmetic and nudged to land on that face.
- **Invite link** = `naddr` + game key in the URL fragment. Open it and you are in.

### Blender is the level editor

Scenes are GLBs following a naming convention read at load. An in-app validator reports what it found.

| Name / property | Meaning |
|---|---|
| `COL_*` meshes | Rapier colliders and the 2D wall set for line-of-sight; hidden after load |
| `LIGHT_*` lights | Dynamic point/spot lights; custom props `flicker`, `color_temp` |
| `SPAWN_player`, `SPAWN_<name>` empties | Token spawn points |
| `GRID` empty | Grid origin; custom props `cell_size`, `type` (`square` or `hex`) |
| `AUDIO_ambient` (scene custom prop) | Ambient track asset reference |
| `FOG_*` meshes | Regions that start hidden |

### System packs

A pack is a folder of JSON plus optional assets, loadable by URL or drag-drop:

- `pack.json`: id, name, version, grid defaults, dice syntax
- `attributes.json`, `resources.json`, `conditions.json`
- `sheet.json`: layout schema rendered by the generic sheet component
- `skills/*.json`: trigger, cost, targeting shape (single, cone, radius, line), effect rows,
  VFX timeline referencing presets by name
- `chargen.json`: creation steps (Mausritter: one-roll generator)

Mausritter first because it is small enough to finish and proves the abstraction.

### Minimal form of each immersion feature for session one

- **Lighting + fog + LoS**: Blender lights with shadows; darkness overlay revealed by token vision
  radius; LoS by CPU raycast against wall segments extracted from `COL_*`; explored areas stay dim.
- **Dice**: commit-reveal result, Rapier animation nudged to the result face.
- **Audio**: one ambient track per scene + GM soundboard, synced by a start-timestamp event.
- **VFX / weather**: one GPU particle system, presets `hit`, `projectile`, `ring`, `rain`.

## Three-week sprint

**Week 1 — foundations**
- Days 1–2: repo, Vite + R3F, Pages deploy, Nostr key or NIP-07 login, create/join via `naddr`
  with embedded key, Yjs over encrypted Nostr events, presence and cursors on ephemeral events.
- Days 3–4: GLB scene loader with Blender conventions, grid, token place/move/select, orbit and
  token-locked cameras, GM/player roles.
- Day 5: asset resolver (cache, Pages library, URL, Blossom) with IndexedDB cache; Blossom upload.

**Week 2 — Mausritter and table feel**
- Days 6–7: pack format + loader, generic sheet renderer, Mausritter pack with one-roll chargen.
- Day 8: dice with commit-reveal and Rapier animation.
- Days 9–10: lighting, fog, LoS MVP, token-locked vision.

**Week 3 — immersion and quick start**
- Day 11: audio and soundboard.
- Day 12: particle presets, skill schema v0, three Mausritter spells as data.
- Day 13: templates flow (pick system, pick scene, invite link); starter tavern and dungeon scenes.
- Day 14: iPad pass: touch controls, Draco + KTX2, texture budget.
- Day 15: playtest, fix list.

## Deferred, in order

1. Visual skill editor UI
2. In-app kit snapping editor
3. Rigged minis and shared clip library (mouse rig included)
4. Imports from Foundry, Owlbear, map images
5. GM prep tools: encounters, NPC generator, notes
6. WebRTC asset seeding; GM handover to a co-GM
7. D&D 5e SRD pack

## Risks

- **Yjs delta size vs relay limits**: chunk updates, snapshot to Blossom, keep only a pointer on the relay.
- **iPad memory**: scenes must stay under roughly 300 MB GPU memory. Compression is not optional.
- **Blender convention drift**: validator in-app plus a shared Blender template file.
- **LoS on complex meshes**: extract walls from `COL_*` only, never from visual geometry.
- **Relay churn / rate limits**: connect to 4–6 relays; GM can add a paid one. Keep events small.
- **GitHub Pages limits**: 1 GB repo, 100 MB per file. Ship a small starter library only.

# Scenes: authoring in Blender

A scene is one `.glb` exported from Blender. The table reads a naming convention at load time and
reports what it found and what is missing (`report.found / missing / warnings`).

## Export settings

- Units: metric, 1 Blender unit = 1 metre. A Mausritter cell is 1.5 m; a D&D square is 1.5 m.
- Orientation: export with **+Y up** (the glTF exporter default). The floor lies on the XZ plane,
  Blender's +Z becomes +Y. Keep the floor at height 0.
- **Apply all transforms** (Ctrl+A > All Transforms) on meshes before export, or tick
  *Apply Modifiers* and make sure parents have identity transforms. Colliders are read in world
  space, so unapplied scale on a parent is fine but unapplied *negative* scale is not.
- Include: *Custom Properties* (needed for `flicker`, `color_temp`, `cell_size`, `type`),
  *Punctual Lights*, *Cameras* off.
- Compression: Draco on. KTX2/Basis textures (`KHR_texture_basisu`, e.g. via gltf-transform
  `etc1s`/`uastc`) are supported too and are the way to stay inside the iPad texture budget.
  The Draco decoder and the Basis transcoder ship with the app (three bundles them; Vite emits
  them as lazily fetched assets), so no CDN is involved. `loadSceneModel` accepts
  `dracoDecoderPath` / `ktx2TranscoderPath` to use a CDN copy instead (`DRACO_DECODER_PATH`
  points at Google's gstatic mirror).
- Budget: keep a scene under ~50 MB on disk and ~300 MB of GPU memory (iPad).

## Naming convention

| Object | Type | Meaning |
|---|---|---|
| `COL_<anything>` | mesh | Collider. Hidden after load. Its near-vertical faces become 2D wall segments used for line-of-sight and fog. Keep these simple boxes; never rely on visual geometry for walls. A `COL_floor` slab is fine (its horizontal faces are ignored). |
| `WALL_<anything>` | mesh | Visible wall (case-insensitive prefix). The table fades these out when the camera looks down from above so a room does not read as a picture frame in orbit view. Keep them at most 0.3 m thick and give each one a matching `COL_` box; the `WALL_` mesh itself never blocks sight. |
| `LIGHT_<anything>` | light | Dynamic point/spot light. Custom properties on the light *object*: `flicker` (0..1, amplitude of the flame flicker), `color_temp` (Kelvin; overrides the light colour). The first four lights cast shadows. |
| `SPAWN_player`, `SPAWN_<name>` | empty | Token spawn points, by name. `SPAWN_player` is where new player tokens appear. |
| `GRID` | empty | World origin of grid cell (0,0). Custom properties: `cell_size` (metres), `type` (`square` or `hex`). Hex grids are pointy-top, axial coordinates, `cell_size` is the centre-to-centre spacing. |
| `FOG_<anything>` | mesh | Region that starts hidden. Hidden after load; today the whole map starts unexplored, these regions are reserved for GM-controlled reveals. |
| scene custom property `ambient_audio` | string | Asset reference (URL or `sha256:` hash) of the ambient loop for the scene. Set it on the Scene properties panel, not on an object. |

Everything else is rendered as-is with shadows on. Blender exports a light as a node (the object,
carrying the `LIGHT_` name and custom properties) with the light as its child; the loader reads
both.

## Checklist before export

1. Floor at height 0, +Y up, metres.
2. Every wall that should block sight has a `COL_` box behind it; name the visible wall `WALL_*`, no thicker than 0.3 m.
3. One `GRID` empty at the centre of the cell you want to be (0,0), with `cell_size` and `type`.
4. `SPAWN_player` placed on the floor.
5. Lights named `LIGHT_*`; torches get `flicker` and `color_temp`.
6. Export as `.glb` with custom properties and lights enabled, Draco compression on.

## Generated scenes

The starter scenes are generated, not authored, with three's `GLTFExporter` in Node:

| File | Script | What it is |
|---|---|---|
| `tavern.glb` | `scripts/make-scenes/tavern.mjs` | 12 x 9 m common room: bar, four tables with benches, fireplace (`LIGHT_fire`), three sconces, a door. `SPAWN_player` a cell inside the door, `SPAWN_barkeep` behind the counter. Square grid, `ambient_preset: tavern`. |
| `dungeon.glb` | `scripts/make-scenes/dungeon.mjs` | Entrance corridor, two side rooms, pillar hall, built from a cell map; every floor/rock edge is a `COL_` wall run. Two torches, `FOG_` over both rooms and the hall, `SPAWN_player` (+ `_2`, `_3` up the corridor), `SPAWN_enemy_rat`, `SPAWN_enemy_brute`. `ambient_preset: cave`. |
| `forest.glb` | `scripts/make-scenes/forest.mjs` | ~20 x 20 m clearing ringed by low-poly trees (vertex colours; trunks are `COL_`), a campfire (`LIGHT_campfire`), a path, boulders. Hex grid with its origin at the fire, `SPAWN_player` and `SPAWN_player_2` beside it. `ambient_preset: forest`. |
| `dev-room.glb` | `scripts/make-dev-room.mjs` | Small stone room behind `#/dev/table`: four `COL_` walls plus a pillar, two flickering torches, `FOG_east`. |

`npm run scenes` regenerates all four and rebuilds `index.json`. Shared helpers (walls, props, lights,
spawns, grid, fog, the FileReader shim the exporter needs) live in `scripts/make-scenes/lib.mjs`;
`scripts/make-scenes/scenes.test.ts` loads every file through the table's loader and checks the
convention. The quick-start templates in `src/ui/templates.ts` hardcode each scene's spawn points
and grid origin; `src/ui/templates.test.ts` cross-checks them against the generated files, so
moving a spawn in a script means updating the template too.

`ambient_preset` is a scene custom property naming one of the built-in procedural ambiences
(`src/audio`); scenes that set it leave `ambient_audio` unset.

The small models in `../props` (barrel, crate, table, chair, chest, torch stand, bed, bookshelf,
campfire, rock, cauldron, weapon rack, well) and `../minis` (mouse adventurer, rat, knight, goblin,
skeleton, wizard) come from `scripts/make-props/index.mjs` (`npm run props`), reuse the same
helpers, and each fits one 1.5 m cell standing on y = 0. Minis face +Z and have heroic
proportions (big heads, hands and weapons) so they read at one cell from the orbit camera. The
index builder tags every model with a `category` (`scene`, `prop` or `mini`) from its folder; the
token and prop pickers only list props and minis, and the Scenes panel owns `scenes/`.

### Baked diorama look

Every generated file (scenes, props, minis) is flat-coloured with its shading baked into vertex
colours, aiming at a candle-lit miniature diorama. Colours come from one `palette` in
`scripts/make-scenes/lib.mjs`: muted mid values for scenery, a few saturated accents for minis.
Right before export, `bakeDiorama` does this for every visible mesh that is neither a `COL_`/`FOG_`
helper nor emissive:

- `COLOR_0` = base colour (linear) x height gradient (0.8 at the floor to 1.05 at 2.5 m in scenes,
  or at the model's top for props and minis) x contact shadow (0.55 at y = 0 easing to 1 over the
  first 0.3 m; not on floors) x neighbour occlusion (0.78 inside another mesh's bounding box,
  easing out over a few cm), clamped, stored as **normalized unsigned-byte RGBA** (alpha 255).
- The mesh's material becomes the one shared `MeshStandardMaterial` named **`diorama`** (white,
  `vertexColors`, roughness 0.9, metalness 0).
- `uv` is dropped (nothing is textured); visible floors are subdivided (0.6 to 0.8 m squares) so the
  contact shadows under walls and furniture have vertices to land on.
- The root (glTF scene extras) gets **`style: 'diorama'`**, next to `ambient_preset` / `kind`.

Emissive meshes (flames, embers, the rat's eyes, the wizard's orb, the cauldron's brew) keep their
own material and get no vertex colours. In props and minis the baked parts are then merged into
one mesh (`<model>_model`); in scenes the named meshes stay separate, only pure dressing (table sets,
beams, floor strips, pillars, the forest path) is merged per group. Tree geometry in the forest is
shared between trees and baked once from the first tree that uses it.

## License

Files in this folder are CC0 unless a `LICENSE` file next to them says otherwise.

## Walls that fade in top-down view

Name visible wall meshes `WALL_<anything>` (case-insensitive). The table fades them to 25% opacity
while the camera looks down steeply, so rooms stay readable from above. Keep walls at most ~0.3 m
thick; `COL_*` colliders are separate and unaffected.

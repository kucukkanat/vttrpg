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
2. Every wall that should block sight has a `COL_` box behind it.
3. One `GRID` empty at the centre of the cell you want to be (0,0), with `cell_size` and `type`.
4. `SPAWN_player` placed on the floor.
5. Lights named `LIGHT_*`; torches get `flicker` and `color_temp`.
6. Export as `.glb` with custom properties and lights enabled, Draco compression on.

## Dev room

`dev-room.glb` is generated, not authored: `node scripts/make-dev-room.mjs` writes it using the same
convention (four `COL_` walls plus a pillar, a floor, two flickering `LIGHT_` torches,
`SPAWN_player`, `GRID` with `cell_size` 1.5, a `FOG_east` region). It is the scene behind
`#/dev/table`.

## License

Files in this folder are CC0 unless a `LICENSE` file next to them says otherwise.

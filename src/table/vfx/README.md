# VFX layer

Renders `GameEvent`s of kind `vfx` and scene weather inside the table `<Canvas>`. Knows nothing
about rules or networking: it reads token positions from the Zustand store and draws.

```tsx
import { VfxLayer, WeatherLayer, CameraShake, vfxBus } from '@/table/vfx'

<VfxLayer events={events} since={joinedAt} cellSize={grid.cellSize} />
<WeatherLayer kind={scene.weather ?? 'none'} bounds={{ min: [x0, floorY, z0], max: [x1, floorY + 4, z1] }} />
<CameraShake />            // or useCameraShake() inside your camera rig
```

Every event is played once (tracked by id); events with `at < since` are ignored so late joiners
do not replay history. Each `VfxCue` fires `cue.at` ms after the event arrives. Cues that reference
`target` run once per target in `event.targets`. `cue.color` tints, `cue.duration` overrides the
preset default. `sound` cues are ignored here (audio handles them).

Dev story: `#/dev/table-vfx`.

## Position references

`from` / `to` are `'source' | 'target' | 'point'`. Tokens resolve to their store position; the chest
is `0.5 * cellSize * token.scale` above the feet. `point` is `event.point`. `target` falls back to
`point` when there are no targets and `point` falls back to the first target, so a cue still plays
when a skill is cast at a tile or at a creature. Unresolvable cues are skipped, never thrown.

## Presets

| Preset | Default | Looks like | Reads |
|---|---|---|---|
| `hit` | `from: target`, 300 ms, `#ffd27a` | 56 GPU sparks burst from the chest under gravity, with a brief additive flash | `color`, `duration` |
| `projectile` | `source → target`, 300 ms, `#ffb347` | glowing bolt on a shallow arc with a 24-point trail, then a small impact burst and flash at the target (chest for tokens, ground for points) | `color`, `duration` (flight time) |
| `ring` | `from: target`, 600 ms, `#8ab4ff` | expanding ground ring (bright edge + faint fill) with a low disc of sparks; radius 2 cells, or `radius` (cells) if present on the cue | `color`, `duration`, `radius` |
| `aura` | `from: target`, 1000 ms, `#7be0a0` | 48 soft particles orbit and rise around the token with a dim body glow; fades in and out | `color`, `duration` |
| `beam` | `source → target`, 300 ms, `#8ab4ff` | bright pulsing core inside a soft glow tube, flashes at both ends, fades | `color`, `duration` |
| `shake` | 300 ms, strength 0.6 | emits `vfxBus.emit('shake', strength, durationMs)`; `CameraShake` / `useCameraShake` apply an additive decaying offset to the camera | `duration`, `strength` (0..1) |
| `rain` | `from: target`, 2000 ms | a local shower in a 5x5-cell box around the anchor that fades in and out | `color`, `duration` |
| `sound` | – | no-op here | – |

`radius` and `strength` are optional extras read loosely off the cue (they are not in `VfxCue`
yet); add them to `src/core/pack.ts` when the skill schema grows.

## Weather

`WeatherLayer({ kind, bounds, density? })` with `kind` in `none | rain | snow | embers | fog`.
All systems wrap particles inside `bounds` on the GPU, so the CPU writes a couple of uniforms per
frame. Budgets scale with floor area and are capped: rain <= 2000 streaks (+ <= 300 ground
splashes), snow <= 800 flakes, embers <= 400 sparks, fog <= 12 billboards. `density` (0..1) lowers
them further for weak devices.

- `rain`: fast falling line streaks with a slight wind slant; ring-shaped splash points on the floor.
- `snow`: slow flakes with sinusoidal sway, fading at the top and bottom of the volume.
- `embers`: rising orange sparks, flickering, cooling to red and dying near the top.
- `fog`: a few large soft sprites drifting slowly with the wind and breathing.

## vfxBus

```ts
const off = vfxBus.on('shake', (strength, durationMs) => { ... })
```

A module-level typed emitter. The table owner can subscribe to drive its own camera; the bundled
`useCameraShake({ amplitude, frequency })` does the standard thing: subtract last frame's offset,
add a decaying wobble. It coexists with OrbitControls and lerping rigs.

## Adding a preset

1. Add the name to `VfxCue.preset` in `src/core/pack.ts` (core owner) and a row to
   `PRESET_DEFAULTS` in `schedule.ts` (default color/duration, which anchors it needs). The pure
   planner then schedules and resolves it; add a case to `schedule.test.ts`.
2. Write the component under `presets/`, taking `{ effect: ScheduledEffect; onDone }`. Use
   `useLifetime(durationMs, onFrame, onDone)` for timing and `useResource` for three objects so they
   are disposed on unmount. Prefer one `Points` or instanced mesh whose motion is a function of a
   `uTime` uniform (see `Burst.tsx`); set `frustumCulled = false` on shader-driven geometry.
3. Add the case to `Effect` in `VfxLayer.tsx` and a button to `devStory.tsx`.

Keep particle counts modest (tens for one-shots, hundreds for weather). No postprocessing: glow is
faked with additive blending and soft point sprites.

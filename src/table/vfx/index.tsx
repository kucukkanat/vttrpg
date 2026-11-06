/**
 * VFX layer: renders GameEvents of kind 'vfx' as particle/mesh effects inside the table <Canvas>,
 * plus scene weather. Presets are named in `VfxCue.preset` (see src/core/pack.ts).
 *
 * Mount inside the canvas:
 *   <VfxLayer events={events} since={joinedAt} cellSize={grid.cellSize} />
 *   <WeatherLayer kind={scene.weather ?? 'none'} bounds={{ min: [...], max: [...] }} />
 *   <CameraShake />   // or call useCameraShake() in the camera rig
 */
export { VfxLayer } from './VfxLayer'
export type { VfxLayerProps } from './VfxLayer'
export { WeatherLayer } from './weather/WeatherLayer'
export type { WeatherKind, WeatherLayerProps } from './weather/WeatherLayer'
export type { WeatherBounds } from './weather/bounds'
export { vfxBus, createVfxBus } from './bus'
export type { VfxBus, VfxBusEvents } from './bus'
export { useCameraShake, CameraShake } from './shake'
export type { CameraShakeOptions, CameraShakeHandle } from './shake'
export { planEvent, resolveAnchor, splitDue, takeNewEvents, PRESET_DEFAULTS } from './schedule'
export type { Anchor, AnchorRef, ScheduledEffect, VfxEvent, VfxPreset } from './schedule'

/**
 * Table engine: everything inside the <Canvas>. Reads the store, emits intents.
 * Knows nothing about rules or Nostr.
 */
export { TableCanvas } from './TableCanvas'
export type { TableCanvasProps, TargetingProps, ViewerInfo } from './TableCanvas'
export { resolveShape, tokensInShape, tokensInRange, cellsInShape, pointInShape } from './targeting'
export type { ResolvedShape } from './targeting'
export { loadSceneModel } from './sceneLoader'
export type { LoadedScene, SceneValidationReport, WallSegment } from './sceneLoader'

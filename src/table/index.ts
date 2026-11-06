/**
 * Table engine: everything inside the <Canvas>. Reads the store, emits intents.
 * Knows nothing about rules or Nostr.
 */
export { TableCanvas } from './TableCanvas'
export type { TableCanvasProps } from './TableCanvas'
export { loadSceneModel } from './sceneLoader'
export type { LoadedScene, SceneValidationReport } from './sceneLoader'

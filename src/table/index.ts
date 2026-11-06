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
export { useTableUi, placementPoint, tableRuntime } from './tableState'
export type { TableUiState, EditPreview } from './tableState'
export {
  SNAP, SCALE_LIMITS, TOKEN_SIZE_LIMITS, IDENTITY_TRANSFORM, radToDeg, degToRad, displayDeg, normalizeDeg, roundTo, clamp,
  snapAngle, snapScale, snapTranslation, mergeOverride, resetOverride, isIdentityTransform, effectiveNodeTransform,
} from './editing'
export type { GizmoMode, NodeBase, NodeTransform } from './editing'
export { imageFrame, imageBounds, imageGridToWorld, imageWallsToWorld, imageSceneLayout, layoutForCells, imageSceneGrid, pixelsPerCell } from './imageScene'
export type { ImageFrame, ImageSceneLayout, SceneImage } from './imageScene'

/**
 * Table engine: everything inside the <Canvas>. Reads the store, emits intents.
 * Knows nothing about rules or Nostr.
 *
 * `TableCanvas` itself is not re-exported here: it pulls in three, fiber and drei, and this barrel
 * is imported by the controller, which every page loads. Import it from `@/table/TableCanvas`
 * (the shell does so with `React.lazy`), so the 3D stack stays in the game route's chunks.
 */
export type { TableCanvasProps, TargetingProps, ViewerInfo } from './TableCanvas'
export { resolveShape, tokensInShape, tokensInRange, cellsInShape, pointInShape } from './targeting'
export type { ResolvedShape } from './targeting'
export {
  autoTier, GRAPHICS_LABELS, GRAPHICS_PRESETS, GRAPHICS_TIERS, readDeviceHints, resolveTier, setGraphicsSetting, useGraphics, useGraphicsSetting,
} from './graphics'
export type { GraphicsPreset, GraphicsSetting, GraphicsTier } from './graphics'
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

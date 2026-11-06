/**
 * Map imports: turn other tools' exports into image-based scenes.
 *
 * Format coverage
 * - Universal VTT (`.dd2vtt`, `.uvtt`): image (embedded base64), size in cells, line-of-sight
 *   walls, object walls and closed portals. Map lights are ignored (token lights do the job).
 * - Foundry VTT scene export (`.json`): size, walls (`walls[].c` in canvas pixels, padding
 *   removed, divided by the grid size), darkness. The background image path in the export cannot
 *   be fetched from a browser, so the user picks the image file after the JSON. Open doors and
 *   sight-transparent walls are dropped; tiles, lights, tokens, notes and sounds are not imported.
 * - Owlbear Rodeo: there is no export format for scenes. Save the map as an image in Owlbear and
 *   add it with "+ Map image" (or `createImageScene`), giving the number of grid columns; fog
 *   and walls have to be set up on the table.
 *
 * `parseUvtt` and `parseFoundryScene` are pure (JSON in, grid-unit walls out) and unit tested;
 * `importSceneFile` is the orchestrator the Scenes panel uses.
 */
export { parseUvtt, isUvtt, decodeImage, sniffImage } from './uvtt'
export { parseFoundryScene, isFoundryScene, foundryGridSize, foundryPaddingOffset } from './foundry'
export { buildImageScene, sceneFromParsedMap, DEFAULT_DARKNESS } from './scene'
export type { ImageSceneOptions } from './scene'
export { readImageSize, createImageScene, suggestColumns } from './mapImage'
export type { ImportController, ImageSize, MapImageOptions } from './mapImage'
export { importSceneFile, parseMapFile, parseMapJson, detectMapFormat, IMPORT_EXTENSIONS } from './importSceneFile'
export type { ImportHooks, ImportResult, MapFormat } from './importSceneFile'
export type { ParsedMap, MapWall, MapPoint, MapImage } from './types'

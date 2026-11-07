/**
 * Saved groups: a selection of props (and later tokens, tiles, walls and lights) saved to the
 * Library's Saved shelf and stamped elsewhere as one piece; encounters are saved creature groups.
 * The Inspector's "Save as group" calls `saveSelectionAsGroup`.
 */
import type { GameController } from '../controller'

/** Save the current prop selection as a group on the Saved shelf; resolves to the group's id, or null when nothing is selected. */
export async function saveSelectionAsGroup(controller: GameController, name?: string): Promise<string | null> {
  void controller
  void name
  throw new Error('saveSelectionAsGroup: not implemented yet')
}

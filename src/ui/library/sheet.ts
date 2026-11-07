import { useTableLayout } from '../shell/tableLayout'
import { editOnLibraryPick } from '../shell/editMode'

/**
 * A Library card was picked: editing turns on, and on a phone the Library's sheet (which covers
 * the board) goes away so the next tap places what was picked.
 */
export function closePhoneSheet(phone: boolean): void {
  editOnLibraryPick()
  if (phone) useTableLayout.getState().set({ phone: null })
}

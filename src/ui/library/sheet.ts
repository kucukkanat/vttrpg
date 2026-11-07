import { useTableLayout } from '../shell/tableLayout'

/** On a phone the Library's sheet covers the board: put it away so the next tap places what was picked. */
export function closePhoneSheet(phone: boolean): void {
  if (phone) useTableLayout.getState().set({ phone: null })
}

/**
 * Dice choreography: attention, then yield. The dice roll and land (attention); when they settle
 * the roll toast's total pops (`DICE_SETTLED_EVENT`); after a short linger the dice get out of the
 * way. On phones they shrink into the toast, so the eye follows them to the number; elsewhere, or
 * with no toast on screen, they fade. A phone yields at once when the chat keyboard or a full sheet
 * needs the room. Pure helpers here; `DiceTrayOverlay` plays them.
 */

/** Window event fired when a roll's dice come to rest; `detail` is the roll id. */
export const DICE_SETTLED_EVENT = 'vtt:dice-settled'

/** How long settled dice stay before yielding: shorter on phones, where they cover the table. */
export const PHONE_LINGER_MS = 1200
export const YIELD_MS = 520
/** Size the dice shrink to when they fly into the toast, relative to the overlay. */
export const YIELD_SCALE = 0.12

export interface Box { left: number; top: number; width: number; height: number }

/** CSS transform that moves the overlay's centre onto the toast's centre while shrinking it. */
export function yieldTransform(overlay: Box, toast: Box, scale = YIELD_SCALE): string {
  const dx = toast.left + toast.width / 2 - (overlay.left + overlay.width / 2)
  const dy = toast.top + toast.height / 2 - (overlay.top + overlay.height / 2)
  return `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(${scale})`
}

export function announceDiceSettled(rollId: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DICE_SETTLED_EVENT, { detail: rollId }))
}

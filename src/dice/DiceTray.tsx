// TODO(dice session): Rapier dice that land on predetermined faces.
export interface DiceTrayProps {
  /** Dice to roll with their predetermined results. Changing `rollId` triggers a new roll. */
  rollId: string | null
  dice: { sides: number; value: number }[]
  onSettled?(rollId: string): void
}
export function DiceTray(_props: DiceTrayProps) {
  return null
}

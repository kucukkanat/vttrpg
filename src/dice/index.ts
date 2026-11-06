/**
 * Dice: fairness and animation.
 *  - `fair.ts`: commit/reveal helpers and deterministic dice from a seed (pure, async sha256)
 *  - `DiceTray`: R3F component that animates Rapier dice and nudges them onto the result faces
 */
export { commitSeed, newSeed, verifyCommit, diceFromSeed, parseFormula, totalFromDice, rollFromSeed } from './fair'
export type { ParsedFormula } from './fair'
export { DiceTray } from './DiceTray'
export type { DiceTrayProps } from './DiceTray'

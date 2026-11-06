/**
 * Dice: fairness and animation.
 *  - commit/reveal helpers (pure)
 *  - deterministic dice from a seed (pure, shared with rules)
 *  - <DiceTray/> R3F component that animates Rapier dice and nudges them to the result
 */
export { commitSeed, newSeed, verifyCommit, diceFromSeed, parseFormula } from './fair'
export type { ParsedFormula } from './fair'
export { DiceTray } from './DiceTray'
export type { DiceTrayProps } from './DiceTray'

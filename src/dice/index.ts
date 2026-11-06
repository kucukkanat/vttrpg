/**
 * Dice: fairness and animation.
 *  - `fair.ts`: commit/reveal helpers and deterministic dice from a seed (pure, async sha256)
 *  - `DiceTray`: R3F component (mount inside a `<Canvas>`) that pre-simulates a Rapier throw
 *    seeded by `rollId` and plays it back with the committed values on top
 *  - `DiceTrayOverlay`: the same in its own transparent `<Canvas>`, as a HUD layer
 *
 * The two components are not re-exported here: they pull in three, fiber and rapier, and this
 * barrel is imported by the controller and the panels, which every page loads. Import them from
 * `@/dice/DiceTray` and `@/dice/DiceTrayOverlay` (the shell does so with `React.lazy`).
 */
export { commitSeed, newSeed, verifyCommit, diceFromSeed, parseFormula, totalFromDice, rollFromSeed } from './fair'
export type { ParsedFormula } from './fair'
export type { DiceTrayProps } from './DiceTray'
export type { DiceTrayOverlayProps } from './DiceTrayOverlay'
export { DEFAULT_SCHEME, IVORY_SCHEME, OBSIDIAN_SCHEME } from './atlas'
export type { DiceColorScheme, DieColors } from './atlas'
export type { DieType } from './geometry'

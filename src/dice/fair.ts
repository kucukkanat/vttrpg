// TODO(dice session): implement. Must be deterministic and dependency-free (used by rules too).
export interface ParsedFormula {
  terms: { count: number; sides: number; keep?: 'highest' | 'lowest'; keepN?: number }[]
  modifier: number
  raw: string
}
export function newSeed(): string { throw new Error('dice: not implemented') }
export async function commitSeed(_seed: string): Promise<string> { throw new Error('dice: not implemented') }
export async function verifyCommit(_seed: string, _commit: string): Promise<boolean> { throw new Error('dice: not implemented') }
export function parseFormula(_formula: string): ParsedFormula { throw new Error('dice: not implemented') }
/** Returns one value per die, in formula order, derived from the seed via a CSPRNG-seeded PRNG. */
export function diceFromSeed(_formula: ParsedFormula, _seed: string): { sides: number; value: number }[] {
  throw new Error('dice: not implemented')
}

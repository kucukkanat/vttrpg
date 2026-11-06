import { describe, expect, it } from 'vitest'
import { OUTCOME_TOAST_MAX, outcomeToastText } from './SkillsPanel'

describe('outcomeToastText', () => {
  it('shows the first line alone when there is only one', () => {
    expect(outcomeToastText(['Pip attacks Rat.'])).toBe('Pip attacks Rat.')
    expect(outcomeToastText([])).toBe('')
  })
  it('appends the effect line over the flavour line when both fit', () => {
    expect(outcomeToastText(['Pip attacks Rat.', 'rolls damage: 3 [3].', 'Rat takes 3 damage (HP 3 to 0).']))
      .toBe('Pip attacks Rat. Rat takes 3 damage (HP 3 to 0).')
    expect(outcomeToastText([
      'Nettle spends 1 Willpower on Magic Missile.', 'Nettle rolls power: 6 [4].',
      'Bramble takes 6 damage (Hit Protection 1 to 0), Hit Protection depleted.', 'The missile finds Bramble; armor is no help.',
    ])).toBe('Nettle spends 1 Willpower on Magic Missile. Bramble takes 6 damage (Hit Protection 1 to 0), Hit Protection depleted.')
    expect(outcomeToastText(['Pip lays a paw on Rat.', 'Rat is now Frightened.'])).toBe('Pip lays a paw on Rat. Rat is now Frightened.')
  })
  it('falls back to the last line when no effect line exists', () => {
    expect(outcomeToastText(['Fireball hits no one.', 'rolls power: 5 [2, 3].', 'The fireball gutters out.']))
      .toBe('Fireball hits no one. The fireball gutters out.')
  })
  it('falls back to the first line when the pair would be too long', () => {
    const long = 'x'.repeat(OUTCOME_TOAST_MAX)
    expect(outcomeToastText(['Pip attacks Rat.', long])).toBe('Pip attacks Rat.')
  })
})

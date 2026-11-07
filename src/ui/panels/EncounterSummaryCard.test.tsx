import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { EncounterSummary } from '@/core/doc'
import type { TokenId } from '@/core/ids'
import { EncounterSummaryCard } from './EncounterSummaryCard'

const summary: EncounterSummary = {
  rounds: 3,
  rows: [
    { token: 'pip' as TokenId, name: 'Pip', dealt: 7, taken: 2, healed: 0, kos: 1 },
    { token: 'spy' as TokenId, name: 'Spy', hidden: true, dealt: 0, taken: 7, healed: 0, kos: 0, down: true },
  ],
}

describe('EncounterSummaryCard', () => {
  it('lists every combatant for the GM with the down mark', () => {
    const html = renderToStaticMarkup(<EncounterSummaryCard summary={summary} isGm />)
    expect(html).toContain('Encounter over · 3 rounds')
    expect(html).toContain('<td>7</td>')
    expect(html).toContain('Spy')
    expect(html).toContain('class="down"')
  })
  it('leaves hidden combatants out for players', () => {
    const html = renderToStaticMarkup(<EncounterSummaryCard summary={summary} isGm={false} />)
    expect(html).toContain('Pip')
    expect(html).not.toContain('Spy')
  })
})

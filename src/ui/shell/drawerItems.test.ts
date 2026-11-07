import { describe, expect, it } from 'vitest'
import { PANELS } from '../panels/registry'
import { drawerButtonLabel, drawerItems, encountersState, journalState, playersState, soundState } from './drawerItems'
import { fogButtonTitle, fogToolAvailable, isFogTool } from './fogTool'

describe('GM drawer live states', () => {
  it('says what plays, who is here and what is new', () => {
    expect(soundState(0)).toBe('')
    expect(soundState(2)).toBe('2 playing')
    expect(playersState(0)).toBe('nobody yet')
    expect(playersState(3)).toBe('3 here')
    expect(journalState(0)).toBe('')
    expect(journalState(1)).toBe('1 new')
  })

  it('names a lone encounter as ready and counts several', () => {
    expect(encountersState([])).toBe('')
    expect(encountersState([{ name: 'Ambush' }])).toBe('Ambush ready')
    expect(encountersState([{ name: '  ' }])).toBe('Encounter ready')
    expect(encountersState([{ name: 'Ambush' }, { name: 'Rats' }, { name: 'Boss' }])).toBe('3 saved')
  })

  it('holds the seven items in order, each a GM registry panel', () => {
    const items = drawerItems({ playing: 2, here: 3, journalNew: 1, encounters: [{ name: 'Ambush' }] })
    expect(items.map((i) => i.label)).toEqual(['Sound', 'Players', 'Journal', 'Tables', 'NPC', 'Encounters', 'Credits'])
    expect(items.map((i) => i.state)).toEqual(['2 playing', '3 here', '1 new', '', '', 'Ambush ready', ''])
    for (const it of items) expect(PANELS.some((p) => p.id === it.panel), it.panel).toBe(true)
    for (const id of ['tables', 'npc', 'encounters', 'scene-switcher']) expect(PANELS.find((p) => p.id === id)?.scope, id).toBe('gm')
  })

  it('marks the button only while something new waits', () => {
    const quiet = drawerItems({ playing: 1, here: 2, journalNew: 0, encounters: [] })
    expect(quiet.some((i) => i.attention)).toBe(false)
    expect(drawerButtonLabel(quiet)).toMatch(/^GM drawer: sound, players/)
    const news = drawerItems({ playing: 0, here: 0, journalNew: 2, encounters: [] })
    expect(drawerButtonLabel(news)).toBe('GM drawer: Journal 2 new')
  })
})

describe('the fog brush on the tool rail', () => {
  it('is offered to the GM only', () => {
    expect(fogToolAvailable(true)).toBe(true)
    expect(fogToolAvailable(false)).toBe(false)
  })

  it('knows the fog tools and says what the brush does', () => {
    expect(isFogTool('fog-reveal')).toBe(true)
    expect(isFogTool('fog-hide')).toBe(true)
    expect(isFogTool('wall')).toBe(false)
    expect(isFogTool(null)).toBe(false)
    expect(fogButtonTitle('fog-reveal')).toContain('revealing')
    expect(fogButtonTitle(null)).toContain('Fog of war')
  })
})

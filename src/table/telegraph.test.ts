import { describe, expect, it } from 'vitest'
import type { TokenId } from '@/core/ids'
import type { ConditionDef } from '@/core/pack'
import { HELP, HOSTILE, MINE } from '@/ui/theme/palette'
import { dashSegments, hitSummary, sawtooth, sides, skillIntent, targetingOutcome, targetingWarnings, telegraphKind, telegraphStyle } from './telegraph'

const t = (s: string) => s as TokenId
const conditions: ConditionDef[] = [
  { id: 'blessed', name: 'Blessed', description: '', category: 'buff' },
  { id: 'prone', name: 'Prone', description: '', category: 'control' },
]

describe('skill intent', () => {
  it('reads harm from damage, saves and harmful conditions; help from heals and buffs', () => {
    expect(skillIntent([{ kind: 'damage', formula: '1d6', resource: 'hp' }])).toBe('harm')
    expect(skillIntent([{ kind: 'roll', formula: 'd20', vs: 'dc' }])).toBe('harm')
    expect(skillIntent([{ kind: 'heal', formula: '1d8', resource: 'hp' }])).toBe('help')
    expect(skillIntent([{ kind: 'condition', add: ['blessed'] }], conditions)).toBe('help')
    expect(skillIntent([{ kind: 'condition', add: ['prone'] }], conditions)).toBe('harm')
    expect(skillIntent([{ kind: 'message', text: 'hi' }])).toBe('neutral')
  })
})

describe('telegraph style', () => {
  it('keys colour to the owner and what the effect does', () => {
    expect(telegraphKind('harm', true)).toBe('mine')
    expect(telegraphKind('harm', false)).toBe('hostile')
    expect(telegraphKind('help', false)).toBe('help')
    expect(telegraphStyle('mine', { staged: false, dimmed: false }).color).toBe(MINE)
    expect(telegraphStyle('hostile', { staged: false, dimmed: false })).toMatchObject({ color: HOSTILE, teeth: true, fill: 'hatch', badge: '!' })
    expect(telegraphStyle('help', { staged: false, dimmed: false })).toMatchObject({ color: HELP, fill: 'plus', badge: '+' })
  })
  it('is dashed while aiming, solid and darker once staged, fainter when it is not the caster\'s turn', () => {
    const aim = telegraphStyle('mine', { staged: false, dimmed: false })
    const staged = telegraphStyle('mine', { staged: true, dimmed: false })
    const dim = telegraphStyle('mine', { staged: true, dimmed: true })
    expect([aim.dashed, staged.dashed]).toEqual([true, false])
    expect(staged.fillOpacity).toBeGreaterThan(aim.fillOpacity)
    expect(dim.fillOpacity).toBeLessThan(staged.fillOpacity)
    expect(dim.rimOpacity).toBeLessThan(staged.rimOpacity)
  })
})

describe('outcome summary', () => {
  it('counts enemies and allies relative to the caster', () => {
    expect(hitSummary('harm', 3, 1)).toBe('hits 3 enemies, 1 ally')
    expect(hitSummary('harm', 1, 0)).toBe('hits 1 enemy')
    expect(hitSummary('harm', 0, 2)).toBe('hits 2 allies')
    expect(hitSummary('help', 0, 2)).toBe('heals 2 allies')
    expect(hitSummary('harm', 0, 0)).toBe('hits no one')
  })
  it('splits sides by player character, skipping the caster', () => {
    const pc = new Set(['pip', 'bramble'])
    expect(sides([t('pip'), t('rat'), t('bramble')], t('pip'), (id) => pc.has(id))).toEqual({ allies: ['bramble'], enemies: ['rat'] })
    expect(sides([t('pip'), t('rat')], t('rat'), (id) => pc.has(id))).toEqual({ allies: [], enemies: ['pip'] })
  })
  it('flags friendly fire on the bar and warns before casting', () => {
    const pc = new Set(['pip', 'bramble'])
    const facts = { source: t('pip'), shape: { kind: 'radius', range: 6, radius: 2 } as const, intent: 'harm' as const, isPlayerCharacter: (id: TokenId) => pc.has(id) }
    expect(targetingOutcome(facts, [t('rat'), t('bramble')])).toEqual({ text: 'hits 1 enemy, 1 ally', tone: 'ff' })
    expect(targetingWarnings(facts, [t('rat'), t('bramble')], (id) => id.toUpperCase())).toEqual(['Friendly fire: BRAMBLE'])
    // GM's goblin targets a player: no friendly fire, the old player-character warning stays.
    const gm = { ...facts, source: t('goblin') }
    expect(targetingWarnings(gm, [t('pip')], (id) => id)).toEqual(['pip is a player character'])
    // Heals never warn.
    expect(targetingWarnings({ ...facts, intent: 'help' }, [t('bramble')], (id) => id)).toEqual([])
    expect(targetingOutcome({ ...facts, shape: { kind: 'self' } }, [])).toBeNull()
  })
})

describe('rim geometry', () => {
  const square = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
  it('dashes a closed outline with gaps', () => {
    const d = dashSegments(square, 1, 1)
    expect(d.length).toBe(8) // 16 units of perimeter, a dash every 2
    const drawn = d.reduce((n, [a, b]) => n + Math.hypot(b.x - a.x, b.y - a.y), 0)
    expect(drawn).toBeCloseTo(8)
  })
  it('puts sawtooth peaks outside the outline whatever its winding', () => {
    for (const pts of [square, [...square].reverse()]) {
      const z = sawtooth(pts, 1, 0.3)
      expect(z.length % 2).toBe(0)
      const peaks = z.filter((_, i) => i % 2 === 1)
      for (const p of peaks) expect(p.x < -1e-6 || p.x > 4 + 1e-6 || p.y < -1e-6 || p.y > 4 + 1e-6).toBe(true)
    }
  })
})

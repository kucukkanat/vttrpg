import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TokenId } from '@/core/ids'
import type { ConditionDef } from '@/core/pack'
import { CONDITION_PALETTE, HP_BAND_COLORS, UNKNOWN_CONDITION_COLOR } from '@/table/tokenHud'
import { conditionStyle, costBadges, hpMeter, rangePreviewFor, reachCells, resourceAbbr } from './barVisuals'
import { isIconName, resolveIcon, SKILL_ICON_NAMES } from './skillIcons'

describe('hp meter', () => {
  it('uses pips up to twelve points and a bar beyond', () => {
    expect(hpMeter(3, 4)).toMatchObject({ mode: 'pips', pips: 4, lit: 3, band: 'high', color: HP_BAND_COLORS.high })
    expect(hpMeter(12, 12).mode).toBe('pips')
    expect(hpMeter(10, 40)).toMatchObject({ mode: 'bar', pips: 0, lit: 0, fraction: 0.25, band: 'low' })
  })
  it('clamps current into 0..max', () => {
    expect(hpMeter(-2, 5)).toMatchObject({ lit: 0, fraction: 0, band: 'low' })
    expect(hpMeter(9, 5)).toMatchObject({ lit: 5, fraction: 1 })
  })
  it('colours by band', () => {
    expect(hpMeter(2, 6).color).toBe(HP_BAND_COLORS.mid)
  })
})

describe('cost badges', () => {
  it('abbreviates resource names', () => {
    expect(resourceAbbr('Hit points')).toBe('HP')
    expect(resourceAbbr('Hit Protection')).toBe('HP')
    expect(resourceAbbr('1st-level slot')).toBe('LS1')
    expect(resourceAbbr('Willpower')).toBe('WIL')
    expect(resourceAbbr('WIL')).toBe('WIL')
    expect(resourceAbbr('Pips')).toBe('PIPS')
  })
  it('draws small literal amounts as dots and the rest as text', () => {
    const names: Record<string, string> = { wil: 'WIL', hp: 'Hit points' }
    const labelOf = (id: string) => names[id] ?? id
    const b = costBadges({ cost: [{ resource: 'wil', amount: '1' }, { resource: 'hp', amount: '5' }, { resource: 'hp', amount: 'level' }] }, labelOf)
    expect(b).toEqual([
      { amount: '1', dots: 1, tag: 'WIL', title: '1 WIL' },
      { amount: '5', dots: null, tag: 'HP', title: '5 Hit points' },
      { amount: 'level', dots: null, tag: 'HP', title: 'level Hit points' },
    ])
    expect(costBadges({}, labelOf)).toEqual([])
  })
})

describe('range preview', () => {
  it('reaches the skill range, zero for self', () => {
    expect(reachCells({ kind: 'self' })).toBe(0)
    expect(reachCells({ kind: 'single', range: 12 })).toBe(12)
    expect(reachCells({ kind: 'cone', range: 3, angle: 53 })).toBe(3)
    expect(rangePreviewFor({ target: { kind: 'radius', range: 24, radius: 4 } }, 't1' as TokenId)).toEqual({ source: 't1', cells: 24 })
  })
})

describe('condition chips', () => {
  const defs: ConditionDef[] = [{ id: 'frightened', name: 'Frightened', description: '' }, { id: 'shield', name: 'Shield of Faith', description: '' }]
  it('matches the token chips: palette by pack index, letters from the name', () => {
    expect(conditionStyle(defs, 'shield')).toEqual({ color: CONDITION_PALETTE[1], label: 'SF' })
    expect(conditionStyle(defs, 'frightened')).toEqual({ color: CONDITION_PALETTE[0], label: 'FR' })
    expect(conditionStyle(defs, 'odd')).toEqual({ color: UNKNOWN_CONDITION_COLOR, label: 'OD' })
  })
})

describe('skill icons', () => {
  const packs = resolve(__dirname, '../../../packs')
  const used = new Set<string>()
  for (const pack of readdirSync(packs)) {
    let files: string[] = []
    try { files = readdirSync(resolve(packs, pack, 'skills')) } catch { continue }
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      const icon = (JSON.parse(readFileSync(resolve(packs, pack, 'skills', f), 'utf8')) as { icon?: string }).icon
      if (icon) used.add(icon)
    }
  }
  it('draws every icon the bundled packs use', () => {
    expect(used.size).toBeGreaterThan(0)
    for (const name of used) expect(SKILL_ICON_NAMES, name).toContain(name)
  })
  it('renders emoji as text and falls back by target kind', () => {
    expect(isIconName('heart-plus')).toBe(true)
    expect(isIconName('🔥')).toBe(false)
    expect(resolveIcon('🔥', 'single')).toEqual({ type: 'text', text: '🔥' })
    expect(resolveIcon('Sword', 'single')).toEqual({ type: 'svg', name: 'sword' })
    expect(resolveIcon('kraken', 'cone')).toEqual({ type: 'kind', kind: 'cone' })
    expect(resolveIcon(undefined, 'self')).toEqual({ type: 'kind', kind: 'self' })
    expect(resolveIcon('  ', 'line')).toEqual({ type: 'kind', kind: 'line' })
  })
})

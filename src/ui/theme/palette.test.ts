import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, minDistance, simulate, type Deficiency } from './contrast'
import * as P from './palette'

const css = readFileSync(resolve(__dirname, '../global.css'), 'utf8')

/** The `--name: #hex` declarations of the first rule whose selector is exactly `selector`. */
function tokens(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no ${selector} block in global.css`)
  const body = css.slice(at, css.indexOf('\n}', at))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{3,6})\b/gi)) out[m[1]!] = m[2]!.toLowerCase()
  return out
}
const dark = tokens(':root')
const daylight = { ...dark, ...tokens(':root[data-theme="daylight"]') }
const paper = { ...dark, ...tokens('.skin-paper') }
const KINDS: Deficiency[] = ['protan', 'deutan', 'tritan']

describe('colour roles', () => {
  it('keep the CSS tokens and the table palette in step', () => {
    expect(dark.accent).toBe(P.BRAND)
    expect(dark.now).toBe(P.NOW)
    expect(dark.select).toBe(P.SELECT)
    expect(dark.mine).toBe(P.MINE)
    expect(dark.help).toBe(P.HELP)
    expect(dark.measure).toBe(P.MEASURE)
    expect([dark['hp-high'], dark['hp-mid'], dark['hp-low']]).toEqual([P.HP_HIGH, P.HP_MID, P.HP_LOW])
    expect([dark['st-buff'], dark['st-harm'], dark['st-control'], dark['st-magic'], dark['st-affliction']])
      .toEqual([P.STATUS.buff, P.STATUS.harm, P.STATUS.control, P.STATUS.magic, P.STATUS.affliction])
  })

  it('give amber, gold and cream separate meanings (no role reuses another role colour)', () => {
    const roles = [P.BRAND, P.NOW, P.SELECT, P.MINE, P.HOSTILE, P.HELP]
    expect(new Set(roles).size).toBe(roles.length)
  })

  it.each([
    ['dark', dark],
    ['daylight', daylight],
    ['paper', paper],
  ])('meet WCAG AA for text in the %s theme', (_, t) => {
    const text = ['fg', 'muted', 'accent', 'now', 'mine', 'hostile', 'help', 'ok', 'bad', 'danger', 'whisper']
    for (const bg of ['bg', 'panel', 'panel-2']) {
      const failing = text.filter((fg) => contrastRatio(t[fg]!, t[bg]!) < 4.5)
      expect(failing, `on --${bg}`).toEqual([])
    }
    // Filled pills and primary buttons.
    expect(contrastRatio(t['accent-fg']!, t.accent!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t['now-fg']!, t.now!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t['danger-fg']!, t.btn!)).toBeGreaterThanOrEqual(4.5)
  })

  it('keep the 3D role colours apart under common colour-vision deficiencies', () => {
    // Rings on a token: selection, target, mine, now. Shapes back them up, but colour should still help.
    const rings = [P.SELECT, P.HOSTILE, P.MINE, P.NOW]
    const telegraphs = [P.MINE, P.HOSTILE, P.HELP]
    const hp = [P.HP_HIGH, P.HP_MID, P.HP_LOW]
    const status = Object.values(P.STATUS)
    for (const kind of KINDS) {
      expect(minDistance(rings, kind)).toBeGreaterThan(15)
      expect(minDistance(telegraphs, kind)).toBeGreaterThan(15)
      expect(minDistance(hp, kind)).toBeGreaterThan(25)
      expect(minDistance(status, kind)).toBeGreaterThan(12)
    }
  })

  it('simulates a deficiency as a plain hex colour', () => {
    expect(simulate('#ff0000', 'deutan')).toMatch(/^#[0-9a-f]{6}$/)
    expect(simulate('#808080', 'protan')).toBe('#808080')
  })
})

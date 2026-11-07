import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Icon, ICON_NAMES, isIconName } from './icons'
import { PANELS } from './panels/registry'

describe('icons', () => {
  it('has an icon for every panel', () => {
    for (const p of PANELS) expect(isIconName(p.glyph), `${p.id}: ${p.glyph}`).toBe(true)
  })
  it('renders every icon as a decorative currentColor SVG', () => {
    for (const name of ICON_NAMES) {
      const html = renderToStaticMarkup(<Icon name={name} />)
      expect(html).toMatch(/^<svg [^>]*aria-hidden="true"/)
      expect(html).toContain('stroke="currentColor"')
      expect(html).toMatch(/<(path|circle|rect)/)
    }
  })
})

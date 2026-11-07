import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShortcutList } from './ShortcutsOverlay'
import { SHORTCUT_GROUPS, SHORTCUTS } from './useShortcuts'

describe('SHORTCUTS', () => {
  it('covers every key the shell and the table bind, in a known group', () => {
    const keys = SHORTCUTS.map((s) => s.keys)
    for (const k of ['[', ']', '/', '1 – 9', 'Cmd/Ctrl+K', 'G', 'F', 'T', 'M', 'Double-click', 'Delete / Backspace', 'Esc', 'Cmd/Ctrl+Z', '?']) expect(keys).toContain(k)
    for (const k of ['Shift+click', 'Tab', 'X / Y / Z', 'R / Shift+R', 'End', 'A', 'Cmd/Ctrl+C', 'Cmd/Ctrl+V', 'Cmd/Ctrl+D', 'Alt+drag']) expect(keys).toContain(k)
    // G stays the grid key; R turns, it does not pick a gizmo mode.
    expect(SHORTCUTS.find((s) => s.keys === 'G')?.what).toMatch(/grid/i)
    for (const s of SHORTCUTS) expect(SHORTCUT_GROUPS).toContain(s.group)
    for (const g of SHORTCUT_GROUPS) expect(SHORTCUTS.some((s) => s.group === g)).toBe(true)
  })
  it('does not list the same key twice within a group', () => {
    const seen = new Set<string>()
    for (const s of SHORTCUTS) {
      const id = `${s.group}:${s.keys}`
      expect(seen.has(id)).toBe(false)
      seen.add(id)
    }
  })
})

describe('ShortcutList', () => {
  it('renders one section per group with a keycap per key', () => {
    const html = renderToStaticMarkup(<ShortcutList shortcuts={SHORTCUTS} />)
    for (const g of SHORTCUT_GROUPS) expect(html).toContain(`aria-label="${g}"`)
    expect(html).toContain('<kbd>[</kbd>')
    expect(html).toContain('<kbd>]</kbd>')
    expect(html).toContain('<kbd>Cmd/Ctrl+Z</kbd>')
    expect((html.match(/<section/g) ?? []).length).toBe(SHORTCUT_GROUPS.length)
  })
})

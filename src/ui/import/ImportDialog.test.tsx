import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatBytes, formatCount, ImportDialog } from './ImportDialog'

const assets = { shareFile: async () => { throw new Error('not used') } }

describe('ImportDialog', () => {
  it('renders nothing when closed', () => {
    expect(renderToStaticMarkup(<ImportDialog open={false} onClose={() => {}} onImported={() => {}} assets={assets} />)).toBe('')
  })

  it('renders an accessible dialog with the three tabs and the upload licence form', () => {
    const html = renderToStaticMarkup(<ImportDialog open onClose={() => {}} onImported={() => {}} assets={assets} />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('skin-paper')
    for (const t of ['Upload', 'Poly Haven', 'Sketchfab']) expect(html).toContain(`>${t}</button>`)
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('type="file"')
    expect(html).toContain('My own work')
    expect(html).toContain('Something else / not sure')
    // Nothing selected yet: preparing is disabled.
    expect(html).toMatch(/<button type="button" class="primary" disabled="">Prepare model<\/button>/)
  })

  it('opens on the Sketchfab tab with the token help link', () => {
    const html = renderToStaticMarkup(<ImportDialog open initialTab="sketchfab" onClose={() => {}} onImported={() => {}} assets={assets} />)
    expect(html).toContain('https://sketchfab.com/settings/password')
    expect(html).toContain('type="password"')
    expect(html).toContain('Models provided by Sketchfab')
  })

  it('formats sizes and counts for the cards', () => {
    expect(formatBytes(160304)).toBe('157 KB')
    expect(formatBytes(31 * 1024 * 1024)).toBe('31 MB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
    expect(formatCount(2348)).toBe('2.3k')
    expect(formatCount(54000)).toBe('54k')
    expect(formatCount(undefined)).toBe('?')
  })
})

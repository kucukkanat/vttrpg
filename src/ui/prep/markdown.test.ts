import { describe, expect, it } from 'vitest'
import { escapeHtml, renderInline, renderMarkdown, safeHref } from './markdown'

describe('escaping', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<b onclick="x">&'`)).toBe('&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;')
  })
  it('never lets source HTML through', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })
  it('escapes inside headings, lists and link text', () => {
    expect(renderMarkdown('# <h>')).toBe('<h1>&lt;h&gt;</h1>')
    expect(renderMarkdown('- <li>')).toBe('<ul><li>&lt;li&gt;</li></ul>')
    expect(renderMarkdown('[<x>](https://a.b)')).toBe('<p><a href="https://a.b" target="_blank" rel="noopener noreferrer">&lt;x&gt;</a></p>')
  })
})

describe('blocks', () => {
  it('renders headings by level', () => {
    expect(renderMarkdown('## Rumours')).toBe('<h2>Rumours</h2>')
    expect(renderMarkdown('###### six')).toBe('<h6>six</h6>')
    expect(renderMarkdown('####### seven')).toBe('<p>####### seven</p>')
    expect(renderMarkdown('#nospace')).toBe('<p>#nospace</p>')
  })
  it('groups consecutive lines into one paragraph and splits on blank lines', () => {
    expect(renderMarkdown('one\ntwo\n\nthree')).toBe('<p>one<br>two</p>\n<p>three</p>')
  })
  it('renders bullet lists with -, * and +', () => {
    expect(renderMarkdown('- a\n* b\n+ c')).toBe('<ul><li>a</li><li>b</li><li>c</li></ul>')
  })
  it('renders numbered lists and keeps them separate from bullet lists', () => {
    expect(renderMarkdown('1. a\n2) b\n- c')).toBe('<ol><li>a</li><li>b</li></ol>\n<ul><li>c</li></ul>')
  })
  it('ends a list at a blank line or a paragraph line', () => {
    expect(renderMarkdown('- a\n\n- b')).toBe('<ul><li>a</li></ul>\n<ul><li>b</li></ul>')
    expect(renderMarkdown('- a\ntext')).toBe('<ul><li>a</li></ul>\n<p>text</p>')
  })
  it('joins indented continuation lines onto the list item', () => {
    expect(renderMarkdown('- a\n  more')).toBe('<ul><li>a more</li></ul>')
  })
  it('handles CRLF and trailing whitespace', () => {
    expect(renderMarkdown('# T \r\n\r\nbody  ')).toBe('<h1>T</h1>\n<p>body</p>')
  })
  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('\n\n  \n')).toBe('')
  })
})

describe('inline', () => {
  it('bold and italic', () => {
    expect(renderInline('**b** and *i* and __b__ and _i_')).toBe('<strong>b</strong> and <em>i</em> and <strong>b</strong> and <em>i</em>')
  })
  it('does not italicise underscores inside words', () => {
    expect(renderInline('snake_case_name')).toBe('snake_case_name')
  })
  it('leaves unbalanced markers alone', () => {
    expect(renderInline('2 * 3 * 4')).toBe('2 * 3 * 4')
    expect(renderInline('**open')).toBe('**open')
  })
  it('inline code is verbatim', () => {
    expect(renderInline('`**not bold**`')).toBe('<code>**not bold**</code>')
  })
})

describe('links', () => {
  it('opens http(s) links in a new tab with noopener', () => {
    expect(renderMarkdown('see [the map](https://example.com/map?a=1&b=2)')).toBe(
      '<p>see <a href="https://example.com/map?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">the map</a></p>',
    )
  })
  it('allows mailto', () => {
    expect(renderMarkdown('[mail](mailto:gm@example.com)')).toContain('href="mailto:gm@example.com"')
  })
  it('refuses javascript: and other schemes, leaving the text', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>')
    expect(renderMarkdown('[x](data:text/html,hi)')).toBe('<p>[x](data:text/html,hi)</p>')
    expect(renderMarkdown('[x](/relative)')).toBe('<p>[x](/relative)</p>')
  })
  it('cannot break out of the href attribute', () => {
    const html = renderMarkdown('[x](https://a.b/"onmouseover="alert(1))')
    expect(html).not.toContain('"onmouseover=')
    expect(html).toContain('href="https://a.b/&quot;onmouseover=&quot;alert(1"')
  })
  it('applies emphasis inside link text', () => {
    expect(renderMarkdown('[**b**](https://a.b)')).toContain('<a href="https://a.b" target="_blank" rel="noopener noreferrer"><strong>b</strong></a>')
  })
  it('validates hrefs', () => {
    expect(safeHref('https://x.y')).toBe('https://x.y')
    expect(safeHref('HTTP://x.y')).toBe('HTTP://x.y')
    expect(safeHref('ftp://x.y')).toBeNull()
    expect(safeHref('https://x y')).toBeNull()
  })
})

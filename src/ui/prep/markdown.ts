/**
 * Tiny Markdown renderer for journal notes and handouts. No dependency, no raw HTML pass-through:
 * every character of the source is escaped before any markup is added, so a note can never inject
 * markup. Supports headings, paragraphs, bold, italic, inline code, bullet and numbered lists,
 * and links (http(s)/mailto only), which open in a new tab.
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
}

/** Only these schemes become real links; anything else renders as text. */
export function safeHref(url: string): string | null {
  const u = url.trim()
  return /^(https?:\/\/|mailto:)[^\s]+$/i.test(u) ? u : null
}

/** Inline markup on an already-escaped line. */
export function renderInline(escaped: string): string {
  // Inline code first so its contents are left alone.
  const codes: string[] = []
  let s = escaped.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codes.push(`<code>${code}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  // Links: [text](url). The url was escaped, so unescape quotes before validating.
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text: string, rawUrl: string) => {
    const href = safeHref(rawUrl.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'))
    if (!href) return m
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
  })
  // Bold then italic. Markers must hug the text (no space just inside).
  s = s.replace(/\*\*(?=\S)([^*\n]+?\S|\S)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__(?=\S)([^_\n]+?\S|\S)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*\n]+?\S|\S)\*(?!\w)/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_\w])_(?=\S)([^_\n]+?\S|\S)_(?!\w)/g, '$1<em>$2</em>')
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? '')
}

type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] }

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null
  const flushPara = () => { if (para.length) { blocks.push({ kind: 'p', lines: para }); para = [] } }
  const flushList = () => { if (list) { blocks.push(list); list = null } }

  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { flushPara(); flushList(); continue }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { flushPara(); flushList(); blocks.push({ kind: 'h', level: h[1]!.length, text: h[2]!.trim() }); continue }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const item = ul ?? ol
    if (item) {
      flushPara()
      const kind = ul ? 'ul' : 'ol'
      if (!list || list.kind !== kind) { flushList(); list = { kind, items: [] } }
      list.items.push(item[1]!)
      continue
    }
    // Continuation of a list item (indented) stays on the item; otherwise it is paragraph text.
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue }
    flushList()
    para.push(line.trim())
  }
  flushPara()
  flushList()
  return blocks
}

/** Render Markdown to HTML. Output contains only h1-h6, p, ul, ol, li, strong, em, code, a and br. */
export function renderMarkdown(src: string): string {
  const inline = (s: string) => renderInline(escapeHtml(s))
  return parseBlocks(src)
    .map((b) => {
      switch (b.kind) {
        case 'h': return `<h${b.level}>${inline(b.text)}</h${b.level}>`
        case 'p': return `<p>${b.lines.map(inline).join('<br>')}</p>`
        default: return `<${b.kind}>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${b.kind}>`
      }
    })
    .join('\n')
}

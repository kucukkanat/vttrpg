/**
 * Command palette entries and their search. Pure, so the palette and the tests share it.
 *
 * A command has a title ("Open Journal", "Roll d20"), a group for the result headings, optional
 * extra words to match ("chat" finds the scroll), the key that does the same, and `run`.
 */
export interface Command {
  id: string
  title: string
  group: CommandGroup
  /** Extra words that find it ("whisper" → the scroll). */
  words?: string
  /** Keyboard equivalent, shown beside the title. */
  keys?: string
  /** Where it lives in the layout, shown under the title ("Tool rail", "GM screen · Build"). */
  where?: string
  run(): void
}

export type CommandGroup = 'Suggested' | 'Open' | 'Table' | 'Dice' | 'Combat' | 'GM screen' | 'Build' | 'Tokens' | 'Scenes' | 'Game'

export const GROUP_ORDER: readonly CommandGroup[] = ['Suggested', 'Open', 'Combat', 'Table', 'Dice', 'GM screen', 'Build', 'Tokens', 'Scenes', 'Game']

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/**
 * Score a command against the query: every word must appear in the title, group, words or where.
 * Title-prefix and word-start matches rank first. Null when it does not match.
 */
export function scoreCommand(c: Command, query: string): number | null {
  const q = norm(query).trim()
  if (!q) return 0
  const title = norm(c.title)
  const hay = `${title} ${norm(c.group)} ${norm(c.words ?? '')} ${norm(c.where ?? '')}`
  let score = 0
  for (const word of q.split(/\s+/)) {
    const at = hay.indexOf(word)
    if (at < 0) return null
    if (title.startsWith(word)) score += 6
    else if (title.includes(` ${word}`)) score += 4
    else if (title.includes(word)) score += 2
    else score += 1
  }
  return score
}

/**
 * The commands matching `query`, best first (ties keep group order, then list order). With an
 * empty query: the suggested ones, then everything grouped.
 */
export function filterCommands(commands: readonly Command[], query: string, limit = 60): Command[] {
  const rank = (g: CommandGroup) => GROUP_ORDER.indexOf(g)
  const scored = commands
    .map((c, i) => ({ c, i, s: scoreCommand(c, query) }))
    .filter((x): x is { c: Command; i: number; s: number } => x.s !== null)
  scored.sort((a, b) => (b.s - a.s) || (rank(a.c.group) - rank(b.c.group)) || (a.i - b.i))
  return scored.slice(0, limit).map((x) => x.c)
}

/** Ctrl/⌘-K, the palette's key on every layout with a keyboard. */
export function isPaletteKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k'
}

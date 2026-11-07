/**
 * Groups the chat log for display: consecutive messages from the same author within a few minutes
 * collapse under one author line, a divider marks each new day, and system lines and local notices
 * stand alone. Pure, so the panel only maps the result to markup.
 */
import type { ChatMessage } from '@/core/doc'
import type { LocalNotice } from '@/state/store'

export type ChatLine = ChatMessage | LocalNotice

/** Messages closer than this to the previous one by the same author share its author line. */
export const GROUP_WINDOW_MS = 3 * 60_000

export type ChatBlock =
  | { kind: 'date'; key: string; at: number }
  | { kind: 'group'; key: string; author: string; to?: string[]; at: number; messages: ChatMessage[] }
  | { kind: 'line'; key: string; line: ChatLine }

export function isChatMessage(line: ChatLine): line is ChatMessage {
  return 'kind' in line
}

/** Local calendar day, so the divider follows the viewer's clock. */
export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function groupMessages(lines: readonly ChatLine[]): ChatBlock[] {
  const out: ChatBlock[] = []
  let day: string | null = null
  let open: Extract<ChatBlock, { kind: 'group' }> | null = null
  for (const line of lines) {
    const key = dayKey(line.at)
    if (key !== day) {
      day = key
      open = null
      out.push({ kind: 'date', key: `day:${key}`, at: line.at })
    }
    if (!isChatMessage(line) || line.kind === 'system') {
      open = null
      out.push({ kind: 'line', key: line.id, line })
      continue
    }
    const last = open?.messages[open.messages.length - 1]
    if (open && last && open.author === line.author && sameRecipients(open.to, line.to) && line.at - last.at <= GROUP_WINDOW_MS && line.at >= last.at) {
      open.messages.push(line)
      continue
    }
    open = { kind: 'group', key: line.id, author: line.author, at: line.at, messages: [line] }
    if (line.to) open.to = line.to
    out.push(open)
  }
  return out
}

function sameRecipients(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((pk, i) => pk === b[i])
}

/** "14:02": a 24-hour clock in the viewer's locale, narrow enough for the right edge of a line. */
export function formatTime(at: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))
}

/** Divider text: Today, Yesterday, else a short date (with the year only when it differs). */
export function formatDay(at: number, now = Date.now(), locale?: string): string {
  const key = dayKey(at)
  if (key === dayKey(now)) return 'Today'
  if (key === dayKey(now - 86_400_000)) return 'Yesterday'
  const d = new Date(at)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(d)
}

// ------------------------------------------------------------------ channels

/** Log filters: everything, conversation, dice, combat results, and system lines. */
export type ChatChannel = 'all' | 'chat' | 'rolls' | 'combat' | 'system'

export const CHAT_CHANNELS: { id: ChatChannel; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'chat', label: 'Chat' },
  { id: 'rolls', label: 'Rolls' },
  { id: 'combat', label: 'Combat' },
  { id: 'system', label: 'System' },
]

/** The channel a line belongs to. Skill results and encounter summaries are combat; local notices are system. */
export function channelOf(line: ChatLine): Exclude<ChatChannel, 'all'> {
  if (!isChatMessage(line)) return 'system'
  if (line.kind === 'say' || line.kind === 'whisper') return 'chat'
  if (line.kind === 'roll') return 'rolls'
  return line.channel === 'combat' || line.summary ? 'combat' : 'system'
}

/** The lines shown under `channel`. */
export function filterChannel<T extends ChatLine>(lines: readonly T[], channel: ChatChannel): T[] {
  return channel === 'all' ? [...lines] : lines.filter((l) => channelOf(l) === channel)
}

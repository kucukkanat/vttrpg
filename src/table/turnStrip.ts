/**
 * The HUD turn order strip: which combatants show as discs, in what order, and how many fit.
 * Pure; the InitiativeChip renders the result.
 *
 * The strip starts at the current combatant and runs through the upcoming ones, wrapping into the
 * next round. Players never see hidden tokens; when the combatant whose turn it is is hidden, they
 * get an anonymous "?" disc in its place (the chip has always said "Someone's turn").
 *
 * A group (group initiative) is one disc: its first visible member's look with a member count.
 * A GM-declared action of any member rides on the disc as an intent badge.
 */
import type { InitiativeState, Token } from '@/core/doc'
import type { PlayerPubkey, TokenId } from '@/core/ids'
import { slotRange } from '@/state/initiative'
import { initialsOf } from './tokenLabel'

export interface StripDisc {
  token: TokenId
  /** What the viewer may call it ("Someone" for a hidden token, "Gone" for a deleted one). */
  name: string
  initials: string
  color: string
  current: boolean
  /** Owned by the viewer (players only). */
  mine: boolean
  /** Hidden from players; only the GM gets these, dimmed. */
  hidden: boolean
  /** Members this disc stands for when it is a group (2 or more); absent for a single combatant. */
  count?: number
  /** The declared next action ("Fire breath"), with its skill icon name when it has one. */
  intent?: { label: string; icon?: string }
}

export interface TurnStrip {
  round: number
  discs: StripDisc[]
  /** Upcoming combatants that did not fit; shown as "+N". */
  overflow: number
}

/** Pixel sizes the capacity maths assumes; initiative.css draws the strip with the same numbers. */
export const STRIP_METRICS = {
  /** Pill padding left + right, plus its 1px borders. */
  chrome: 2 * 6 + 2,
  /** Round badge plus the gap after it. */
  badge: 34 + 4,
  /** 32 px disc plus 3 px either side for its ring. */
  current: 38,
  disc: 28,
  gap: 4,
} as const

const ANON_COLOR = '#55545a'

/** How many disc slots (current included, the "+N" disc counting as one) fit in `width` px; at least 1. */
export function discSlots(width: number, m: typeof STRIP_METRICS = STRIP_METRICS): number {
  const room = width - m.chrome - m.badge - m.current
  if (!Number.isFinite(room) || room < 0) return 1
  return 1 + Math.floor((room + 0.001) / (m.disc + m.gap))
}

/**
 * The strip for `slots` disc slots, or null between encounters. Current first, then upcoming;
 * when they do not all fit, the last slot becomes "+N".
 */
export function turnStrip(
  s: InitiativeState | null,
  tokens: Record<TokenId, Token>,
  isGm: boolean,
  me: PlayerPubkey | string | null,
  slots: number,
): TurnStrip | null {
  if (!s || !s.active) return null
  const n = s.order.length
  const cur = s.order[s.turn]
  if (!cur) return null
  const all: StripDisc[] = []
  // Slots from the current one on, wrapping; a group is one slot.
  const starts: number[] = []
  for (let i = 0, idx = slotRange(s.order, s.turn)[0]; i < n && starts.length < n; i++) {
    if (starts.includes(idx)) break
    starts.push(idx)
    idx = (slotRange(s.order, idx)[1] + 1) % n
  }
  starts.forEach((start, k) => {
    const [a, b] = slotRange(s.order, start)
    const current = k === 0
    const members = s.order.slice(a, b + 1)
    const seen = members.filter((e) => isGm || !tokens[e.token]?.hidden)
    if (!seen.length) {
      if (current) all.push({ token: members[0]!.token, name: 'Someone', initials: '?', color: ANON_COLOR, current, mine: false, hidden: false })
      return
    }
    const lead = seen[0]!
    const t = tokens[lead.token]
    const disc: StripDisc = {
      token: lead.token,
      name: t ? t.name : 'Gone',
      initials: t ? initialsOf(t.name) : '?',
      color: t ? t.color : ANON_COLOR,
      current,
      mine: !isGm && !!me && seen.some((e) => tokens[e.token]?.owner === me),
      hidden: seen.every((e) => !!tokens[e.token]?.hidden),
    }
    if (seen.length > 1) disc.count = seen.length
    const declared = seen.map((e) => s.declared?.[e.token]).find((d) => !!d)
    if (declared) disc.intent = declared.icon ? { label: declared.label, icon: declared.icon } : { label: declared.label }
    all.push(disc)
  })
  const room = Math.max(1, Math.floor(slots))
  if (all.length <= room) return { round: s.round, discs: all, overflow: 0 }
  const shown = all.slice(0, Math.max(1, room - 1))
  return { round: s.round, discs: shown, overflow: all.length - shown.length }
}

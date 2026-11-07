import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/core/doc'
import type { PlayerPubkey } from '@/core/ids'
import type { LocalNotice } from '@/state/store'
import { channelOf, filterChannel, formatDay, formatTime, GROUP_WINDOW_MS, groupMessages } from './chatGroups'

const A = 'alice' as PlayerPubkey, B = 'bob' as PlayerPubkey
// Local-time dates keep the day boundaries stable whatever zone the tests run in.
const t0 = new Date(2026, 2, 5, 14, 2).getTime()
let n = 0
const say = (author: PlayerPubkey, at: number, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id: `m${n++}`, author, at, kind: 'say', text: `hi ${n}`, ...extra })
const notice = (at: number): LocalNotice => ({ id: `n${n++}`, at, text: 'notice' })

describe('groupMessages', () => {
  it('starts with a date divider and collapses one author within the window', () => {
    const blocks = groupMessages([say(A, t0), say(A, t0 + 60_000), say(A, t0 + 60_000 + GROUP_WINDOW_MS + 1)])
    expect(blocks.map((b) => b.kind)).toEqual(['date', 'group', 'group'])
    expect(blocks[1]).toMatchObject({ kind: 'group', author: A })
    expect((blocks[1] as { messages: unknown[] }).messages).toHaveLength(2)
    expect((blocks[2] as { messages: unknown[] }).messages).toHaveLength(1)
  })

  it('measures the window from the previous message, not the first of the group', () => {
    const blocks = groupMessages([say(A, t0), say(A, t0 + 120_000), say(A, t0 + 240_000), say(A, t0 + 360_000)])
    expect(blocks).toHaveLength(2)
    expect((blocks[1] as { messages: unknown[] }).messages).toHaveLength(4)
  })

  it('splits on a change of author', () => {
    const blocks = groupMessages([say(A, t0), say(B, t0 + 1000), say(A, t0 + 2000)])
    expect(blocks.map((b) => b.kind)).toEqual(['date', 'group', 'group', 'group'])
  })

  it('keeps whispers to different people in separate groups', () => {
    const blocks = groupMessages([say(A, t0, { kind: 'whisper', to: [B] }), say(A, t0 + 1000), say(A, t0 + 2000, { kind: 'whisper', to: [B] }), say(A, t0 + 3000, { kind: 'whisper', to: [B] })])
    expect(blocks.map((b) => b.kind)).toEqual(['date', 'group', 'group', 'group'])
    expect(blocks[1]).toMatchObject({ to: [B] })
    expect((blocks[3] as { messages: unknown[] }).messages).toHaveLength(2)
  })

  it('leaves system lines and notices alone and breaks the group around them', () => {
    const sys = say(A, t0 + 1000, { kind: 'system' })
    const blocks = groupMessages([say(A, t0), sys, say(A, t0 + 2000), notice(t0 + 3000), say(A, t0 + 4000)])
    expect(blocks.map((b) => b.kind)).toEqual(['date', 'group', 'line', 'group', 'line', 'group'])
    expect(blocks[2]).toMatchObject({ kind: 'line', line: sys })
  })

  it('inserts a divider when the day changes and does not group across it', () => {
    const nextDay = new Date(2026, 2, 6, 0, 0, 30).getTime()
    const blocks = groupMessages([say(A, nextDay - 60_000), say(A, nextDay)])
    expect(blocks.map((b) => b.kind)).toEqual(['date', 'group', 'date', 'group'])
  })

  it('rolls group like speech', () => {
    const blocks = groupMessages([say(A, t0, { kind: 'roll', roll: { formula: 'd20', seed: 'x', dice: [{ sides: 20, value: 7 }], total: 7 } }), say(A, t0 + 500)])
    expect(blocks).toHaveLength(2)
  })

  it('handles an empty log', () => {
    expect(groupMessages([])).toEqual([])
  })
})

describe('time labels', () => {
  it('formats hours and minutes', () => {
    expect(formatTime(t0, 'en-GB')).toBe('14:02')
  })
  it('names today and yesterday, then dates', () => {
    const now = new Date(2026, 2, 7, 9, 0).getTime()
    expect(formatDay(now - 60_000, now)).toBe('Today')
    expect(formatDay(new Date(2026, 2, 6, 23, 59).getTime(), now)).toBe('Yesterday')
    expect(formatDay(t0, now, 'en-GB')).toBe('Thu 5 Mar')
    expect(formatDay(new Date(2025, 2, 5).getTime(), now, 'en-GB')).toContain('2025')
  })
})

describe('chat channels', () => {
  const lines = [
    say(A, t0),
    say(B, t0, { kind: 'whisper', to: [A] }),
    say(A, t0, { kind: 'roll', text: 'd20' }),
    say(A, t0, { kind: 'system', text: 'Pip attacks Rat.', channel: 'combat' }),
    say(A, t0, { kind: 'system', text: 'Encounter over', summary: { rounds: 1, rows: [] } }),
    say(A, t0, { kind: 'system', text: 'old skill line' }),
    { id: 'n1', at: t0, text: 'You are Pip' } as LocalNotice,
  ]
  it('sorts every line into one channel', () => {
    expect(lines.map(channelOf)).toEqual(['chat', 'chat', 'rolls', 'combat', 'combat', 'system', 'system'])
  })
  it('filters to a channel, all keeps everything', () => {
    expect(filterChannel(lines, 'all')).toHaveLength(lines.length)
    expect(filterChannel(lines, 'combat').map((l) => l.text)).toEqual(['Pip attacks Rat.', 'Encounter over'])
    expect(filterChannel(lines, 'rolls')).toHaveLength(1)
  })
})

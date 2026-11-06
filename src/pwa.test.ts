import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFER_POLL_MS, deferUntilIdle, isBusy, lastRollAt, MAX_DEFER_MS, ROLL_SETTLE_MS, shouldReloadNow, type Activity } from './pwa'
import type { ChatMessage } from '@/core/doc'

const idle: Activity = { drag: false, editDrag: false, lastRollAt: null }
const T = 1_000_000

describe('isBusy', () => {
  it('is idle with no drag and no roll', () => {
    expect(isBusy(idle, T)).toBe(false)
  })
  it('is busy during a token drag or an edit drag', () => {
    expect(isBusy({ ...idle, drag: true }, T)).toBe(true)
    expect(isBusy({ ...idle, editDrag: true }, T)).toBe(true)
  })
  it('is busy while the latest roll is still settling, then idle', () => {
    expect(isBusy({ ...idle, lastRollAt: T }, T)).toBe(true)
    expect(isBusy({ ...idle, lastRollAt: T }, T + ROLL_SETTLE_MS - 1)).toBe(true)
    expect(isBusy({ ...idle, lastRollAt: T }, T + ROLL_SETTLE_MS)).toBe(false)
  })
  it('ignores a roll stamped in the future by a skewed clock', () => {
    expect(isBusy({ ...idle, lastRollAt: T + 60_000 }, T)).toBe(false)
  })
})

describe('shouldReloadNow', () => {
  it('reloads at once when idle', () => {
    expect(shouldReloadNow(idle, T, T)).toBe(true)
  })
  it('waits while busy', () => {
    expect(shouldReloadNow({ ...idle, drag: true }, T, T)).toBe(false)
    expect(shouldReloadNow({ ...idle, drag: true }, T + MAX_DEFER_MS - 1, T)).toBe(false)
  })
  it('gives up waiting after the cap even if still busy', () => {
    expect(shouldReloadNow({ ...idle, drag: true }, T + MAX_DEFER_MS, T)).toBe(true)
  })
})

describe('lastRollAt', () => {
  const msg = (kind: ChatMessage['kind'], at: number): ChatMessage => ({ id: `${kind}-${at}`, author: 'a' as ChatMessage['author'], at, kind, text: '' })
  it('returns the newest roll even when chat continued after it', () => {
    expect(lastRollAt([msg('roll', 1), msg('say', 2), msg('roll', 3), msg('say', 4)])).toBe(3)
  })
  it('is null with no rolls', () => {
    expect(lastRollAt([])).toBeNull()
    expect(lastRollAt([msg('say', 1), msg('system', 2)])).toBeNull()
  })
})

describe('deferUntilIdle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('applies synchronously when the table is idle', () => {
    let applied = 0
    deferUntilIdle(() => idle, () => { applied++ }, { now: () => T })
    expect(applied).toBe(1)
  })

  it('polls until the drag ends, then applies once', () => {
    let now = T
    let activity: Activity = { ...idle, drag: true }
    let applied = 0
    deferUntilIdle(() => activity, () => { applied++ }, { now: () => now })
    expect(applied).toBe(0)
    now += DEFER_POLL_MS
    vi.advanceTimersByTime(DEFER_POLL_MS)
    expect(applied).toBe(0)
    activity = idle
    now += DEFER_POLL_MS
    vi.advanceTimersByTime(DEFER_POLL_MS)
    expect(applied).toBe(1)
    vi.advanceTimersByTime(DEFER_POLL_MS * 10)
    expect(applied).toBe(1)
  })

  it('applies after the cap while a roll never settles', () => {
    let now = T
    let applied = 0
    // A fresh roll on every read keeps the table busy for good.
    deferUntilIdle(() => ({ ...idle, lastRollAt: now }), () => { applied++ }, { now: () => now })
    for (let i = 0; i < MAX_DEFER_MS / DEFER_POLL_MS - 1; i++) {
      now += DEFER_POLL_MS
      vi.advanceTimersByTime(DEFER_POLL_MS)
    }
    expect(applied).toBe(0)
    now += DEFER_POLL_MS
    vi.advanceTimersByTime(DEFER_POLL_MS)
    expect(applied).toBe(1)
  })

  it('can be cancelled before it applies', () => {
    let now = T
    let applied = 0
    const cancel = deferUntilIdle(() => ({ ...idle, editDrag: true }), () => { applied++ }, { now: () => now })
    cancel()
    now += MAX_DEFER_MS * 2
    vi.advanceTimersByTime(MAX_DEFER_MS * 2)
    expect(applied).toBe(0)
  })
})

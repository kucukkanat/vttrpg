import { afterEach, describe, expect, it, vi } from 'vitest'
import { announceDiceSettled, DICE_SETTLED_EVENT, YIELD_SCALE, yieldTransform } from './choreography'

describe('yieldTransform', () => {
  it('moves the overlay centre onto the toast centre and shrinks it', () => {
    const overlay = { left: 0, top: 44, width: 375, height: 600 }
    const toast = { left: 120, top: 60, width: 135, height: 40 }
    // Overlay centre (187.5, 344) to toast centre (187.5, 80).
    expect(yieldTransform(overlay, toast)).toBe(`translate(0px, -264px) scale(${YIELD_SCALE})`)
    expect(yieldTransform(overlay, { ...toast, left: 0 }, 0.2)).toBe('translate(-120px, -264px) scale(0.2)')
  })
})

describe('announceDiceSettled', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('fires the settled event with the roll id', () => {
    const events: Event[] = []
    vi.stubGlobal('window', { dispatchEvent: (e: Event) => { events.push(e); return true } })
    announceDiceSettled('seed-1')
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe(DICE_SETTLED_EVENT)
    expect((events[0] as CustomEvent<string>).detail).toBe('seed-1')
  })
})

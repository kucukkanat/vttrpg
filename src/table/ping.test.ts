import { describe, expect, it } from 'vitest'
import type { PlayerPubkey, SceneId } from '@/core/ids'
import type { Presence } from '@/core/presence'
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, isDoubleTap, PING_MAX_AGE_MS, takePing } from './ping'

const pk = 'a'.repeat(64) as PlayerPubkey
const scene = 'scene-1' as SceneId
const base: Presence = { pubkey: pk, name: 'Pip', color: '#ff00aa', scene, lastSeen: 0 }
const now = 1_000_000

describe('takePing', () => {
  it('returns nothing without a ping', () => {
    expect(takePing(new Map(), base, now)).toBeNull()
  })
  it('plays a fresh ping once and names the sender', () => {
    const seen = new Map<string, number>()
    const p: Presence = { ...base, ping: { x: 1, z: 2, scene, at: now - 50, color: '#123456' } }
    expect(takePing(seen, p, now)).toEqual({ x: 1, z: 2, scene, at: now - 50, color: '#123456', pubkey: pk, name: 'Pip' })
    // The next beacon still carries it: not again.
    expect(takePing(seen, { ...p, lastSeen: 5 }, now + 2000)).toBeNull()
  })
  it('plays a newer ping from the same sender', () => {
    const seen = new Map<string, number>()
    takePing(seen, { ...base, ping: { x: 1, z: 2, scene, at: now - 500, color: '' } }, now)
    const later = takePing(seen, { ...base, ping: { x: 3, z: 4, scene, at: now, color: '' } }, now)
    expect(later?.x).toBe(3)
  })
  it('falls back to the presence colour', () => {
    expect(takePing(new Map(), { ...base, ping: { x: 0, z: 0, scene, at: now, color: '' } }, now)?.color).toBe('#ff00aa')
  })
  it('ignores stale pings but remembers them', () => {
    const seen = new Map<string, number>()
    const at = now - PING_MAX_AGE_MS - 1
    expect(takePing(seen, { ...base, ping: { x: 0, z: 0, scene, at, color: '' } }, now)).toBeNull()
    expect(seen.get(pk)).toBe(at)
  })
  it('keeps senders apart', () => {
    const seen = new Map<string, number>()
    const other = 'b'.repeat(64) as PlayerPubkey
    expect(takePing(seen, { ...base, ping: { x: 0, z: 0, scene, at: now, color: '' } }, now)).not.toBeNull()
    expect(takePing(seen, { ...base, pubkey: other, ping: { x: 0, z: 0, scene, at: now, color: '' } }, now)).not.toBeNull()
  })
})

describe('isDoubleTap', () => {
  it('needs a previous tap close in time and space', () => {
    expect(isDoubleTap(null, { x: 0, y: 0, at: 0 })).toBe(false)
    expect(isDoubleTap({ x: 10, y: 10, at: 0 }, { x: 14, y: 12, at: 250 })).toBe(true)
    expect(isDoubleTap({ x: 10, y: 10, at: 0 }, { x: 14, y: 12, at: DOUBLE_TAP_MS + 1 })).toBe(false)
    expect(isDoubleTap({ x: 10, y: 10, at: 0 }, { x: 10 + DOUBLE_TAP_PX + 1, y: 10, at: 100 })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { PlayerPubkey, SceneId } from '@/core/ids'
import type { Presence } from '@/core/presence'
import { CAMERA_STALE_MS, displayLinkFromInvite, followedCamera, makeView, parseDisplayLink, PULL_MAX_AGE_MS, takePull, viewMoved } from './view'

const gm = 'aa'.repeat(32) as PlayerPubkey
const scene = 's1' as SceneId
const view = (at: number, s = scene) => makeView(s, { x: 1, y: 5, z: 1 }, { x: 0, y: 0, z: 0 }, at)
const presence = (over: Partial<Presence>): Presence => ({ pubkey: gm, name: 'GM', color: '#fff', scene, lastSeen: 0, ...over })

describe('shared views', () => {
  it('takes each GM pull once, only while fresh and for the scene on screen', () => {
    const seen = { at: 0 }
    const now = 10_000
    expect(takePull(seen, presence({ pull: view(now - 100) }), gm, scene, now)).toMatchObject({ at: now - 100 })
    // The same pull on the next beacon is ignored.
    expect(takePull(seen, presence({ pull: view(now - 100) }), gm, scene, now)).toBeNull()
    expect(takePull(seen, presence({ pull: view(now) }), gm, 's2' as SceneId, now)).toBeNull()
    expect(takePull({ at: 0 }, presence({ pull: view(now - PULL_MAX_AGE_MS - 1) }), gm, scene, now)).toBeNull()
    // Only the GM can pull.
    expect(takePull({ at: 0 }, presence({ pubkey: 'bb'.repeat(32) as PlayerPubkey, pull: view(now) }), gm, scene, now)).toBeNull()
    expect(takePull({ at: 0 }, undefined, gm, scene, now)).toBeNull()
  })
  it('follows the GM camera until it goes stale or moves to another scene', () => {
    const now = 100_000
    expect(followedCamera(presence({ camera: view(now - 1000) }), gm, scene, now)).toMatchObject({ scene })
    expect(followedCamera(presence({ camera: view(now - CAMERA_STALE_MS - 1) }), gm, scene, now)).toBeNull()
    expect(followedCamera(presence({ camera: view(now, 's2' as SceneId) }), gm, scene, now)).toBeNull()
    expect(followedCamera(presence({}), gm, scene, now)).toBeNull()
  })
  it('rounds poses and tells a real move from jitter', () => {
    const v = makeView(scene, { x: 1.23456, y: 2, z: 3 }, { x: 0, y: 0, z: 0.0004 }, 7)
    expect(v).toEqual({ scene, pos: { x: 1.235, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, at: 7 })
    expect(viewMoved(null, v)).toBe(true)
    expect(viewMoved(v, { ...v, pos: { ...v.pos, x: v.pos.x + 0.01 } })).toBe(false)
    expect(viewMoved(v, { ...v, target: { ...v.target, z: 0.5 } })).toBe(true)
  })
  it('turns an invite into a display link and back', () => {
    const invite = 'https://example.org/vttrpg/#/join/naddr1abc?k=KEY_-1'
    const link = displayLinkFromInvite(invite, 'overview')
    expect(link).toBe('https://example.org/vttrpg/#/display/naddr1abc?k=KEY_-1&view=overview')
    expect(parseDisplayLink(link)).toEqual({ invite, view: 'overview', grid: true })
    expect(parseDisplayLink(`${displayLinkFromInvite(invite)}&grid=0`)).toEqual({ invite, view: 'follow', grid: false })
    expect(parseDisplayLink('https://example.org/#/display/naddr1abc')).toBeNull()
    expect(parseDisplayLink(invite)).toBeNull()
    expect(() => displayLinkFromInvite('https://example.org/')).toThrow()
  })
})

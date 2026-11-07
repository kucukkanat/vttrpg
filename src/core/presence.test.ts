import { describe, expect, it } from 'vitest'
import type { PlayerPubkey, SceneId } from './ids'
import { admitPresence, MAX_BUILD_SELECTION, sanitizeBuildPresence, type Presence } from './presence'
import { activeBuilders, BUILD_IDLE_MS, BUILD_STALE_MS, BuildPresenceTracker, encodeBuildPresence, type BuilderState } from './builderPresence'

const S = 'scene-1' as SceneId
const state = (extra: Partial<BuilderState> = {}): BuilderState => ({ scene: S, cursor: { x: 1.23456, y: 0, z: -2.0049 }, held: null, selection: [], ...extra })

describe('builder presence payload', () => {
  it('rounds the cursor and the ghost to centimetres and keeps the catalogue id', () => {
    const out = encodeBuildPresence(state({ held: { catalogue: 'kenney:barrel', at: { x: 0.123456, y: 1.0001, z: 3 }, yaw: Math.PI / 2 } }))
    expect(out.cursor).toEqual({ x: 1.23, y: 0, z: -2 })
    expect(out.build).toEqual({ scene: S, held: { id: 'kenney:barrel', at: { x: 0.12, y: 1, z: 3 }, yaw: 1.571 } })
  })

  it('sends a ghost without an id for a paste, and no cursor off the board', () => {
    const out = encodeBuildPresence(state({ cursor: null, held: { at: { x: 1, y: 0, z: 1 }, yaw: 0 } }))
    expect(out.cursor).toBeUndefined()
    expect(out.build?.held).toEqual({ at: { x: 1, y: 0, z: 1 }, yaw: 0 })
  })

  it('caps the selection and counts the rest', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `p${i}`)
    const out = encodeBuildPresence(state({ selection: ids }))
    expect(out.build?.sel).toHaveLength(MAX_BUILD_SELECTION)
    expect(out.build?.more).toBe(30 - MAX_BUILD_SELECTION)
  })

  it('stays small with a full selection and a held model', () => {
    const ids = Array.from({ length: 200 }, () => crypto.randomUUID())
    const out = encodeBuildPresence(state({ selection: ids, held: { catalogue: 'kaykit-dungeon:table_long_decorated_A', at: { x: 12.3456, y: 0.75, z: -8.91 }, yaw: 4.71238898 } }))
    expect(JSON.stringify(out).length).toBeLessThan(1200)
  })

  it('checks what it receives: bad points, long ids, junk', () => {
    expect(sanitizeBuildPresence(null)).toBeUndefined()
    expect(sanitizeBuildPresence({ scene: 42 })).toBeUndefined()
    const clean = sanitizeBuildPresence({
      scene: S,
      held: { id: 'x'.repeat(500), at: { x: 1, y: 'up', z: 2 }, yaw: 1 },
      sel: ['a', 7, '', 'b', ...Array.from({ length: 100 }, (_, i) => `q${i}`)],
      more: -3,
      extra: 'dropped',
    })
    expect(clean).toEqual({ scene: S, sel: ['a', 'b', ...Array.from({ length: MAX_BUILD_SELECTION - 2 }, (_, i) => `q${i}`)] })
    expect(sanitizeBuildPresence({ scene: S, held: { id: 'x'.repeat(500), at: { x: 1e9, y: 0, z: 0 }, yaw: 0 } })).toEqual({ scene: S, held: { at: { x: 100000, y: 0, z: 0 }, yaw: 0 } })
  })
})

describe('admitting presence', () => {
  const p = (extra: Partial<Presence> = {}): Presence => ({ pubkey: 'co' as PlayerPubkey, name: 'Co', color: '#f0f', scene: S, lastSeen: 1, build: { scene: S, sel: ['a'] }, cursor: { x: 1, y: 0, z: 1 }, ...extra })

  it('keeps build data from a writer for a viewer who builds', () => {
    expect(admitPresence(p(), { fromWriter: true, viewerBuilds: true }).build).toEqual({ scene: S, sel: ['a'] })
  })

  it('drops it for players and from non-writers', () => {
    expect(admitPresence(p(), { fromWriter: true, viewerBuilds: false }).build).toBeUndefined()
    expect(admitPresence(p(), { fromWriter: false, viewerBuilds: true }).build).toBeUndefined()
  })

  it('drops a cursor that is not a point', () => {
    expect(admitPresence(p({ cursor: { x: Number.NaN, y: 0, z: 0 } }), { fromWriter: true, viewerBuilds: true }).cursor).toBeUndefined()
  })
})

describe('who is building', () => {
  const now = 1_000_000
  const b = (pubkey: string, extra: Partial<Presence> = {}): Presence => ({ pubkey: pubkey as PlayerPubkey, name: pubkey, color: '#fff', scene: S, lastSeen: now, build: { scene: S }, ...extra })

  it('lists other builders in this scene who are still around', () => {
    const presence = {
      me: b('me'),
      ann: b('ann'),
      far: b('far', { build: { scene: 'other' as SceneId } }),
      gone: b('gone', { lastSeen: now - BUILD_STALE_MS - 1 }),
      player: b('player', { build: undefined }),
    }
    expect(activeBuilders(presence, { me: 'me', scene: S, now }).map((p) => p.pubkey)).toEqual(['ann'])
  })
})

describe('sending builder presence', () => {
  it('sends on change only, then clears once after 30 s idle', () => {
    const t = new BuildPresenceTracker()
    t.touch(0)
    expect(t.step(0, state())?.build).toEqual({ scene: S })
    expect(t.step(100, state())).toBeNull()
    expect(t.step(200, state({ cursor: { x: 5, y: 0, z: 5 } }))?.cursor).toEqual({ x: 5, y: 0, z: 5 })
    expect(t.step(BUILD_IDLE_MS, state({ cursor: { x: 5, y: 0, z: 5 } }))).toBeNull()
    const cleared = t.step(BUILD_IDLE_MS + 1, state())
    expect(cleared).toEqual({ cursor: undefined, build: undefined })
    expect(JSON.parse(JSON.stringify({ name: 'x', ...cleared }))).toEqual({ name: 'x' })
    expect(t.step(BUILD_IDLE_MS + 500, state())).toBeNull()
    // Back to work: the payload goes out again.
    t.touch(BUILD_IDLE_MS + 600)
    expect(t.step(BUILD_IDLE_MS + 600, state())?.build).toEqual({ scene: S })
  })

  it('clears when the builder leaves Build, and stays quiet when nothing was shown', () => {
    const t = new BuildPresenceTracker()
    expect(t.step(0, null)).toBeNull()
    t.touch(0)
    t.step(0, state())
    expect(t.step(50, null)).toEqual({ cursor: undefined, build: undefined })
    expect(t.step(60, null)).toBeNull()
  })
})

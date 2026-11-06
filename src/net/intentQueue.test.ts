import { describe, expect, it } from 'vitest'
import type { PlayerPubkey, TokenId } from '@/core/ids'
import type { Intent, IntentEnvelope } from '@/core/intents'
import { INTENT_QUEUE_TTL_MS, IntentQueue, QUEUEABLE_INTENTS } from './connection'

const me = 'me' as PlayerPubkey
const mine = 'mine' as TokenId
const theirs = 'theirs' as TokenId
const pos = { x: 1, y: 0, z: 2 }

let seq = 0
const env = (intent: Intent): IntentEnvelope => ({ id: `i${++seq}`, from: me, at: 0, intent })

/** A queue on a manual clock that owns only `mine`. */
function make(ttlMs = INTENT_QUEUE_TTL_MS) {
  const clock = { t: 1_000_000 }
  const q = new IntentQueue({ ttlMs, now: () => clock.t, ownsToken: (t) => t === mine })
  return { q, clock }
}

describe('IntentQueue', () => {
  it('holds own token moves, own token updates and chat; refuses everything else', () => {
    const { q } = make()
    expect(QUEUEABLE_INTENTS).toEqual(new Set(['token.move', 'token.update', 'chat.say']))
    expect(q.reasonToReject(env({ type: 'token.move', token: mine, position: pos }))).toBeNull()
    expect(q.reasonToReject(env({ type: 'token.update', token: mine, patch: { name: 'Pip' } }))).toBeNull()
    expect(q.reasonToReject(env({ type: 'chat.say', text: 'hi' }))).toBeNull()

    expect(q.reasonToReject(env({ type: 'token.move', token: theirs, position: pos }))).toBe('not-owner')
    expect(q.reasonToReject(env({ type: 'token.update', token: theirs, patch: {} }))).toBe('not-owner')
    expect(q.reasonToReject(env({ type: 'roll', formula: 'd20', seed: 's' }))).toBe('gm-away')
    expect(q.reasonToReject(env({ type: 'skill.use', skill: 'fireball' as never, source: mine, targets: [], seed: 's' }))).toBe('gm-away')
    expect(q.reasonToReject(env({ type: 'token.claim', token: theirs }))).toBe('gm-away')
    expect(q.reasonToReject(env({ type: 'fog.reset', scene: 's' as never }))).toBe('gm-away')
    expect(q.reasonToReject(env({ type: 'token.remove', token: mine }))).toBe('gm-away')
  })

  it('without an ownership check every move is accepted', () => {
    const q = new IntentQueue()
    expect(q.reasonToReject(env({ type: 'token.move', token: theirs, position: pos }))).toBeNull()
  })

  it('flushes in the order the intents were made and resolves each as delivered', async () => {
    const { q } = make()
    const a = q.enqueue(env({ type: 'token.move', token: mine, position: pos }))
    const b = q.enqueue(env({ type: 'chat.say', text: 'one' }))
    const c = q.enqueue(env({ type: 'chat.say', text: 'two' }))
    expect(q.size).toBe(3)

    const sent: string[] = []
    const n = await q.flush(async (e) => {
      // Sends overlap in time only if flush does not await each one; the order must still hold.
      await new Promise((r) => setTimeout(r, 2))
      sent.push(e.id)
    })
    expect(n).toBe(3)
    expect(sent).toEqual(['i' + (seq - 2), 'i' + (seq - 1), 'i' + seq])
    expect(q.size).toBe(0)
    await expect(Promise.all([a.settled, b.settled, c.settled])).resolves.toEqual(['delivered', 'delivered', 'delivered'])
  })

  it('a failed send still settles that entry and the rest go out', async () => {
    const { q } = make()
    const a = q.enqueue(env({ type: 'chat.say', text: 'bad' }))
    const b = q.enqueue(env({ type: 'chat.say', text: 'good' }))
    const sent: string[] = []
    const n = await q.flush(async (e) => {
      if (e.intent.type === 'chat.say' && e.intent.text === 'bad') throw new Error('relay down')
      sent.push((e.intent as { text: string }).text)
    })
    expect(n).toBe(2)
    expect(sent).toEqual(['good'])
    expect(q.size).toBe(0)
    await expect(Promise.all([a.settled, b.settled])).resolves.toEqual(['delivered', 'delivered'])
  })

  it('drops entries past the TTL as expired, keeps the rest, and reports the next expiry', async () => {
    const { q, clock } = make(1000)
    const old = q.enqueue(env({ type: 'chat.say', text: 'old' }))
    clock.t += 600
    const fresh = q.enqueue(env({ type: 'chat.say', text: 'fresh' }))
    expect(q.nextExpiryIn()).toBe(400)

    clock.t += 500 // old is 1100 ms in, fresh 500 ms
    expect(q.expire()).toBe(1)
    expect(q.size).toBe(1)
    await expect(old.settled).resolves.toBe('expired')
    expect(q.nextExpiryIn()).toBe(500)

    const sent: string[] = []
    await q.flush(async (e) => void sent.push((e.intent as { text: string }).text))
    expect(sent).toEqual(['fresh'])
    await expect(fresh.settled).resolves.toBe('delivered')
    expect(q.nextExpiryIn()).toBeUndefined()
  })

  it('flush skips what expired meanwhile; an entry exactly at the TTL still goes', async () => {
    const { q, clock } = make(1000)
    const late = q.enqueue(env({ type: 'chat.say', text: 'late' }))
    clock.t += 1000
    const edge = q.enqueue(env({ type: 'chat.say', text: 'edge' }))
    clock.t += 1 // late: 1001 ms (gone), edge: 1 ms
    const sent: string[] = []
    expect(await q.flush(async (e) => void sent.push((e.intent as { text: string }).text))).toBe(1)
    expect(sent).toEqual(['edge'])
    await expect(late.settled).resolves.toBe('expired')
    await expect(edge.settled).resolves.toBe('delivered')
  })

  it('clear expires everything (connection closed)', async () => {
    const { q } = make()
    const a = q.enqueue(env({ type: 'chat.say', text: 'a' }))
    q.clear()
    expect(q.size).toBe(0)
    await expect(a.settled).resolves.toBe('expired')
  })

  it('defaults to a five minute TTL', () => {
    expect(INTENT_QUEUE_TTL_MS).toBe(5 * 60_000)
    const clock = { t: 0 }
    const q = new IntentQueue({ now: () => clock.t })
    q.enqueue(env({ type: 'chat.say', text: 'x' }))
    clock.t = 5 * 60_000
    expect(q.expire()).toBe(0)
    clock.t += 1
    expect(q.expire()).toBe(1)
  })
})

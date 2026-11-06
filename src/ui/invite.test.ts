import { describe, expect, it } from 'vitest'
import { buildInviteUrl, copyText, describeRelays, relayHealth, relayHost, relayStatusLine } from './invite'

describe('buildInviteUrl', () => {
  it('returns the connection invite link', () => {
    expect(buildInviteUrl({ inviteLink: () => 'https://x.test/#/join/naddr1abc?k=key' })).toBe('https://x.test/#/join/naddr1abc?k=key')
  })
})

describe('copyText', () => {
  it('uses the async clipboard when it works', async () => {
    const written: string[] = []
    const ok = await copyText('link', { clipboard: { writeText: async (t) => { written.push(t) } }, execCopy: () => { throw new Error('should not run') } })
    expect(ok).toBe(true)
    expect(written).toEqual(['link'])
  })
  it('falls back to the legacy copy command when the clipboard rejects', async () => {
    let legacy = ''
    const ok = await copyText('link', { clipboard: { writeText: async () => { throw new Error('denied') } }, execCopy: (t) => { legacy = t; return true } })
    expect(ok).toBe(true)
    expect(legacy).toBe('link')
  })
  it('reports failure instead of throwing or prompting', async () => {
    expect(await copyText('link', { clipboard: null, execCopy: () => false })).toBe(false)
    expect(await copyText('link', { clipboard: null, execCopy: () => { throw new Error('no document') } })).toBe(false)
    expect(await copyText('link', { clipboard: null })).toBe(false)
  })
})

describe('relay copy', () => {
  it('shortens relay urls to hosts', () => {
    expect(relayHost('wss://relay.damus.io/')).toBe('relay.damus.io')
    expect(relayHost('not a url')).toBe('not a url')
  })
  it('describes the relay list', () => {
    expect(describeRelays([])).toBe('the relays')
    expect(describeRelays(['wss://nos.lol'])).toBe('nos.lol')
    expect(describeRelays(['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net'])).toBe('nos.lol and 2 more')
  })
  it('states how many relays carry the game', () => {
    expect(relayStatusLine(0, 0)).toBe('No relays configured')
    expect(relayStatusLine(0, 5)).toBe('Not reachable on any of 5 relays yet')
    expect(relayStatusLine(3, 5)).toBe('Shared on 3 of 5 relays')
    expect(relayStatusLine(5, 5)).toBe('Shared on 5 relays')
    expect(relayStatusLine(1, 1)).toBe('Shared on 1 relay')
  })
})

describe('relayHealth', () => {
  it('is good with every relay open or at least half of them', () => {
    expect(relayHealth(5, 5)).toEqual({ open: 5, total: 5, level: 'good' })
    expect(relayHealth(2, 4)).toEqual({ open: 2, total: 4, level: 'good' })
    expect(relayHealth(3, 5).level).toBe('good')
    expect(relayHealth(1, 1).level).toBe('good')
  })
  it('is degraded when fewer than half are open', () => {
    expect(relayHealth(2, 5)).toEqual({ open: 2, total: 5, level: 'degraded' })
    expect(relayHealth(1, 4).level).toBe('degraded')
    expect(relayHealth(1, 3).level).toBe('degraded')
  })
  it('is none with nothing open or no relays at all', () => {
    expect(relayHealth(0, 5)).toEqual({ open: 0, total: 5, level: 'none' })
    expect(relayHealth(0, 0)).toEqual({ open: 0, total: 0, level: 'none' })
  })
  it('clamps counts that disagree with the relay list', () => {
    expect(relayHealth(7, 5)).toEqual({ open: 5, total: 5, level: 'good' })
    expect(relayHealth(-1, 5)).toEqual({ open: 0, total: 5, level: 'none' })
  })
})

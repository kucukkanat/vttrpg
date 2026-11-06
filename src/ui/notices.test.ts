import { describe, expect, it } from 'vitest'
import type { ChatMessage, Note, Token } from '@/core/doc'
import type { NoteId, PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import type { LocalNotice } from '@/state/store'
import { diffNotices, noteVisible, type NoticeSnapshot } from './notices'
import { interleave } from './panels/ChatPanel'

const me = 'me' as PlayerPubkey
const other = 'other' as PlayerPubkey
const scene = 's1' as SceneId

function token(id: string, name: string, owner?: PlayerPubkey): Token {
  return { id: id as TokenId, scene, name, owner, color: '#fff', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1, vision: 0, light: 0, hidden: false, conditions: [] }
}
function note(id: string, title: string, sharedWith: Note['sharedWith']): Note {
  return { id: id as NoteId, title, body: '', sharedWith, createdAt: 1, updatedAt: 1 }
}
function snap(p: Partial<NoticeSnapshot> = {}): NoticeSnapshot {
  return { loaded: true, tokens: {}, notes: {}, gmAway: null, ...p }
}
const byId = <T extends { id: string }>(...xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x])) as Record<string, T>
const player = { me, isGm: false }

describe('diffNotices: tokens', () => {
  it('says "You are X" when an unowned token becomes mine and I owned nothing', () => {
    const prev = snap({ tokens: byId(token('t1', 'Pip')) })
    const next = snap({ tokens: byId(token('t1', 'Pip', me)) })
    expect(diffNotices(prev, next, player)).toEqual([{ kind: 'claimed', token: 't1', text: 'You are Pip' }])
  })
  it('says "GM gave you X" for a second token, a new token, or a reassigned one', () => {
    const mine = token('t1', 'Pip', me)
    expect(diffNotices(snap({ tokens: byId(mine, token('t2', 'Rat Guard')) }), snap({ tokens: byId(mine, token('t2', 'Rat Guard', me)) }), player))
      .toEqual([{ kind: 'given', token: 't2', text: 'GM gave you Rat Guard' }])
    expect(diffNotices(snap(), snap({ tokens: byId(token('t3', 'Owl', me)) }), player))
      .toEqual([{ kind: 'given', token: 't3', text: 'GM gave you Owl' }])
    expect(diffNotices(snap({ tokens: byId(token('t4', 'Fox', other)) }), snap({ tokens: byId(token('t4', 'Fox', me)) }), player))
      .toEqual([{ kind: 'given', token: 't4', text: 'GM gave you Fox' }])
  })
  it('only the first of several simultaneous claims reads "You are"', () => {
    const prev = snap({ tokens: byId(token('t1', 'Pip'), token('t2', 'Rat Guard')) })
    const next = snap({ tokens: byId(token('t1', 'Pip', me), token('t2', 'Rat Guard', me)) })
    expect(diffNotices(prev, next, player).map((n) => n.kind)).toEqual(['claimed', 'given'])
  })
  it('says "GM removed X" when my token is deleted and tells me when it goes to someone else', () => {
    const prev = snap({ tokens: byId(token('t1', 'Pip', me), token('t2', 'Rat Guard', me)) })
    const next = snap({ tokens: byId(token('t2', 'Rat Guard', other)) })
    expect(diffNotices(prev, next, player)).toEqual([
      { kind: 'removed', token: 't1', text: 'GM removed Pip' },
      { kind: 'removed', token: 't2', text: 'Rat Guard is no longer yours' },
    ])
  })
  it('ignores tokens that were never mine and unchanged ownership', () => {
    const prev = snap({ tokens: byId(token('t1', 'Pip', me), token('t2', 'Rat Guard', other)) })
    const next = snap({ tokens: byId({ ...token('t1', 'Pip', me), name: 'Pip the Bold' }) })
    expect(diffNotices(prev, next, player)).toEqual([])
  })
})

describe('diffNotices: handouts', () => {
  it('announces a note that became visible to me, by creation or by sharing', () => {
    const prev = snap({ notes: byId(note('n1', 'Map', 'gm')) })
    const next = snap({ notes: byId(note('n1', 'Map', 'all'), note('n2', 'Letter', [me])) })
    expect(diffNotices(prev, next, player)).toEqual([
      { kind: 'handout', note: 'n1', text: 'New handout · Map' },
      { kind: 'handout', note: 'n2', text: 'New handout · Letter' },
    ])
  })
  it('stays quiet for private notes, notes shared with others, and edits to visible notes', () => {
    const prev = snap({ notes: byId(note('n1', 'Map', 'all')) })
    const next = snap({ notes: byId({ ...note('n1', 'Map', 'all'), body: 'edited' }, note('n2', 'Secret', 'gm'), note('n3', 'Theirs', [other])) })
    expect(diffNotices(prev, next, player)).toEqual([])
  })
  it('falls back to Untitled', () => {
    expect(diffNotices(snap(), snap({ notes: byId(note('n1', '', 'all')) }), player)[0]?.text).toBe('New handout · Untitled')
  })
  it('noteVisible mirrors the Journal rule', () => {
    expect(noteVisible(note('n', 'x', 'gm'), me, false)).toBe(false)
    expect(noteVisible(note('n', 'x', 'gm'), me, true)).toBe(true)
    expect(noteVisible(note('n', 'x', [other]), me, false)).toBe(false)
    expect(noteVisible(note('n', 'x', [me]), me, false)).toBe(true)
  })
})

describe('diffNotices: GM presence', () => {
  it('reports away and back transitions only', () => {
    expect(diffNotices(snap({ gmAway: false }), snap({ gmAway: true }), player)).toEqual([{ kind: 'gm-away', text: 'GM is away' }])
    expect(diffNotices(snap({ gmAway: true }), snap({ gmAway: false }), player)).toEqual([{ kind: 'gm-back', text: 'GM is back' }])
    expect(diffNotices(snap({ gmAway: true }), snap({ gmAway: true }), player)).toEqual([])
  })
  it('says nothing while the GM has never been seen', () => {
    expect(diffNotices(snap({ gmAway: null }), snap({ gmAway: true }), player)).toEqual([])
    expect(diffNotices(snap({ gmAway: false }), snap({ gmAway: null }), player)).toEqual([])
  })
})

describe('diffNotices: who and when', () => {
  it('never notifies the GM', () => {
    const prev = snap({ tokens: byId(token('t1', 'Pip')), gmAway: false })
    const next = snap({ tokens: byId(token('t1', 'Pip', me)), notes: byId(note('n1', 'Map', 'all')), gmAway: true })
    expect(diffNotices(prev, next, { me, isGm: true })).toEqual([])
  })
  it('treats the document arriving as a baseline, not as events', () => {
    const prev = snap({ loaded: false })
    const next = snap({ tokens: byId(token('t1', 'Pip', me)), notes: byId(note('n1', 'Map', 'all')) })
    expect(diffNotices(prev, next, player)).toEqual([])
  })
})

describe('interleave', () => {
  const msg = (id: string, at: number): ChatMessage => ({ id, author: other, at, kind: 'say', text: id })
  const sys = (id: string, at: number): LocalNotice => ({ id, at, text: id })
  it('merges chat and notices by time, chat first on ties', () => {
    const out = interleave([msg('a', 1), msg('c', 3), msg('e', 5)], [sys('b', 2), sys('c2', 3), sys('f', 6)])
    expect(out.map((l) => l.id)).toEqual(['a', 'b', 'c', 'c2', 'e', 'f'])
  })
  it('returns chat untouched without notices', () => {
    const chat = [msg('a', 1)]
    expect(interleave(chat, [])).toEqual(chat)
  })
})

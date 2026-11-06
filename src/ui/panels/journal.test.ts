import { describe, expect, it } from 'vitest'
import type { Note } from '@/core/doc'
import type { NoteId, PlayerPubkey } from '@/core/ids'
import { canSee, handoutLine, shareAnnouncement, sortNotes } from './JournalPanel'

const pk = (s: string) => s as PlayerPubkey
const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1' as NoteId, title: 'Map of the cellar', body: '', sharedWith: 'gm', createdAt: 1, updatedAt: 1, ...over,
})

describe('journal visibility', () => {
  it('shows the GM everything and players only what is shared with them', () => {
    const me = pk('me')
    expect(canSee(note(), me, true)).toBe(true)
    expect(canSee(note(), me, false)).toBe(false)
    expect(canSee(note({ sharedWith: 'all' }), me, false)).toBe(true)
    expect(canSee(note({ sharedWith: [pk('other')] }), me, false)).toBe(false)
    expect(canSee(note({ sharedWith: [pk('other'), me] }), me, false)).toBe(true)
  })
  it('sorts pinned handouts first, then newest', () => {
    const a = note({ id: 'a' as NoteId, updatedAt: 3 })
    const b = note({ id: 'b' as NoteId, updatedAt: 1, pinned: true })
    const c = note({ id: 'c' as NoteId, updatedAt: 2 })
    expect(sortNotes([a, b, c]).map((n) => n.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('handout chat line', () => {
  it('names the note, or Untitled', () => {
    expect(handoutLine({ title: 'Map of the cellar' })).toBe('GM shared a handout: Map of the cellar')
    expect(handoutLine({ title: '' })).toBe('GM shared a handout: Untitled')
  })
  it('posts when a note is created already shared', () => {
    expect(shareAnnouncement(undefined, note({ sharedWith: 'all' }))).toBe('GM shared a handout: Map of the cellar')
    expect(shareAnnouncement(undefined, note({ sharedWith: [pk('p1')] }))).toBe('GM shared a handout: Map of the cellar')
  })
  it('stays quiet for private notes and for edits of notes already shared', () => {
    expect(shareAnnouncement(undefined, note())).toBeNull()
    expect(shareAnnouncement(note({ sharedWith: 'all' }), note({ sharedWith: 'all', body: 'edited' }))).toBeNull()
    expect(shareAnnouncement(note({ sharedWith: 'all' }), note())).toBeNull()
  })
  it('posts when an edit takes a private note public', () => {
    expect(shareAnnouncement(note(), note({ sharedWith: 'all' }))).toBe('GM shared a handout: Map of the cellar')
  })
})

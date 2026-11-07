import { describe, expect, it } from 'vitest'
import { isRedoKey, isUndoKey } from './useShortcuts'

const key = (k: string, mods: Partial<Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods }) as KeyboardEvent

describe('undo and redo keys', () => {
  it('Cmd/Ctrl+Z undoes', () => {
    expect(isUndoKey(key('z', { metaKey: true }))).toBe(true)
    expect(isUndoKey(key('z', { ctrlKey: true }))).toBe(true)
    expect(isUndoKey(key('z'))).toBe(false)
    expect(isUndoKey(key('Z', { metaKey: true, shiftKey: true }))).toBe(false)
  })
  it('Cmd/Ctrl+Shift+Z and Ctrl+Y redo', () => {
    expect(isRedoKey(key('Z', { metaKey: true, shiftKey: true }))).toBe(true)
    expect(isRedoKey(key('z', { ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isRedoKey(key('y', { ctrlKey: true }))).toBe(true)
    expect(isRedoKey(key('y', { metaKey: true }))).toBe(false)
    expect(isRedoKey(key('z', { metaKey: true }))).toBe(false)
    expect(isRedoKey(key('z', { metaKey: true, shiftKey: true, altKey: true }))).toBe(false)
  })
})

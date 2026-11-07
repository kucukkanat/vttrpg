import { describe, expect, it } from 'vitest'
import { describeEntry, entryOp, nextMode, propKeyAction, type KeyState } from './transformKeys'

const base: KeyState = { mode: 'translate', entry: null, hasSelection: true, advancedAllowed: true }
const key = (k: string, mods: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({ key: k, ...mods })

describe('prop power keys', () => {
  it('Tab cycles move, turn and scale (Shift goes back)', () => {
    expect(propKeyAction(key('Tab'), base)).toEqual({ type: 'mode', mode: 'rotate' })
    expect(propKeyAction(key('Tab', { shiftKey: true }), base)).toEqual({ type: 'mode', mode: 'scale' })
    expect(nextMode('scale')).toBe('translate')
  })
  it('X / Y / Z start typing on that axis; digits, Enter applies, Esc cancels', () => {
    const a = propKeyAction(key('x'), base)
    expect(a).toEqual({ type: 'entry', entry: { axis: 'x', text: '' } })
    let s: KeyState = { ...base, entry: { axis: 'x', text: '' } }
    for (const k of ['1', '.', '5', '*', '2']) {
      const r = propKeyAction(key(k), s)
      if (r?.type !== 'entry') throw new Error('expected entry')
      s = { ...s, entry: r.entry }
    }
    expect(s.entry).toEqual({ axis: 'x', text: '1.5*2' })
    expect(propKeyAction(key('Backspace'), s)).toEqual({ type: 'entry', entry: { axis: 'x', text: '1.5*' } })
    expect(propKeyAction(key('z'), s)).toEqual({ type: 'entry', entry: { axis: 'z', text: '1.5*2' } })
    expect(propKeyAction(key('Enter'), s)).toEqual({ type: 'apply', mode: 'translate', axis: 'x', value: 3 })
    expect(propKeyAction(key('Escape'), s)).toEqual({ type: 'entry', entry: null })
    // Unparsable text keeps typing instead of applying.
    expect(propKeyAction(key('Enter'), { ...s, entry: { axis: 'x', text: '1+' } })).toEqual({ type: 'entry', entry: { axis: 'x', text: '1+' } })
    // Letters and Delete cannot reach the table while typing.
    expect(propKeyAction(key('g'), s)?.type).toBe('entry')
    expect(propKeyAction(key('Delete'), s)?.type).toBe('entry')
  })
  it('digits start typing in turn and scale modes only', () => {
    expect(propKeyAction(key('4'), { ...base, mode: 'rotate' })).toEqual({ type: 'entry', entry: { axis: null, text: '4' } })
    expect(propKeyAction(key('4'), base)).toBeNull()
  })
  it('R turns 15°, Shift+R 90°; End drops; Delete removes; A toggles advanced; Esc deselects', () => {
    expect(propKeyAction(key('r'), base)).toEqual({ type: 'turn', degrees: 15 })
    expect(propKeyAction(key('R', { shiftKey: true }), base)).toEqual({ type: 'turn', degrees: 90 })
    expect(propKeyAction(key('End'), base)).toEqual({ type: 'drop' })
    expect(propKeyAction(key('Delete'), base)).toEqual({ type: 'remove' })
    expect(propKeyAction(key('Backspace'), base)).toEqual({ type: 'remove' })
    expect(propKeyAction(key('a'), base)).toEqual({ type: 'advanced' })
    expect(propKeyAction(key('a'), { ...base, advancedAllowed: false })).toBeNull()
    expect(propKeyAction(key('Escape'), base)).toEqual({ type: 'deselect' })
  })
  it('leaves G, T, M and the rest to the table', () => {
    for (const k of ['g', 'G', 't', 'm', 'f', 'q', '1']) expect(propKeyAction(key(k), base)).toBeNull()
  })
  it('does nothing without a selection except paste', () => {
    const none = { ...base, hasSelection: false }
    for (const k of ['x', 'r', 'Delete', 'Tab', 'End', 'Escape']) expect(propKeyAction(key(k), none)).toBeNull()
    expect(propKeyAction(key('v', { ctrlKey: true }), none)).toEqual({ type: 'paste' })
    expect(propKeyAction(key('c', { metaKey: true }), none)).toBeNull()
  })
  it('Ctrl/Cmd C, V and D copy, paste and duplicate; other chords pass', () => {
    expect(propKeyAction(key('c', { ctrlKey: true }), base)).toEqual({ type: 'copy' })
    expect(propKeyAction(key('V', { metaKey: true }), base)).toEqual({ type: 'paste' })
    expect(propKeyAction(key('d', { ctrlKey: true }), base)).toEqual({ type: 'duplicate' })
    expect(propKeyAction(key('z', { ctrlKey: true }), base)).toBeNull()
    expect(propKeyAction(key('z', { ctrlKey: true, shiftKey: true }), base)).toBeNull()
  })
  it('turns typed numbers into group transforms', () => {
    const c = { x: 1, y: 0, z: 1 }
    expect(entryOp('translate', 'y', 0.5, c)).toEqual({ kind: 'move', delta: { x: 0, y: 0.5, z: 0 } })
    expect(entryOp('translate', null, 2, c)).toBeNull()
    const r = entryOp('rotate', null, 90, c)
    expect(r).toMatchObject({ kind: 'rotate', axis: { x: 0, y: 1, z: 0 }, centre: c })
    expect(r && r.kind === 'rotate' ? r.angle : 0).toBeCloseTo(Math.PI / 2)
    expect(entryOp('scale', null, 2, c)).toEqual({ kind: 'scale', factor: 2, centre: c })
    expect(entryOp('scale', 'x', 2, c)).toEqual({ kind: 'scale-axis', axis: 'x', factor: 2, centre: c })
    expect(entryOp('scale', null, -1, c)).toBeNull()
    // Local space: a frame turned 90° about Y moves "X" along world -Z.
    const q = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }
    const m = entryOp('translate', 'x', 1, c, q)
    if (m?.kind !== 'move') throw new Error('expected move')
    expect(m.delta.x).toBeCloseTo(0)
    expect(m.delta.z).toBeCloseTo(-1)
  })
  it('describes the entry for the readout', () => {
    expect(describeEntry('rotate', { axis: null, text: '45' })).toBe('Turn · Y · 45°')
    expect(describeEntry('translate', { axis: 'x', text: '' })).toBe('Move · X · …')
  })
})

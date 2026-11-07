import { beforeEach, describe, expect, it } from 'vitest'
import { useGame } from '@/state/store'
import type { TokenId } from '@/core/ids'
import { doubleTapEdit, resetTaps, tapTwice } from './editTap'
import { useTableUi } from './tableState'

const rat = 'rat' as TokenId

describe('double tap to edit', () => {
  beforeEach(() => { resetTaps(); useTableUi.setState({ editMode: false }); useGame.getState().setSelection(null) })

  it('needs two taps on the same thing, close in time and space', () => {
    expect(tapTwice('token:a', 10, 10, 0)).toBe(false)
    expect(tapTwice('token:a', 12, 11, 200)).toBe(true)
    expect(tapTwice('token:a', 12, 11, 300)).toBe(false) // a third tap starts over
    expect(tapTwice('token:b', 12, 11, 400)).toBe(false)
    expect(tapTwice('token:a', 12, 11, 2000)).toBe(false)
  })
  it('enters edit mode on the item, and any double tap leaves it', () => {
    expect(doubleTapEdit(null)).toBe(false)
    expect(doubleTapEdit({ kind: 'token', id: rat })).toBe(true)
    expect(useTableUi.getState().editMode).toBe(true)
    expect(useGame.getState().selection).toEqual({ kind: 'token', id: rat })
    expect(doubleTapEdit(null)).toBe(true)
    expect(useTableUi.getState().editMode).toBe(false)
  })
})

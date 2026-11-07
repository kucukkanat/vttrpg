/**
 * Two-tap move on touch: with one of your tokens selected, a tap on a floor cell previews the
 * move (path, distance and a ghost at the destination); a second tap on the same cell, or the
 * bar's Move button, commits it; a tap on another cell previews that one instead; Cancel or Esc
 * drops the preview. Dragging a token still moves it in one go. Mouse clicks are unchanged
 * (a click on the floor deselects). The "Tap twice to move" preference turns it off.
 *
 * Pure decisions live here so the sequence can be tested without a canvas; `MovePreview.tsx`
 * wires them to the floor and the bar.
 */
import { create } from 'zustand'
import type { GridSpec } from '@/core/geometry'
import type { TokenId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { snapToCell } from './grid'
import { groupMoveTargets, type DragGhost } from './tableState'

/** A previewed move: the same shape as a drag ghost, plus the destination cell's key. */
export interface MoveDraft extends DragGhost {
  cell: string
}

export const useMoveDraft = create<{ draft: MoveDraft | null }>(() => ({ draft: null }))

export function setMoveDraft(draft: MoveDraft | null): void {
  if (useMoveDraft.getState().draft !== draft) useMoveDraft.setState({ draft })
}

export type MoveTapResult =
  | { kind: 'preview'; draft: MoveDraft }
  | { kind: 'commit'; draft: MoveDraft }
  /** The tap landed on the token's own cell: drop the preview. */
  | { kind: 'cancel' }

/** What a floor tap on `tap` does given the current preview. */
export function stepMoveTap(draft: MoveDraft | null, tap: MoveDraft): MoveTapResult {
  if (draft && draft.token === tap.token && draft.cell === tap.cell) return { kind: 'commit', draft }
  const fromCell = Math.abs(tap.x - tap.from.x) < 1e-4 && Math.abs(tap.z - tap.from.z) < 1e-4
  if (fromCell) return { kind: 'cancel' }
  return { kind: 'preview', draft: tap }
}

/** The draft for a tap at world (x, z) for a token standing at `from`. */
export function draftAt(grid: GridSpec, token: TokenId, from: { x: number; z: number }, x: number, z: number): MoveDraft {
  const s = snapToCell(grid, x, z)
  return { token, x: s.x, z: s.z, from: { x: from.x, z: from.z }, cell: `${s.cell.q},${s.cell.r}` }
}

/** Whether a missed click came from a finger or a pen (the gesture only replaces taps, never mouse clicks). */
export function isTouchTap(e: { pointerType?: string }, coarse: boolean): boolean {
  if (e.pointerType === 'touch' || e.pointerType === 'pen') return true
  if (e.pointerType === 'mouse') return false
  return coarse
}

type MovableToken = { id: TokenId; scene: string; position: { x: number; z: number } }

/**
 * The intents a committed draft sends: the leader, then every other selected token the viewer may
 * move by the same delta, snapped (as a group drag does). Tokens that would not move are skipped.
 */
export function moveIntents(
  draft: MoveDraft,
  tokens: Readonly<Record<TokenId, MovableToken>>,
  selected: readonly TokenId[],
  mayMove: (id: TokenId) => boolean,
  grid: GridSpec,
  floorY: number,
): Intent[] {
  const leader = tokens[draft.token]
  if (!leader || !mayMove(draft.token)) return []
  const moved = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.abs(a.x - b.x) > 1e-4 || Math.abs(a.z - b.z) > 1e-4
  if (!moved(draft, leader.position)) return []
  const out: Intent[] = [{ type: 'token.move', token: draft.token, position: { x: draft.x, y: floorY, z: draft.z } }]
  for (const m of groupMoveTargets(draft, tokens, selected)) {
    const t = tokens[m.token]
    if (!t || !mayMove(m.token)) continue
    const p = snapToCell(grid, m.x, m.z)
    if (moved(p, t.position)) out.push({ type: 'token.move', token: m.token, position: { x: p.x, y: floorY, z: p.z } })
  }
  return out
}

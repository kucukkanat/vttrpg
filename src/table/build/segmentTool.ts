/**
 * The Invisible wall and Invisible door tools (Library, Walls & doors shelf): the clicks that
 * stretch a segment prop. Pure; `SegmentLayer` feeds it pointer events.
 *
 * - Wall: click to start, click to end. The end starts the next wall, so a run of clicks draws a
 *   chain of walls; Esc (or a right-click) stops the chain.
 * - Door: press and drag across the doorway, or click both ends. One door per stretch.
 *
 * Ends snap to the half-cell lattice and to the ends of walls already there (`snapWallPoint`).
 */
import type { Prop } from '@/core/doc'
import type { PropId, SceneId } from '@/core/ids'
import { segmentProp } from '@/core/partsMigration'
import type { P2 } from '@/core/propParts'

export type SegmentKind = 'wall' | 'door'

/** Shorter than this (metres) is a click on the same spot, not a segment. */
export const MIN_SEGMENT = 0.05

export interface SegmentState {
  /** Where the segment being stretched starts; null before the first click. */
  start: P2 | null
}

export const IDLE: SegmentState = Object.freeze({ start: null }) as SegmentState

/** What one click (or a drag's release) does: the state after it, and the segment to place, if any. */
export function segmentClick(kind: SegmentKind, state: SegmentState, at: P2): { state: SegmentState; place: { a: P2; b: P2 } | null } {
  if (!state.start) return { state: { start: at }, place: null }
  if (Math.hypot(at.x - state.start.x, at.z - state.start.z) < MIN_SEGMENT) return { state, place: null }
  const place = { a: state.start, b: at }
  // A wall chain carries on from where this one ended; a door is done.
  return { state: kind === 'wall' ? { start: at } : IDLE, place }
}

/** A press-drag-release of the door tool: a door from the press to the release, when long enough. */
export function segmentDrag(from: P2, to: P2): { a: P2; b: P2 } | null {
  return Math.hypot(to.x - from.x, to.z - from.z) < MIN_SEGMENT ? null : { a: from, b: to }
}

/** The prop a stretch places. */
export function stretchedProp(kind: SegmentKind, seg: { a: P2; b: P2 }, scene: SceneId, y: number, id: PropId): Prop {
  return segmentProp({ id, scene, a: seg.a, b: seg.b, y, ...(kind === 'door' ? { door: { open: false } } : {}) })
}

/**
 * The power keys for a prop selection in Build or edit mode, as a pure step from a key press and
 * the current key state to an action (`PropEditor.tsx` performs it). Ignored while typing; the
 * caller checks that.
 *
 *   Tab / Shift+Tab   cycle move → turn → scale (the gizmo highlights the mode)
 *   X, Y, Z           constrain to an axis and start typing a number (Y is up)
 *   digits            in turn or scale mode, start typing without an axis (turn: Y, scale: uniform)
 *   Enter             apply the typed number (an expression: `45`, `1.5*2`); Esc cancels it
 *   R / Shift+R       turn 15° / 90° around Y
 *   End               drop onto the surface below
 *   Delete, Backspace remove the selection (one undo step)
 *   A                 the advanced gizmo (3-axis rings, per-axis scale, numeric inspector)
 *   Esc               deselect
 *   Ctrl/Cmd+C, V, D  copy, paste, duplicate
 *
 * G stays the grid, T the tactical view; Z only constrains while a prop selection is being edited.
 */
import type { Vec3 } from '@/core/geometry'
import type { GizmoMode } from '../editing'
import { evalExpr } from './expr'
import { AXES, type Axis, type GroupOp } from './groupTransform'

/** Typed number in progress: `X 2 Enter` moves two metres along x. */
export interface TransformEntry {
  axis: Axis | null
  text: string
}

export interface KeyState {
  mode: GizmoMode
  entry: TransformEntry | null
  hasSelection: boolean
  /** Phones and the like: no advanced mode. */
  advancedAllowed: boolean
}

export interface KeyInput {
  key: string
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}

export type KeyAction =
  | { type: 'mode'; mode: GizmoMode }
  | { type: 'entry'; entry: TransformEntry | null }
  | { type: 'apply'; mode: GizmoMode; axis: Axis | null; value: number }
  | { type: 'turn'; degrees: number }
  | { type: 'drop' }
  | { type: 'remove' }
  | { type: 'advanced' }
  | { type: 'deselect' }
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'duplicate' }

export const MODES: readonly GizmoMode[] = ['translate', 'rotate', 'scale']
export const MODE_LABEL: Record<GizmoMode, string> = { translate: 'Move', rotate: 'Turn', scale: 'Scale' }

/** Turn steps of the R key and the ring, degrees. */
export const TURN_STEP = 15
export const TURN_STEP_COARSE = 90

export function nextMode(mode: GizmoMode, back = false): GizmoMode {
  const i = MODES.indexOf(mode)
  return MODES[(i + (back ? MODES.length - 1 : 1)) % MODES.length]!
}

const ENTRY_CHARS = /^[0-9.,+\-*/()]$/
const axisOf = (key: string): Axis | null => (key === 'x' || key === 'X' ? 'x' : key === 'y' || key === 'Y' ? 'y' : key === 'z' || key === 'Z' ? 'z' : null)

/**
 * What a key press does, or null when the key is not ours (let it through: G, T, M…).
 * A non-null result means the caller should `preventDefault()`.
 */
export function propKeyAction(e: KeyInput, s: KeyState): KeyAction | null {
  const mod = !!(e.ctrlKey || e.metaKey)
  if (mod) {
    if (e.altKey || e.shiftKey) return null
    const k = e.key.toLowerCase()
    if (k === 'v') return { type: 'paste' }
    if (!s.hasSelection) return null
    if (k === 'c') return { type: 'copy' }
    if (k === 'd') return { type: 'duplicate' }
    return null
  }
  if (!s.hasSelection) return null

  if (s.entry) {
    const entry = s.entry
    const axis = axisOf(e.key)
    if (axis) return { type: 'entry', entry: { ...entry, axis } }
    if (e.key === 'Escape') return { type: 'entry', entry: null }
    if (e.key === 'Tab') return { type: 'mode', mode: nextMode(s.mode, !!e.shiftKey) }
    if (e.key === 'Backspace' || e.key === 'Delete') return { type: 'entry', entry: { ...entry, text: entry.text.slice(0, -1) } }
    if (e.key === 'Enter') {
      const value = evalExpr(entry.text)
      if (value === null) return { type: 'entry', entry }
      return { type: 'apply', mode: s.mode, axis: entry.axis, value }
    }
    if (ENTRY_CHARS.test(e.key)) return { type: 'entry', entry: { ...entry, text: entry.text + e.key } }
    // Swallow anything else while typing a number so it cannot trigger a table key.
    return e.key.length === 1 ? { type: 'entry', entry } : null
  }

  if (e.altKey) return null
  const axis = axisOf(e.key)
  if (axis && !e.shiftKey) return { type: 'entry', entry: { axis, text: '' } }
  switch (e.key) {
    case 'Tab': return { type: 'mode', mode: nextMode(s.mode, !!e.shiftKey) }
    case 'r': case 'R': return { type: 'turn', degrees: e.shiftKey ? TURN_STEP_COARSE : TURN_STEP }
    case 'End': return { type: 'drop' }
    case 'Delete': case 'Backspace': return { type: 'remove' }
    case 'a': case 'A': return s.advancedAllowed && !e.shiftKey ? { type: 'advanced' } : null
    case 'Escape': return { type: 'deselect' }
  }
  if (/^[0-9.]$/.test(e.key) && s.mode !== 'translate') return { type: 'entry', entry: { axis: null, text: e.key } }
  return null
}

/**
 * The group transform a typed number stands for, about `centre`: move `value` metres along the
 * axis, turn `value` degrees around it (Y without an axis), or scale by `value` along it
 * (uniform without an axis). `frame` orients the axes (local space); null for invalid input.
 */
export function entryOp(mode: GizmoMode, axis: Axis | null, value: number, centre: Vec3, frame?: { x: number; y: number; z: number; w: number }): GroupOp | null {
  if (!Number.isFinite(value)) return null
  switch (mode) {
    case 'translate': {
      if (!axis || value === 0) return null
      const d = frame ? rotateVec(AXES[axis], frame) : AXES[axis]
      return { kind: 'move', delta: { x: d.x * value, y: d.y * value, z: d.z * value } }
    }
    case 'rotate': {
      const a = AXES[axis ?? 'y']
      return value === 0 ? null : { kind: 'rotate', axis: frame ? rotateVec(a, frame) : a, angle: (value * Math.PI) / 180, centre }
    }
    case 'scale':
      if (value <= 0 || value === 1) return null
      return axis ? { kind: 'scale-axis', axis, factor: value, centre, ...(frame ? { frame } : {}) } : { kind: 'scale', factor: value, centre }
  }
}

/** `v` turned by the unit quaternion `q`. */
function rotateVec(v: Vec3, q: { x: number; y: number; z: number; w: number }): Vec3 {
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  }
}

/** One line for the readout while typing: "Turn · Y · 45". */
export function describeEntry(mode: GizmoMode, entry: TransformEntry): string {
  const axis = entry.axis ? entry.axis.toUpperCase() : mode === 'rotate' ? 'Y' : mode === 'scale' ? 'all axes' : 'pick X, Y or Z'
  const unit = mode === 'translate' ? ' m' : mode === 'rotate' ? '°' : '×'
  return `${MODE_LABEL[mode]} · ${axis} · ${entry.text || '…'}${entry.text ? unit : ''}`
}

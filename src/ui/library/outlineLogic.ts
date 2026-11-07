/**
 * The "In this scene" outliner: what is placed in the shown scene, grouped as Tokens, Props and
 * Lights and searched, plus what a row does (select on the board and frame it, shift-click adds a
 * prop, hide a token, delete). The rows are pure; the actions go through the game store, the
 * camera rig and one intent each.
 */
import type { PlacedLight, Prop, Token } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import type { LightId, PropId, SceneId, TokenId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { useGame } from '@/state/store'
import { focusToken, requestView, tableRuntime } from '@/table/tableState'
import { matchesQuery } from './shelves'

export type OutlineKind = 'token' | 'prop' | 'light'

export interface OutlineRow {
  kind: OutlineKind
  id: string
  name: string
  /** "hidden", "6 cells", "Crate · locked". */
  meta: string
  position: Vec3
  hidden?: boolean
}

export interface Outline {
  tokens: OutlineRow[]
  props: OutlineRow[]
  lights: OutlineRow[]
}

const byName = (a: OutlineRow, b: OutlineRow) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

/** Everything placed in `scene`, by kind, searched by name (and meta), sorted by name. */
export function sceneOutline(
  src: { tokens: Readonly<Record<string, Token>>; props: Readonly<Record<string, Prop>>; lights: Readonly<Record<string, PlacedLight>> },
  scene: SceneId | null,
  query = '',
): Outline {
  if (!scene) return { tokens: [], props: [], lights: [] }
  const keep = (r: OutlineRow) => matchesQuery(`${r.name} ${r.meta}`, query)
  const tokens = Object.values(src.tokens).filter((t) => t.scene === scene).map((t): OutlineRow => ({
    kind: 'token', id: t.id, name: t.name || 'Token', meta: [t.hidden ? 'hidden' : '', t.owner ? 'player' : ''].filter(Boolean).join(' · '),
    position: t.position, hidden: t.hidden,
  })).filter(keep).sort(byName)
  const props = Object.values(src.props).filter((p) => p.scene === scene).map((p): OutlineRow => ({
    kind: 'prop', id: p.id, name: p.name || 'Prop', meta: [p.locked ? 'locked' : '', p.solid ? 'solid' : ''].filter(Boolean).join(' · '), position: p.position,
  })).filter(keep).sort(byName)
  const lights = Object.values(src.lights).filter((l) => l.scene === scene).map((l, i): OutlineRow => ({
    kind: 'light', id: l.id, name: `Light ${i + 1}`, meta: `${l.radius} ${l.radius === 1 ? 'cell' : 'cells'} · ${l.color}`, position: l.position,
  })).filter(keep)
  return { tokens, props, lights }
}

/** Rows in the outliner's order (tokens, props, lights), for keyboard walking and counting. */
export function outlineRows(o: Outline): OutlineRow[] {
  return [...o.tokens, ...o.props, ...o.lights]
}

const DEFAULT_OFFSET: Vec3 = { x: 0, y: 9, z: 9 }

/** A camera pose that looks at `target` from where the camera already sits relative to its target. */
export function framePose(target: Vec3, camera: { position: Vec3 | null; target: Vec3 | null }): { pos: Vec3; target: Vec3 } {
  const off = camera.position && camera.target
    ? { x: camera.position.x - camera.target.x, y: camera.position.y - camera.target.y, z: camera.position.z - camera.target.z }
    : DEFAULT_OFFSET
  return { pos: { x: target.x + off.x, y: target.y + off.y, z: target.z + off.z }, target: { ...target } }
}

/**
 * A click on a row: select it on the board and frame the camera on it. Shift adds a prop to the
 * prop selection (or takes it out) and a token to the token selection, without moving the camera.
 */
export function selectOutlineRow(row: OutlineRow, opts: { shift?: boolean } = {}): void {
  const g = useGame.getState()
  if (row.kind === 'token') {
    const id = row.id as TokenId
    if (opts.shift) { g.toggleSelected(id); return }
    g.setSelectedToken(id)
    focusToken(id)
    return
  }
  if (row.kind === 'prop') {
    const id = row.id as PropId
    if (opts.shift) { g.togglePropSelected(id); return }
    g.setPropSelection([id])
  } else {
    g.clearSelection()
  }
  requestView(framePose(row.position, { position: tableRuntime.cameraPosition, target: tableRuntime.cameraTarget }))
}

/** The intent a row's delete sends (one undo step for props). */
export function removeIntent(row: Pick<OutlineRow, 'kind' | 'id'>): Intent {
  switch (row.kind) {
    case 'token': return { type: 'token.remove', token: row.id as TokenId }
    case 'prop': return { type: 'props.remove', ids: [row.id as PropId] }
    case 'light': return { type: 'light.remove', light: row.id as LightId }
  }
}

/** The intent a token row's eye sends: hide it, or show it to the players. */
export function hideIntent(row: Pick<OutlineRow, 'id' | 'hidden'>): Intent {
  return { type: 'token.update', token: row.id as TokenId, patch: { hidden: !row.hidden } }
}

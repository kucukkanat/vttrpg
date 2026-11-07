/**
 * Copy, paste and duplicate for props. Pure: the codec, the clipboard contents and the props a
 * paste or duplicate places; the keys and the system clipboard live in `PropEditor.tsx`.
 *
 * ## Text format
 *
 *   vttprops:<base64url of UTF-8 JSON>
 *
 * The JSON is `{ "v": 1, "cell": 1.5, "items": [...] }`. `cell` is the cell size the props were
 * copied on (informational: paste keeps real sizes). Each item is a prefab prop (`PrefabProp`
 * in src/core/doc.ts, minus authorship): `name`, `model` (the full AssetRef, so the asset resolves
 * in another game), `position` relative to the copied group's centre, `rotation` (Euler radians),
 * `scale` (per-axis vector), and when set `catalogue`, `tags`, `solid`, `locked`. Numbers are
 * rounded to 1e-5. The prefix makes the text safe to recognise when it is pasted anywhere.
 */
import type { AssetRef } from '@/core/assets'
import type { Prop } from '@/core/doc'
import type { Vec3 } from '@/core/geometry'
import { newId, type PropId, type SceneId } from '@/core/ids'
import { propScale } from '@/core/props'
import { partsOf, type PropParts } from '@/core/catalogueParts'
import { badParts, hasModel } from '@/core/propParts'
import { selectionCentre, poseOf } from './groupTransform'

export const CLIPBOARD_PREFIX = 'vttprops:'
export const CLIPBOARD_VERSION = 1
/** Most props one clipboard text may carry (same bound as one `props.place`). */
export const MAX_CLIP_ITEMS = 5000

export interface ClipItem {
  name: string
  model: AssetRef
  /** Offset from the group's centre (metres). */
  position: Vec3
  rotation: Vec3
  scale: Vec3
  catalogue?: string
  tags?: string[]
  solid?: boolean
  locked?: boolean
  /** Light, wall and door parts (validated like a prop's when read back). */
  fixtures?: PropParts
}

export interface PropClip {
  v: typeof CLIPBOARD_VERSION
  cell?: number
  items: ClipItem[]
}

const r5 = (n: number) => {
  const v = Math.round(n * 1e5) / 1e5
  return v === 0 ? 0 : v
}
const rvec = (v: Vec3): Vec3 => ({ x: r5(v.x), y: r5(v.y), z: r5(v.z) })

/**
 * The clipboard for `props`: positions relative to their centre (floor centre, lowest height).
 * `fit` gives the legacy fit of a version 1 prop so its number scale is copied as a vector.
 */
export function clipFromProps(props: readonly Prop[], cell?: number, fit: (id: PropId) => number = () => 1): PropClip {
  const centre = selectionCentre(props.map((p) => poseOf(p, fit(p.id))))
  const items = props.map((p): ClipItem => {
    const item: ClipItem = {
      name: p.name,
      model: p.model,
      position: rvec({ x: p.position.x - centre.x, y: p.position.y - centre.y, z: p.position.z - centre.z }),
      rotation: rvec(p.rotation),
      scale: rvec(propScale(p, fit(p.id))),
    }
    if (p.catalogue) item.catalogue = p.catalogue
    if (p.tags?.length) item.tags = [...p.tags]
    if (p.solid) item.solid = true
    if (p.locked) item.locked = true
    const parts = partsOf(p)
    if (parts) item.fixtures = parts
    return item
  })
  return cell ? { v: CLIPBOARD_VERSION, cell, items } : { v: CLIPBOARD_VERSION, items }
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(b64: string): string {
  const std = b64.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function encodeClip(clip: PropClip): string {
  return CLIPBOARD_PREFIX + toBase64Url(JSON.stringify(clip))
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isVec = (v: unknown): v is Vec3 => !!v && typeof v === 'object' && finite((v as Vec3).x) && finite((v as Vec3).y) && finite((v as Vec3).z)
const isAsset = (v: unknown): v is AssetRef => {
  const a = v as AssetRef
  return !!a && typeof a === 'object' && typeof a.sha256 === 'string' && typeof a.kind === 'string' && typeof a.mime === 'string'
    && finite(a.size) && Array.isArray(a.sources) && a.sources.every((s) => typeof s === 'string')
}

function readItem(raw: unknown): ClipItem | null {
  const it = raw as ClipItem
  if (!it || typeof it !== 'object' || typeof it.name !== 'string' || !isAsset(it.model)) return null
  if (!isVec(it.position) || !isVec(it.rotation) || !isVec(it.scale)) return null
  if (it.scale.x <= 0 || it.scale.y <= 0 || it.scale.z <= 0) return null
  const out: ClipItem = { name: it.name.slice(0, 200), model: it.model, position: it.position, rotation: it.rotation, scale: it.scale }
  if (typeof it.catalogue === 'string') out.catalogue = it.catalogue
  if (Array.isArray(it.tags) && it.tags.every((t) => typeof t === 'string')) out.tags = it.tags.slice(0, 64)
  if (it.solid === true) out.solid = true
  if (it.locked === true) out.locked = true
  if (it.fixtures && typeof it.fixtures === 'object' && !badParts(it.fixtures, false)) { const f = partsOf(it.fixtures); if (f) out.fixtures = f }
  if (!hasModel(out) && !out.fixtures) return null
  return out
}

/** The clipboard in `text`, or null when it is not (valid) prop clipboard text. */
export function decodeClip(text: string | null | undefined): PropClip | null {
  const t = text?.trim()
  if (!t || !t.startsWith(CLIPBOARD_PREFIX)) return null
  try {
    const data = JSON.parse(fromBase64Url(t.slice(CLIPBOARD_PREFIX.length))) as PropClip
    if (!data || data.v !== CLIPBOARD_VERSION || !Array.isArray(data.items) || data.items.length === 0 || data.items.length > MAX_CLIP_ITEMS) return null
    const items: ClipItem[] = []
    for (const raw of data.items) {
      const it = readItem(raw)
      if (!it) return null
      items.push(it)
    }
    return finite(data.cell) && data.cell > 0 ? { v: CLIPBOARD_VERSION, cell: data.cell, items } : { v: CLIPBOARD_VERSION, items }
  } catch {
    return null
  }
}

/** New props for `clip` with its centre at `at` (fresh ids, in `scene`). */
export function propsFromClip(clip: PropClip, scene: SceneId, at: Vec3, makeId: () => PropId = () => newId<'PropId'>() as PropId): Prop[] {
  return clip.items.map((it): Prop => {
    const p: Prop = {
      id: makeId(), scene, name: it.name, model: it.model,
      position: rvec({ x: at.x + it.position.x, y: at.y + it.position.y, z: at.z + it.position.z }),
      rotation: { ...it.rotation }, scale: { ...it.scale },
    }
    if (it.catalogue) p.catalogue = it.catalogue
    if (it.tags) p.tags = [...it.tags]
    if (it.solid) p.solid = true
    if (it.locked) p.locked = true
    if (it.fixtures) Object.assign(p, partsOf(it.fixtures))
    return p
  })
}

/**
 * Copies of `props` moved by `offset` (Ctrl/Cmd-D: one cell along x; Alt-drag: the drag's
 * delta), with fresh ids and no authorship. A version 1 scale is copied as its vector.
 */
export function duplicateProps(props: readonly Prop[], offset: Vec3, fit: (id: PropId) => number = () => 1, makeId: () => PropId = () => newId<'PropId'>() as PropId): Prop[] {
  return props.map((src): Prop => {
    const { createdBy: _c, editedBy: _e, legacyFit: _l, ...rest } = src
    return {
      ...rest,
      id: makeId(),
      position: rvec({ x: src.position.x + offset.x, y: src.position.y + offset.y, z: src.position.z + offset.z }),
      rotation: { ...src.rotation },
      scale: { ...propScale(src, fit(src.id)) },
      ...(src.tags ? { tags: [...src.tags] } : {}),
    }
  })
}

/** The offset Ctrl/Cmd-D duplicates by: one cell along x. */
export function duplicateOffset(cellSize: number): Vec3 {
  return { x: cellSize, y: 0, z: 0 }
}

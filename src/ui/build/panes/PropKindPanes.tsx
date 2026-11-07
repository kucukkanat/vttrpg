/**
 * Inspector sections for the kind-specific parts of a prop: a light (colour, reach, intensity,
 * flicker, kind), a wall (what it blocks, length), a door (open, locked, width). The Inspector
 * mounts `PropKindPane` under the common prop fields; it renders nothing for a plain prop, except
 * the offer to give a visible model a light.
 *
 * Every change is one `props.update` (so undo and redo come for free), except opening a door,
 * which is play: it goes through `prop.door` like a click on the table and is never undone.
 * Sliders and the colour picker preview locally and commit when they settle.
 */
import { useEffect, useRef, useState } from 'react'
import type { GameController } from '../../controller'
import type { Prop, PropDoor, PropLight, PropWall, WallBlocks } from '@/core/doc'
import type { PropPatch } from '@/core/intents'
import { hasModel, LIGHT_RADIUS_MAX, WARM_LIGHT } from '@/core/propParts'

const SETTLE_MS = 250

/** A value edited locally and committed once it stops changing (sliders, the colour picker). */
function useSettled<T>(value: T, commit: (v: T) => void): [T, (v: T) => void] {
  const [local, setLocal] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(commit)
  latest.current = commit
  useEffect(() => { setLocal(value) }, [value])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const set = (v: T) => {
    setLocal(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; latest.current(v) }, SETTLE_MS)
  }
  return [local, set]
}

const deg = (r: number) => Math.round((r * 180) / Math.PI)
const rad = (d: number) => (d * Math.PI) / 180

export function PropKindPane({ controller, prop }: { controller: GameController; prop: Prop }) {
  const patch = (p: PropPatch) => void controller.dispatch({ type: 'props.update', updates: [{ id: prop.id, patch: p }] })
  const visible = hasModel(prop)
  return (
    <>
      {prop.light && <LightSection light={prop.light} onChange={(light) => patch({ light })} onRemove={visible || prop.wall || prop.door ? () => patch({ light: null }) : undefined} />}
      {prop.wall && <WallSection wall={prop.wall} visible={visible} onChange={(wall) => patch({ wall })} />}
      {prop.door && (
        <DoorSection door={prop.door} visible={visible}
          onOpen={(open) => void controller.dispatch({ type: 'prop.door', prop: prop.id, open })}
          onChange={(door) => patch({ door })} />
      )}
      {!prop.light && visible && (
        <button type="button" className="tiny" title="Make this model shine (a warm, flickering light)" onClick={() => patch({ light: { ...WARM_LIGHT, radius: 4 } })}>
          Add a light
        </button>
      )}
    </>
  )
}

function LightSection({ light, onChange, onRemove }: { light: PropLight; onChange(l: PropLight): void; onRemove?: (() => void) | undefined }) {
  const set = (p: Partial<PropLight>) => {
    const next = { ...light, ...p } as PropLight & Record<string, unknown>
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    onChange(next)
  }
  const [color, setColor] = useSettled(light.color, (c) => set({ color: c }))
  const [radius, setRadius] = useSettled(light.radius, (r) => set({ radius: r }))
  const [intensity, setIntensity] = useSettled(light.intensity ?? 1, (k) => set({ intensity: k === 1 ? undefined : k }))
  const [angle, setAngle] = useSettled(deg(light.angle ?? Math.PI / 6), (d) => set({ angle: rad(d) }))
  const spot = light.kind === 'spot'
  return (
    <fieldset className="bw-group pk-light">
      <legend>Light</legend>
      <label className="bw-field pk-row">Colour
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Light colour" />
      </label>
      <label className="bw-field pk-row">Reach <span className="muted small">{radius} cells</span>
        <input type="range" min={1} max={Math.min(30, LIGHT_RADIUS_MAX)} step={1} value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Light reach in cells" />
      </label>
      <label className="bw-field pk-row">Intensity <span className="muted small">{Math.round(intensity * 100)}%</span>
        <input type="range" min={0.1} max={2} step={0.05} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} aria-label="Light intensity" />
      </label>
      <label className="check"><input type="checkbox" checked={!!light.flicker} onChange={(e) => set({ flicker: e.target.checked || undefined })} /> Flicker (a flame)</label>
      <label className="bw-field pk-row">Kind
        <select value={light.kind ?? 'point'} onChange={(e) => set(e.target.value === 'spot' ? { kind: 'spot', angle: light.angle ?? Math.PI / 6 } : { kind: undefined, angle: undefined })} aria-label="Light kind">
          <option value="point">All around</option>
          <option value="spot">Spot (shines down)</option>
        </select>
      </label>
      {spot && (
        <label className="bw-field pk-row">Cone <span className="muted small">{angle}°</span>
          <input type="range" min={5} max={85} step={1} value={angle} onChange={(e) => setAngle(Number(e.target.value))} aria-label="Spot cone angle" />
        </label>
      )}
      {onRemove && <button type="button" className="tiny" onClick={onRemove}>Remove the light</button>}
    </fieldset>
  )
}

const BLOCKS: { id: WallBlocks; label: string }[] = [
  { id: 'both', label: 'Sight and movement' },
  { id: 'move', label: 'Movement only (fence, window)' },
  { id: 'sight', label: 'Sight only (curtain)' },
]

/** A length in metres, blank meaning "from the model" for visible models. */
function LengthField({ label, value, optional, onCommit }: { label: string; value: number | undefined; optional: boolean; onCommit(v: number | undefined): void }) {
  const [text, setText] = useState(value === undefined ? '' : String(Math.round(value * 100) / 100))
  useEffect(() => setText(value === undefined ? '' : String(Math.round(value * 100) / 100)), [value])
  const commit = () => {
    const t = text.trim()
    if (!t && optional) { if (value !== undefined) onCommit(undefined); return }
    const n = Number(t)
    if (Number.isFinite(n) && n > 0 && n !== value) onCommit(n)
    else setText(value === undefined ? '' : String(value))
  }
  return (
    <label className="bw-field pk-row">{label}
      <input type="number" min={0.05} step={0.25} inputMode="decimal" value={text} placeholder={optional ? 'from the model' : undefined}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
    </label>
  )
}

function WallSection({ wall, visible, onChange }: { wall: PropWall; visible: boolean; onChange(w: PropWall): void }) {
  return (
    <fieldset className="bw-group pk-wall">
      <legend>Wall</legend>
      <label className="bw-field pk-row">Blocks
        <select value={wall.blocks} onChange={(e) => onChange({ ...wall, blocks: e.target.value as WallBlocks })} aria-label="What the wall blocks">
          {BLOCKS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
      <LengthField label="Length (m)" value={wall.length} optional={visible}
        onCommit={(length) => onChange(length === undefined ? { blocks: wall.blocks } : { ...wall, length })} />
    </fieldset>
  )
}

function DoorSection({ door, visible, onOpen, onChange }: { door: PropDoor; visible: boolean; onOpen(open: boolean): void; onChange(d: PropDoor): void }) {
  return (
    <fieldset className="bw-group pk-door">
      <legend>Door</legend>
      <label className="check"><input type="checkbox" checked={door.open} onChange={(e) => onOpen(e.target.checked)} /> Open</label>
      <label className="check" title="Players cannot open a locked door; the GM still can">
        <input type="checkbox" checked={!!door.locked} onChange={(e) => { const { locked: _l, ...rest } = door; onChange(e.target.checked ? { ...rest, locked: true } : rest) }} /> Locked
      </label>
      <LengthField label="Width (m)" value={door.width} optional={visible}
        onCommit={(width) => { const { width: _w, ...rest } = door; onChange(width === undefined ? rest : { ...rest, width }) }} />
    </fieldset>
  )
}

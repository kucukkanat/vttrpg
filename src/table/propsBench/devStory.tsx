/**
 * Prop benchmark (#/dev/props-bench): N props of K library models on a grid, with an FPS, frame
 * time and draw-call readout. Query parameters after the story name:
 *
 *   n=2000          number of props
 *   models=20       distinct catalogue models, spread over the catalogue
 *   instancing=0    every prop standalone (the old renderer), for a before/after
 *   tier=high       graphics tier for the run (stored like the settings page does)
 *   spacing=1.5     metres between props
 *
 * The readout is also on `window.__propsBench` for scripted runs (scripts or headless Chrome).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { CatalogueEntry } from '@/core/catalogue'
import type { Prop, Scene } from '@/core/doc'
import type { AssetHash, PlayerPubkey, PropId, SceneId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { useGame } from '@/state/store'
import { loadBuiltinCatalogue } from '@/ui/catalogue'
import { TableCanvas } from '../TableCanvas'
import { setPropInstancing } from '../Props'
import { isGraphicsSetting, setGraphicsSetting } from '../graphics'

const SCENE = 'props-bench' as SceneId
const GM = 'gm'.padEnd(64, '0') as PlayerPubkey
const CELL = 1.5
/** A 1×1 grey PNG: the floor image only gives the camera the field's extent. */
const FLOOR_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN4++7dfwAJVAPcKpzGhgAAAABJRU5ErkJggg=='

export interface BenchReadout {
  props: number
  models: number
  instancing: boolean
  fps: number
  frameMs: number
  calls: number
  triangles: number
  /** Seconds since the props were placed. */
  elapsed: number
}

/** Scripted checks: a prop's screen position and the current selection. */
export interface BenchApi {
  screenOf(id: string): { x: number; y: number } | null
  selection(): string | null
  propAt(id: string): { x: number; z: number } | null
}

declare global {
  interface Window { __propsBench?: BenchReadout; __propsBenchApi?: BenchApi }
}

function params() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const num = (k: string, d: number) => { const v = Number(q.get(k)); return Number.isFinite(v) && v > 0 ? v : d }
  return {
    n: Math.floor(num('n', 2000)),
    models: Math.floor(num('models', 20)),
    instancing: q.get('instancing') !== '0',
    tier: q.get('tier') ?? 'high',
    spacing: num('spacing', CELL),
  }
}

/** `k` models spread evenly over the catalogue (sorted by id, so runs are repeatable). */
export function pickModels(entries: readonly CatalogueEntry[], k: number): CatalogueEntry[] {
  const list = [...entries].filter((e) => e.model && (e.size?.[0] ?? 1) <= 3 && (e.size?.[2] ?? 1) <= 3).sort((a, b) => a.id.localeCompare(b.id))
  if (list.length <= k) return list
  const step = list.length / k
  return Array.from({ length: k }, (_, i) => list[Math.floor(i * step)]!)
}

/** N props on a square grid centred on the origin, models round-robin, turns varied. */
export function benchProps(models: readonly CatalogueEntry[], n: number, spacing: number): Prop[] {
  const cols = Math.ceil(Math.sqrt(n))
  const half = ((cols - 1) * spacing) / 2
  return Array.from({ length: n }, (_, i) => {
    const e = models[i % models.length]!
    return {
      id: `bench-${i}` as PropId, scene: SCENE, name: e.title, model: e.model, catalogue: e.id,
      position: { x: (i % cols) * spacing - half, y: 0, z: Math.floor(i / cols) * spacing - half },
      rotation: { x: 0, y: ((i * 7) % 8) * (Math.PI / 4), z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }
  })
}

/** Stands in for the GM's reducer: prop updates only, enough to commit drags in the story. */
function applyLocally(intent: Intent) {
  if (intent.type !== 'props.update') return
  const s = useGame.getState()
  const next = { ...s.props }
  for (const u of intent.updates) { const p = next[u.id]; if (p) next[u.id] = { ...p, ...u.patch, id: p.id } }
  s._replaceFromDoc({ props: next })
}

function sceneFor(n: number, spacing: number): Scene {
  const side = Math.ceil(Math.sqrt(n)) * spacing + 2 * CELL
  const cells = Math.ceil(side / CELL)
  return {
    id: SCENE, name: 'Props benchmark', cameraMode: 'orbit', darkness: 0.2,
    grid: { type: 'square', cellSize: CELL, origin: { x: 0, y: 0, z: 0 } },
    image: {
      asset: { sha256: 'bench-floor' as AssetHash, kind: 'image', mime: 'image/png', size: 0, name: 'floor.png', sources: [FLOOR_PNG] },
      widthCells: cells, heightCells: cells,
    },
  }
}

/** Measures inside the canvas: frame time over the last second and the renderer's counters. */
function Probe({ onSample }: { onSample(r: Pick<BenchReadout, 'fps' | 'frameMs' | 'calls' | 'triangles'>): void }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    window.__propsBenchApi = {
      screenOf: (id) => {
        const p = useGame.getState().props[id as PropId]
        if (!p) return null
        const v = new Vector3(p.position.x, p.position.y + 0.3, p.position.z).project(camera)
        const r = gl.domElement.getBoundingClientRect()
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
      },
      selection: () => { const s = useGame.getState().selection; return s ? `${s.kind}:${s.id}` : null },
      propAt: (id) => { const p = useGame.getState().props[id as PropId]; return p ? { x: p.position.x, z: p.position.z } : null },
    }
    return () => { delete window.__propsBenchApi }
  }, [camera, gl])
  const frames = useRef<number[]>([])
  const last = useRef(0)
  useFrame(() => {
    const now = performance.now()
    const f = frames.current
    f.push(now)
    while (f.length && now - f[0]! > 1000) f.shift()
    if (now - last.current < 500 || f.length < 2) return
    last.current = now
    const span = f[f.length - 1]! - f[0]!
    const fps = ((f.length - 1) * 1000) / span
    // The counters still hold the previous frame (they reset when a render starts).
    onSample({ fps, frameMs: span / (f.length - 1), calls: gl.info.render.calls, triangles: gl.info.render.triangles })
  })
  return null
}

export function DevStory() {
  const opts = useMemo(params, [])
  const [ready, setReady] = useState(false)
  const [models, setModels] = useState(0)
  const [readout, setReadout] = useState<BenchReadout | null>(null)
  const placedAt = useRef(0)

  useEffect(() => {
    setPropInstancing(opts.instancing)
    if (isGraphicsSetting(opts.tier)) setGraphicsSetting(opts.tier)
    let live = true
    void loadBuiltinCatalogue().then((entries) => {
      if (!live) return
      const picked = pickModels(entries, opts.models)
      const props = benchProps(picked, opts.n, opts.spacing)
      useGame.getState()._replaceFromDoc({
        meta: { name: 'Props benchmark', gm: GM, pack: 'mausritter' as never, activeScene: SCENE, createdAt: Date.now() },
        scenes: { [SCENE]: sceneFor(opts.n, opts.spacing) } as Record<SceneId, Scene>,
        tokens: {},
        props: Object.fromEntries(props.map((p) => [p.id, p])) as Record<PropId, Prop>,
        characters: {},
        chat: [],
        fog: {},
      })
      placedAt.current = performance.now()
      setModels(picked.length)
      setReady(true)
    })
    return () => { live = false; setPropInstancing(true) }
  }, [opts])

  const onSample = (s: Pick<BenchReadout, 'fps' | 'frameMs' | 'calls' | 'triangles'>) => {
    const r: BenchReadout = { ...s, props: opts.n, models, instancing: opts.instancing, elapsed: (performance.now() - placedAt.current) / 1000 }
    window.__propsBench = r
    setReadout(r)
  }

  if (!ready) return <div style={{ padding: 24 }}>Loading the catalogue…</div>
  return (
    <div style={{ position: 'relative', height: '100vh', background: '#0b0b10' }}>
      <TableCanvas onIntent={applyLocally} onPresence={() => {}}>
        <Probe onSample={onSample} />
      </TableCanvas>
      <div
        data-testid="bench-readout"
        style={{ position: 'absolute', top: 8, left: 8, padding: '6px 10px', background: 'rgba(0,0,0,0.7)', color: '#eee', font: '12px/1.5 monospace', borderRadius: 4, pointerEvents: 'none' }}
      >
        <div>{opts.n} props · {models} models · instancing {opts.instancing ? 'on' : 'off'} · tier {opts.tier}</div>
        {readout
          ? <div>{readout.fps.toFixed(1)} fps · {readout.frameMs.toFixed(2)} ms · {readout.calls} draw calls · {(readout.triangles / 1000).toFixed(0)}k tris</div>
          : <div>measuring…</div>}
      </div>
    </div>
  )
}

export default DevStory

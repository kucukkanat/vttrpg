/**
 * Kit benchmark (#/dev/kit-bench): a generated dungeon of N kit pieces over two levels, with an
 * FPS, frame time, draw-call and document-size readout. Query parameters after the story name:
 *
 *   n=10000      pieces (rooms are added until there are at least this many)
 *   levels=2     storeys
 *   tier=high    graphics tier for the run
 *   cut=1        cutaway level (default: everything shown)
 *
 * The readout is also on `window.__kitBench` for scripted runs.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as Y from 'yjs'
import type { Scene } from '@/core/doc'
import type { AssetHash, PlayerPubkey, SceneId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { MAX_TILES_PER_INTENT, type SceneTiles } from '@/core/kits'
import { useGame } from '@/state/store'
import { applyTilesIntent } from '@/state/tilesDoc'
import { TableCanvas } from '../TableCanvas'
import { isGraphicsSetting, setGraphicsSetting } from '../graphics'
import { benchDungeon, benchRoomsFor, ROOM, tileCount } from './bench'
import { useKitUi } from './kitState'
import { loadKitManifest } from './manifests'

const SCENE = 'kit-bench' as SceneId
const GM = 'gm'.padEnd(64, '0') as PlayerPubkey
const CELL = 1.5
const FLOOR_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN4++7dfwAJVAPcKpzGhgAAAABJRU5ErkJggg=='

export interface KitBenchReadout {
  pieces: number
  rooms: number
  levels: number
  chunks: number
  fps: number
  frameMs: number
  calls: number
  triangles: number
  /** `Y.encodeStateAsUpdate` of a document holding the tiles, bytes. */
  docBytes: number
  bytesPerPiece: number
  /** Time to generate the dungeon and to apply it to a Y.Doc, ms. */
  generateMs: number
  applyMs: number
  elapsed: number
}

declare global {
  interface Window { __kitBench?: KitBenchReadout }
}

function params() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const num = (k: string, d: number) => { const v = Number(q.get(k)); return Number.isFinite(v) && v >= 0 && q.has(k) ? v : d }
  return { n: Math.floor(num('n', 10000)), levels: Math.max(1, Math.floor(num('levels', 2))), tier: q.get('tier') ?? 'high', cut: q.has('cut') ? num('cut', 0) : null }
}

/** Size of a Yjs document holding `tiles`, written as the paint intents would write it. */
function docSize(tiles: SceneTiles): { bytes: number; ms: number } {
  const doc = new Y.Doc()
  const keys: string[] = [], values: string[] = []
  for (const id in tiles.chunks) for (const [k, v] of Object.entries(tiles.chunks[id]!)) { keys.push(k); values.push(v) }
  const t0 = performance.now()
  for (let i = 0; i < keys.length; i += MAX_TILES_PER_INTENT) {
    const intent: Intent = { type: 'tiles.place', scene: SCENE, kits: tiles.kits.filter((k): k is string => !!k), keys: keys.slice(i, i + MAX_TILES_PER_INTENT), values: values.slice(i, i + MAX_TILES_PER_INTENT) }
    doc.transact(() => applyTilesIntent(doc, intent))
  }
  const ms = performance.now() - t0
  return { bytes: Y.encodeStateAsUpdate(doc).byteLength, ms }
}

function sceneFor(rooms: number): Scene {
  const cells = rooms * ROOM + 4
  return {
    id: SCENE, name: 'Kit benchmark', cameraMode: 'orbit', darkness: 0.2,
    grid: { type: 'square', cellSize: CELL, origin: { x: 0, y: 0, z: 0 } },
    image: {
      asset: { sha256: 'kit-bench-floor' as AssetHash, kind: 'image', mime: 'image/png', size: 0, name: 'floor.png', sources: [FLOOR_PNG] },
      widthCells: cells, heightCells: cells, offset: { x: (cells / 2 - 2.5) * CELL, y: 0, z: (cells / 2 - 2.5) * CELL },
    },
  }
}

function Probe({ onSample }: { onSample(r: Pick<KitBenchReadout, 'fps' | 'frameMs' | 'calls' | 'triangles'>): void }) {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const frames = useRef<number[]>([])
  const last = useRef(0)
  useFrame(() => {
    // Keep frames coming so the rate measures the scene, not the idle cap.
    invalidate()
    const now = performance.now()
    const f = frames.current
    f.push(now)
    while (f.length && now - f[0]! > 1000) f.shift()
    if (now - last.current < 500 || f.length < 2) return
    last.current = now
    const span = f[f.length - 1]! - f[0]!
    onSample({ fps: ((f.length - 1) * 1000) / span, frameMs: span / (f.length - 1), calls: gl.info.render.calls, triangles: gl.info.render.triangles })
  })
  return null
}

export function DevStory() {
  const opts = useMemo(params, [])
  const [info, setInfo] = useState<Omit<KitBenchReadout, 'fps' | 'frameMs' | 'calls' | 'triangles' | 'elapsed'> | null>(null)
  const [readout, setReadout] = useState<KitBenchReadout | null>(null)
  const placedAt = useRef(0)

  useEffect(() => {
    if (isGraphicsSetting(opts.tier)) setGraphicsSetting(opts.tier)
    if (opts.cut !== null) useKitUi.getState().set({ cutaway: opts.cut })
    let live = true
    void loadKitManifest('kaykit-dungeon').then((m) => {
      if (!live || !m) return
      const t0 = performance.now()
      const rooms = benchRoomsFor(m, opts.n, opts.levels)
      const tiles = benchDungeon(m, rooms, opts.levels)
      const generateMs = performance.now() - t0
      const size = docSize(tiles)
      const pieces = tileCount(tiles)
      useGame.getState()._replaceFromDoc({
        meta: { name: 'Kit benchmark', gm: GM, pack: 'mausritter' as never, activeScene: SCENE, createdAt: Date.now() },
        scenes: { [SCENE]: sceneFor(rooms) } as Record<SceneId, Scene>,
        tokens: {}, props: {}, characters: {}, chat: [], fog: {},
        tiles: { [SCENE]: tiles } as Record<SceneId, SceneTiles>,
      })
      placedAt.current = performance.now()
      setInfo({ pieces, rooms, levels: opts.levels, chunks: Object.keys(tiles.chunks).length, docBytes: size.bytes, bytesPerPiece: size.bytes / pieces, generateMs, applyMs: size.ms })
    })
    return () => { live = false; useKitUi.getState().set({ cutaway: null }) }
  }, [opts])

  const onSample = (s: Pick<KitBenchReadout, 'fps' | 'frameMs' | 'calls' | 'triangles'>) => {
    if (!info) return
    const r: KitBenchReadout = { ...info, ...s, elapsed: (performance.now() - placedAt.current) / 1000 }
    window.__kitBench = r
    setReadout(r)
  }

  if (!info) return <div style={{ padding: 24 }}>Generating the dungeon…</div>
  return (
    <div style={{ position: 'relative', height: '100vh', background: '#0b0b10' }}>
      <TableCanvas onIntent={() => {}} onPresence={() => {}}>
        <Probe onSample={onSample} />
      </TableCanvas>
      <div data-testid="bench-readout" style={{ position: 'absolute', top: 8, left: 8, padding: '6px 10px', background: 'rgba(0,0,0,0.7)', color: '#eee', font: '12px/1.5 monospace', borderRadius: 4, pointerEvents: 'none' }}>
        <div>{info.pieces} pieces · {info.rooms}×{info.rooms} rooms · {info.levels} levels · {info.chunks} chunks · tier {opts.tier}</div>
        <div>doc {(info.docBytes / 1024).toFixed(0)} KiB ({info.bytesPerPiece.toFixed(1)} B/piece) · generate {info.generateMs.toFixed(0)} ms · apply {info.applyMs.toFixed(0)} ms</div>
        {readout
          ? <div>{readout.fps.toFixed(1)} fps · {readout.frameMs.toFixed(2)} ms · {readout.calls} draw calls · {(readout.triangles / 1000).toFixed(0)}k tris</div>
          : <div>measuring…</div>}
      </div>
    </div>
  )
}

export default DevStory

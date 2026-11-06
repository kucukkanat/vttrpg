/**
 * Dev story for the VFX layer (#/dev/table-vfx): a floor, two tokens seeded into the store,
 * buttons that fire each preset between them, skill combos from the Mausritter pack, and a
 * weather switch. Stats in the corner keep an eye on the frame rate.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stats } from '@react-three/drei'
import type { GameEvent, Token } from '@/core/doc'
import type { PlayerPubkey, SceneId, TokenId } from '@/core/ids'
import type { VfxCue } from '@/core/pack'
import { useGame } from '@/state/store'
import { VfxLayer } from './VfxLayer'
import { CameraShake } from './shake'
import type { VfxEvent } from './schedule'
import { WeatherLayer, type WeatherKind } from './weather/WeatherLayer'

const SCENE = 'vfx-dev' as SceneId
const GM = 'gm'.padEnd(64, '0') as PlayerPubkey
const A = 'tok-a' as TokenId
const B = 'tok-b' as TokenId
const CELL = 1.5
const POINT = { x: 1.5, y: 0, z: -3 }
const BOUNDS = { min: [-8, 0, -8] as [number, number, number], max: [8, 4, 8] as [number, number, number] }

const tokens: Token[] = [
  { id: A, scene: SCENE, name: 'Pip', color: '#d98f3e', position: { x: -3, y: 0, z: 2.25 }, rotationY: 0, scale: 1, vision: 4, light: 2, hidden: false, conditions: [] },
  { id: B, scene: SCENE, name: 'Rat', color: '#6c7a8a', position: { x: 3, y: 0, z: -1.5 }, rotationY: Math.PI, scale: 1.3, vision: 2, light: 0, hidden: false, conditions: [] },
]

function seedStore() {
  useGame.setState({
    meta: { name: 'VFX dev', gm: GM, pack: 'mausritter' as never, activeScene: SCENE, createdAt: Date.now() },
    scenes: {},
    tokens: Object.fromEntries(tokens.map((t) => [t.id, t])) as Record<TokenId, Token>,
    characters: {}, chat: [], fog: {}, events: [],
  })
}

type Preset = { label: string; cues: VfxCue[]; targets?: TokenId[]; point?: boolean }

const SINGLE: Preset[] = [
  { label: 'hit', cues: [{ at: 0, preset: 'hit', from: 'target', color: '#ffffff', duration: 250 }] },
  { label: 'projectile', cues: [{ at: 0, preset: 'projectile', from: 'source', to: 'target', color: '#ffb347', duration: 350 }] },
  { label: 'ring', cues: [{ at: 0, preset: 'ring', from: 'target', color: '#8ab4ff', duration: 600 }] },
  { label: 'aura', cues: [{ at: 0, preset: 'aura', from: 'target', color: '#7be0a0', duration: 1200 }] },
  { label: 'beam', cues: [{ at: 0, preset: 'beam', from: 'source', to: 'target', color: '#8ab4ff', duration: 300 }] },
  { label: 'shake', cues: [{ at: 0, preset: 'shake', duration: 400 }] },
  { label: 'rain (local)', cues: [{ at: 0, preset: 'rain', from: 'target', duration: 2500 }] },
  { label: 'sound (no-op)', cues: [{ at: 0, preset: 'sound', asset: 'none' }] },
]

const COMBOS: Preset[] = [
  {
    label: 'fireball → point', point: true,
    cues: [
      { at: 0, preset: 'projectile', from: 'source', to: 'point', color: '#ff7a1a', duration: 400 },
      { at: 400, preset: 'ring', from: 'point', color: '#ff4500', duration: 700 },
      { at: 400, preset: 'shake', duration: 300 },
      { at: 450, preset: 'hit', from: 'target', color: '#ffb347', duration: 300 },
    ],
  },
  {
    label: 'magic missile',
    cues: [
      { at: 0, preset: 'beam', from: 'source', to: 'target', color: '#8ab4ff', duration: 300 },
      { at: 300, preset: 'hit', from: 'target', color: '#c7dbff', duration: 250 },
    ],
  },
  {
    label: 'heal',
    cues: [
      { at: 0, preset: 'aura', from: 'target', color: '#7be0a0', duration: 900 },
      { at: 200, preset: 'ring', from: 'target', color: '#b8f5c9', duration: 500 },
    ],
  },
  {
    label: 'hit both tokens', targets: [A, B],
    cues: [{ at: 0, preset: 'hit', from: 'target', color: '#ff6b6b', duration: 300 }],
  },
]

const WEATHER: WeatherKind[] = ['none', 'rain', 'snow', 'embers', 'fog']

export function DevStory() {
  const [ready, setReady] = useState(false)
  const [events, setEvents] = useState<GameEvent[]>([])
  const [weather, setWeather] = useState<WeatherKind>('none')
  const [flip, setFlip] = useState(false)
  const [count, setCount] = useState(0)

  useEffect(() => { seedStore(); setReady(true) }, [])

  const fire = useCallback((p: Preset) => {
    const source = flip ? B : A
    const target = flip ? A : B
    const ev: VfxEvent = {
      id: crypto.randomUUID(), at: Date.now(), kind: 'vfx', cues: p.cues, scene: SCENE,
      source, targets: p.targets ?? [target], point: p.point ? POINT : undefined, label: p.label,
    }
    setEvents((list) => [...list.slice(-39), ev])
    setCount((n) => n + 1)
  }, [flip])

  const stress = useCallback(() => {
    const list: GameEvent[] = []
    for (let i = 0; i < 6; i++) {
      const p = [...SINGLE.slice(0, 5), ...COMBOS][i % 9]
      list.push({ id: crypto.randomUUID(), at: Date.now(), kind: 'vfx', cues: p.cues.map((c) => ({ ...c, at: c.at + i * 120 })), scene: SCENE, source: A, targets: p.targets ?? [B], point: POINT, label: p.label })
    }
    setEvents((prev) => [...prev.slice(-30), ...list])
    setCount((n) => n + list.length)
  }, [])

  const tokenList = useMemo(() => tokens, [])
  if (!ready) return null

  const bar: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px', background: '#17161c', color: '#ddd', fontSize: 13, flexWrap: 'wrap' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0b0b10' }}>
      <style>{'.vfx-stats{top:auto!important;bottom:0!important}'}</style>
      <div style={bar}>
        <strong>vfx dev</strong>
        {SINGLE.map((p) => <button key={p.label} onClick={() => fire(p)}>{p.label}</button>)}
        <span style={{ opacity: 0.5 }}>|</span>
        {COMBOS.map((p) => <button key={p.label} onClick={() => fire(p)}>{p.label}</button>)}
        <span style={{ opacity: 0.5 }}>|</span>
        <button onClick={stress}>stress ×6</button>
        <button onClick={() => setFlip((v) => !v)}>direction: {flip ? 'Rat → Pip' : 'Pip → Rat'}</button>
        <button onClick={() => setEvents((e) => [...e])}>replay same list (should do nothing)</button>
        <label>
          weather{' '}
          <select value={weather} onChange={(e) => setWeather(e.target.value as WeatherKind)}>
            {WEATHER.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        <span style={{ opacity: 0.7 }}>fired {count} · in list {events.length}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Canvas camera={{ position: [7, 7, 9], fov: 50 }} dpr={[1, 1.5]} gl={{ antialias: true }}>
          <color attach="background" args={['#0b0b10']} />
          <ambientLight intensity={0.35} color="#cfd6ff" />
          <directionalLight position={[5, 8, 3]} intensity={1.2} />
          <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
            <planeGeometry args={[16, 16]} />
            <meshStandardMaterial color="#3a3630" roughness={1} />
          </mesh>
          <gridHelper args={[16, 16 / CELL * 1.5, '#555', '#333']} position={[0, 0.005, 0]} />
          {tokenList.map((t) => (
            <group key={t.id} position={[t.position.x, 0, t.position.z]}>
              <mesh position={[0, 0.03, 0]}>
                <cylinderGeometry args={[CELL * 0.4 * t.scale, CELL * 0.4 * t.scale, 0.06, 32]} />
                <meshStandardMaterial color={t.color} />
              </mesh>
              <mesh position={[0, 0.5 * CELL * t.scale, 0]}>
                <capsuleGeometry args={[CELL * 0.15 * t.scale, CELL * 0.5 * t.scale, 4, 12]} />
                <meshStandardMaterial color={t.color} roughness={0.8} />
              </mesh>
            </group>
          ))}
          <mesh position={[POINT.x, 0.01, POINT.z]} rotation-x={-Math.PI / 2}>
            <ringGeometry args={[0.2, 0.26, 24]} />
            <meshBasicMaterial color="#ff7a1a" />
          </mesh>
          <VfxLayer events={events} since={0} cellSize={CELL} />
          <WeatherLayer kind={weather} bounds={BOUNDS} />
          <CameraShake />
          <OrbitControls makeDefault target={[0, 0.5, 0]} />
          <Stats className="vfx-stats" />
        </Canvas>
      </div>
    </div>
  )
}

export default DevStory

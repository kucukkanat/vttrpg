/**
 * Dev story for audio: `#/dev/audio`. Every ambience, every built-in one-shot, dice impacts and
 * the master volume, driven directly through the engine; plus the GM soundboard panel wired to a
 * local fake controller whose intents apply straight to the store, so `useGameAudio` is exercised.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssetRef } from '@/core/assets'
import type { GameEvent, Scene } from '@/core/doc'
import type { Intent } from '@/core/intents'
import type { PlayerPubkey, SceneId } from '@/core/ids'
import { useGame } from '@/state/store'
import { sha256Hex, inferKind, inferMime } from '@/assets/hash'
import type { GameController } from '@/ui/controller'
import { SoundboardPanel } from '@/ui/panels/SoundboardPanel'
import { AMBIENT_PRESETS, BUILTIN_SOUNDS, builtinRef, createAudioEngine, useAudioUnlock, useGameAudio, type AmbientPreset, type AudioEngine } from './index'
import { BUILTIN_LABELS } from './builtin'

const GM = 'gm'.padEnd(64, '0') as PlayerPubkey
const SCENE = 'audio-dev-scene' as SceneId

function seedStore() {
  const scene: Scene = {
    id: SCENE, name: 'Dev tavern', model: { sha256: '0'.repeat(64) as never, kind: 'glb', mime: 'model/gltf-binary', size: 0, sources: [] },
    grid: { type: 'square', cellSize: 1.5, origin: { x: 0, y: 0, z: 0 } }, cameraMode: 'orbit', darkness: 0.5, ambientPreset: 'none',
  }
  useGame.getState()._replaceFromDoc({
    meta: { name: 'audio dev', gm: GM, pack: 'mausritter' as never, activeScene: SCENE, createdAt: Date.now() },
    scenes: { [SCENE]: scene }, tokens: {}, characters: {}, chat: [], fog: {}, events: [],
  })
}

/** Local stand-in: applies the few intents the soundboard emits straight to the store. */
function fakeController(): GameController {
  const urls = new Map<string, string>()
  const apply = (intent: Intent) => {
    const s = useGame.getState()
    if (intent.type === 'audio.play') {
      const ev: GameEvent = { id: crypto.randomUUID(), at: Date.now(), kind: 'audio', asset: intent.asset, volume: intent.volume, by: GM }
      s._replaceFromDoc({ events: [...s.events, ev].slice(-50) })
    } else if (intent.type === 'scene.update') {
      const sc = s.scenes[intent.scene]
      if (sc) s._replaceFromDoc({ scenes: { ...s.scenes, [intent.scene]: { ...sc, ...intent.patch, id: sc.id } } })
    }
  }
  return {
    connection: { isGm: true } as unknown as GameController['connection'],
    rules: null,
    pubkey: GM,
    assets: {
      async resolve(ref: AssetRef) {
        const u = urls.get(ref.sha256) ?? ref.sources[0]
        if (!u) throw new Error('dev: unknown asset')
        return u
      },
      async importFile(file: File): Promise<AssetRef> {
        const sha256 = await sha256Hex(file)
        urls.set(sha256, URL.createObjectURL(file))
        return { sha256, kind: inferKind(file.name, file.type), mime: inferMime(file.name, file.type), size: file.size, name: file.name, sources: [] }
      },
    } as unknown as GameController['assets'],
    async dispatch(intent) { apply(intent) },
    presence() {},
    dispose() {},
  }
}

export function DevStory() {
  const [ready, setReady] = useState(false)
  const engineRef = useRef<AudioEngine | null>(null)
  const controller = useMemo(fakeController, [])
  engineRef.current ??= createAudioEngine({ resolve: (ref) => controller.assets.resolve(ref) })
  const engine = engineRef.current
  const { unlocked, unlock } = useAudioUnlock(engine)
  const [volume, setVolume] = useState(engine.getMasterVolume())
  const [log, setLog] = useState<string[]>([])
  const preset = useGame((s) => s.scenes[SCENE]?.ambientPreset ?? 'none')
  const events = useGame((s) => s.events.length)
  useEffect(() => { seedStore(); setReady(true) }, [])
  useEffect(() => () => engine.dispose(), [engine])
  useGameAudio(ready ? engine : null)

  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 8))
  const setPreset = (p: AmbientPreset) => {
    void controller.dispatch({ type: 'scene.update', scene: SCENE, patch: { ambientPreset: p } })
    note(`ambience → ${p}`)
  }
  const shot = (name: (typeof BUILTIN_SOUNDS)[number]) => {
    void engine.playOneShot(builtinRef(name))
    note(`one-shot ${name}`)
  }
  const impact = (s: number) => { engine.diceImpact(s); note(`dice impact ${s}`) }

  if (!ready) return null
  const big: React.CSSProperties = { minHeight: 56, minWidth: 96, fontSize: 15, touchAction: 'manipulation' }
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', padding: '16px max(16px, env(safe-area-inset-left)) max(24px, env(safe-area-inset-bottom))', display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 900, margin: '0 auto' }}>
      <div className="row" style={{ marginTop: 0, alignItems: 'center' }}>
        <strong>audio dev</strong>
        <button className="primary" style={big} onClick={() => void unlock()} disabled={unlocked} data-testid="unlock">
          {unlocked ? 'Sound enabled' : 'Tap to enable sound'}
        </button>
        <span className="muted small">context {unlocked ? 'running' : 'locked'} · {events} events in log</span>
      </div>

      <section>
        <h3 className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>Ambience (via scene.update → useGameAudio)</h3>
        <div className="row" style={{ marginTop: 4 }}>
          {AMBIENT_PRESETS.map((p) => (
            <button key={p} style={big} className={preset === p ? 'primary' : ''} onClick={() => setPreset(p)} data-ambience={p}>{p}</button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>Built-in one-shots (direct)</h3>
        <div className="row" style={{ marginTop: 4 }}>
          {BUILTIN_SOUNDS.map((n) => <button key={n} style={big} onClick={() => shot(n)} data-shot={n}>{BUILTIN_LABELS[n]}</button>)}
        </div>
      </section>

      <section>
        <h3 className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>Dice impact</h3>
        <div className="row" style={{ marginTop: 4 }}>
          {[0.1, 0.3, 0.6, 1].map((s) => <button key={s} style={big} onClick={() => impact(s)} data-impact={s}>strength {s}</button>)}
          <button style={big} onClick={() => { let i = 0; const t = setInterval(() => { impact(Math.random()); if (++i > 7) clearInterval(t) }, 90) }}>tumble</button>
        </div>
      </section>

      <section>
        <label style={{ margin: 0 }}>
          <span className="small muted">Master volume {Math.round(volume * 100)}% (persisted)</span>
          <input type="range" min={0} max={1} step={0.01} value={volume} style={{ padding: 0, height: 36 }}
            onChange={(e) => { const v = Number(e.target.value); setVolume(v); engine.setMasterVolume(v) }} />
        </label>
      </section>

      <section style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--panel)' }}>
        <SoundboardPanel controller={controller} engine={engine} />
      </section>

      <pre className="small muted" style={{ margin: 0, whiteSpace: 'pre-wrap' }} data-testid="log">{log.join('\n') || 'nothing played yet'}</pre>
    </div>
  )
}

export default DevStory

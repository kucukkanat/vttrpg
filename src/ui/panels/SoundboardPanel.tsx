/**
 * GM soundboard: built-in synthesized one-shots, imported audio files, master volume and the
 * active scene's ambient preset. Every sound goes through `audio.play` so all clients hear it.
 */
import { useEffect, useRef, useState } from 'react'
import type { GameController } from '@/ui/controller'
import type { AssetRef } from '@/core/assets'
import { useGame } from '@/state/store'
import { AMBIENT_PRESETS, BUILTIN_SOUNDS, builtinRef, sharedAudioEngine, useAudioUnlock, type AmbientPreset, type AudioEngine } from '@/audio'
import { BUILTIN_LABELS } from '@/audio/builtin'

const BOARD_KEY = 'vttrpg.soundboard'
const ICONS: Record<(typeof BUILTIN_SOUNDS)[number], string> = { door: '🚪', sword: '⚔️', thunder: '⛈️', coin: '🪙', scream: '😱', drum: '🥁' }

function loadBoard(): AssetRef[] {
  try {
    const raw = localStorage.getItem(BOARD_KEY)
    const list = raw ? (JSON.parse(raw) as AssetRef[]) : []
    return Array.isArray(list) ? list.filter((r) => r && typeof r.sha256 === 'string' && Array.isArray(r.sources)) : []
  } catch {
    return []
  }
}
function saveBoard(list: AssetRef[]) {
  try { localStorage.setItem(BOARD_KEY, JSON.stringify(list)) } catch { /* private mode */ }
}

export function SoundboardPanel({ controller, engine: engineProp }: { controller: GameController; engine?: AudioEngine }) {
  const isGm = controller.connection.isGm
  const meta = useGame((s) => s.meta)
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  const engineRef = useRef<AudioEngine | null>(null)
  engineRef.current ??= engineProp ?? sharedAudioEngine({ resolve: (ref) => controller.assets.resolve(ref) })
  const engine = engineRef.current
  const { unlocked, unlock } = useAudioUnlock(engine)
  const [volume, setVolume] = useState(engine.getMasterVolume())
  const [board, setBoard] = useState<AssetRef[]>(loadBoard)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { saveBoard(board) }, [board])

  if (!isGm) return null

  const play = (asset: AssetRef) => {
    if (!unlocked) void unlock()
    void controller.dispatch({ type: 'audio.play', asset })
  }
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    try {
      const refs: AssetRef[] = []
      for (const f of Array.from(files)) refs.push(await controller.assets.importFile(f))
      setBoard((b) => [...b.filter((r) => !refs.some((n) => n.sha256 === r.sha256)), ...refs])
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }
  const remove = (ref: AssetRef) => setBoard((b) => b.filter((r) => r.sha256 !== ref.sha256))
  const setPreset = (ambientPreset: AmbientPreset) => {
    if (!meta?.activeScene) return
    void controller.dispatch({ type: 'scene.update', scene: meta.activeScene, patch: { ambientPreset } })
  }
  const clearTrack = () => {
    if (!meta?.activeScene) return
    void controller.dispatch({ type: 'scene.update', scene: meta.activeScene, patch: { ambientAudio: undefined } })
  }

  const pad: React.CSSProperties = { minHeight: 64, display: 'grid', placeItems: 'center', gap: 2, padding: 6, fontSize: 13, lineHeight: 1.2, touchAction: 'manipulation', position: 'relative' }

  return (
    <div className="panel soundboard">
      <h3>
        Soundboard
        {!unlocked && <button className="tiny primary" onClick={() => void unlock()}>Tap to enable sound</button>}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8 }}>
        {BUILTIN_SOUNDS.map((name) => (
          <button key={name} style={pad} onClick={() => play(builtinRef(name))} aria-label={BUILTIN_LABELS[name]}>
            <span style={{ fontSize: 22 }}>{ICONS[name]}</span>
            <span>{BUILTIN_LABELS[name]}</span>
          </button>
        ))}
        {board.map((ref) => (
          <button key={ref.sha256} style={pad} onClick={() => play(ref)} title={ref.name}>
            <span style={{ fontSize: 22 }}>🔊</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{ref.name?.replace(/\.[^.]+$/, '') ?? 'sound'}</span>
            <span
              role="button"
              aria-label={`Remove ${ref.name ?? 'sound'}`}
              onClick={(e) => { e.stopPropagation(); remove(ref) }}
              style={{ position: 'absolute', top: 2, right: 6, fontSize: 12, color: 'var(--muted)', padding: 4 }}
            >✕</span>
          </button>
        ))}
        <label className="tiny-file" style={{ ...pad, margin: 0, color: 'var(--muted)' }}>
          <span style={{ fontSize: 22 }}>＋</span>
          <span>{busy ? 'Importing…' : 'Audio file'}</span>
          <input type="file" accept="audio/*" multiple hidden disabled={busy} onChange={(e) => { void importFiles(e.target.files); e.target.value = '' }} />
        </label>
      </div>
      {error && <div className="error small">{error}</div>}
      <label style={{ marginBottom: 0 }}>
        <span className="small muted">Volume {Math.round(volume * 100)}%</span>
        <input
          type="range" min={0} max={1} step={0.01} value={volume}
          style={{ padding: 0, height: 32 }}
          onChange={(e) => { const v = Number(e.target.value); setVolume(v); engine.setMasterVolume(v) }}
        />
      </label>
      <label style={{ marginBottom: 0 }}>
        <span className="small muted">Ambience{scene ? ` · ${scene.name}` : ''}</span>
        <select value={scene?.ambientPreset ?? 'none'} disabled={!scene} onChange={(e) => setPreset(e.target.value as AmbientPreset)} style={{ height: 36 }}>
          {AMBIENT_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {scene?.ambientAudio && (
          <span className="small muted">
            Track “{scene.ambientAudio.name ?? scene.ambientAudio.sha256.slice(0, 8)}” overrides the preset.{' '}
            <button className="tiny" onClick={clearTrack}>Use preset</button>
          </span>
        )}
      </label>
    </div>
  )
}

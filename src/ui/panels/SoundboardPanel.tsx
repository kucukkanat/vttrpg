/**
 * GM soundboard: built-in synthesized one-shots, imported audio files, a volume per pad, stop
 * (one pad or everything), a "playing" ring on pads that are sounding, master volume and the
 * active scene's ambient preset. Every sound goes through `audio.play` / `audio.stop` so all
 * clients hear (and stop hearing) it; pad volumes are this device's and travel with each play.
 */
import { useEffect, useRef, useState } from 'react'
import type { GameController } from '@/ui/controller'
import type { AssetRef } from '@/core/assets'
import { useGame } from '@/state/store'
import { AMBIENT_PRESETS, BUILTIN_SOUNDS, builtinRef, sharedAudioEngine, soundKey, useAudioUnlock, type AmbientPreset, type AudioEngine } from '@/audio'
import { BUILTIN_LABELS } from '@/audio/builtin'
import { PAD_VOLUME_MAX, clampPadVolume, loadPadVolumes, padVolume, savePadVolumes, usePlaying, type PadVolumes } from './soundboard'

const BOARD_KEY = 'vttrpg.soundboard'
const ICONS: Record<(typeof BUILTIN_SOUNDS)[number], string> = { door: '🚪', sword: '⚔️', thunder: '⛈️', coin: '🪙', scream: '😱', drum: '🥁' }

const css = `
.sb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.sb-pad { display: grid; gap: 2px; border: 1px solid var(--border); border-radius: var(--r-md); padding: 4px; position: relative; background: var(--panel-2); }
.sb-pad.playing { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent); }
.sb-pad.playing .sb-play::after { content: ''; position: absolute; inset: 4px; border-radius: var(--r-sm); border: 2px solid var(--accent); animation: sb-pulse 1s ease-in-out infinite; pointer-events: none; }
@keyframes sb-pulse { 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .sb-pad.playing .sb-play::after { animation: none; } }
.sb-play { min-height: 60px; display: grid; place-items: center; gap: 2px; padding: 6px; font-size: 13px; line-height: 1.2; touch-action: manipulation; position: relative; }
.sb-play .icon { font-size: 22px; }
.sb-play .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.sb-row { display: flex; align-items: center; gap: 4px; }
.sb-row input[type=range] { flex: 1 1 auto; min-width: 0; padding: 0; height: 28px; }
.sb-row button { min-height: 32px; min-width: 32px; padding: 0; font-size: 12px; }
.sb-state { font-size: var(--fs-xs); color: var(--accent); min-height: 1em; text-align: center; }
.sb-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
`

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
  const playing = usePlaying(engine)
  const [volume, setVolume] = useState(engine.getMasterVolume())
  const [board, setBoard] = useState<AssetRef[]>(loadBoard)
  const [volumes, setVolumes] = useState<PadVolumes>(loadPadVolumes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { saveBoard(board) }, [board])
  useEffect(() => { savePadVolumes(volumes) }, [volumes])

  if (!isGm) return null

  const play = (asset: AssetRef) => {
    if (!unlocked) void unlock()
    const v = padVolume(volumes, soundKey(asset))
    void controller.dispatch(v === 1 ? { type: 'audio.play', asset } : { type: 'audio.play', asset, volume: v })
  }
  const stop = (asset?: AssetRef) => void controller.dispatch(asset ? { type: 'audio.stop', asset } : { type: 'audio.stop' })
  const setPadVolume = (key: string, v: number) => setVolumes((all) => ({ ...all, [key]: clampPadVolume(v) }))
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

  const pad = (asset: AssetRef, icon: string, label: string, extra?: React.ReactNode) => {
    const key = soundKey(asset)
    const on = playing.has(key)
    const v = padVolume(volumes, key)
    return (
      <div key={key} className={`sb-pad${on ? ' playing' : ''}`}>
        <button type="button" className="sb-play" onClick={() => play(asset)} aria-label={`Play ${label}${on ? ' (playing)' : ''}`} title={label}>
          <span className="icon" aria-hidden>{icon}</span>
          <span className="name">{label}</span>
        </button>
        <div className="sb-row">
          <input type="range" min={0} max={PAD_VOLUME_MAX} step={0.05} value={v} aria-label={`Volume for ${label}`}
            title={`${Math.round(v * 100)}%`} onChange={(e) => setPadVolume(key, Number(e.target.value))} />
          <button type="button" className="icon" aria-label={`Stop ${label}`} disabled={!on} onClick={() => stop(asset)}>■</button>
          {extra}
        </div>
        <div className="sb-state" aria-live="polite">{on ? 'Playing' : v !== 1 ? `${Math.round(v * 100)}%` : ''}</div>
      </div>
    )
  }

  return (
    <div className="panel soundboard">
      <style>{css}</style>
      <h3>
        Soundboard
        {!unlocked && <button className="tiny primary" onClick={() => void unlock()}>Tap to enable sound</button>}
      </h3>
      <div className="sb-top">
        <button type="button" disabled={playing.size === 0} onClick={() => stop()}>■ Stop all sounds</button>
        <span className="small muted">{playing.size ? `${playing.size} playing` : 'Nothing playing'}</span>
      </div>
      <div className="sb-grid">
        {BUILTIN_SOUNDS.map((name) => pad(builtinRef(name), ICONS[name], BUILTIN_LABELS[name]))}
        {board.map((ref) =>
          pad(ref, '🔊', ref.name?.replace(/\.[^.]+$/, '') ?? 'sound', (
            <button type="button" className="icon" aria-label={`Remove ${ref.name ?? 'sound'}`} onClick={() => remove(ref)} style={{ color: 'var(--muted)' }}>✕</button>
          )),
        )}
        <label className="tiny-file sb-pad" style={{ margin: 0, color: 'var(--muted)', display: 'grid', placeItems: 'center', minHeight: 60 }}>
          <span style={{ fontSize: 22 }}>＋</span>
          <span>{busy ? 'Importing…' : 'Audio file'}</span>
          <input type="file" accept="audio/*" multiple hidden disabled={busy} onChange={(e) => { void importFiles(e.target.files); e.target.value = '' }} />
        </label>
      </div>
      {error && <div className="error small">{error}</div>}
      <label style={{ marginBottom: 0 }}>
        <span className="small muted">Master volume (this device) {Math.round(volume * 100)}%</span>
        <input
          type="range" min={0} max={1} step={0.01} value={volume}
          style={{ padding: 0, height: 32 }}
          onChange={(e) => { const v = Number(e.target.value); setVolume(v); engine.setMasterVolume(v) }}
        />
      </label>
      <label style={{ marginBottom: 0 }}>
        <span className="small muted">Ambience{scene ? ` · ${scene.name}` : ''}</span>
        <select value={scene?.ambientPreset ?? 'none'} disabled={!scene} onChange={(e) => setPreset(e.target.value as AmbientPreset)}>
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

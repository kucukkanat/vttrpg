/**
 * This device's sound settings, for everyone (players have no soundboard): master volume and the
 * optional turn / effect-ended cues. Each cue can sound, speak or both, and always shows a toast
 * when on. Off by default.
 */
import { useState } from 'react'
import { sharedAudioEngine } from '@/audio'
import type { GameController } from '../controller'
import { CUE_LABELS, useCuePrefs, type CueId } from '../cues'

const css = `
.sound-prefs { display: grid; gap: var(--sp-1); margin-top: var(--sp-2); }
.sound-prefs input[type=range] { padding: 0; height: 32px; }
.cue-row { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; min-height: 40px; }
.cue-row > span { flex: 1 1 10em; }
.cue-row .check { margin: 0; }
`

export function SoundPrefs({ controller }: { controller: GameController }) {
  const engine = sharedAudioEngine({ resolve: (ref) => controller.assets.resolve(ref) })
  const [volume, setVolume] = useState(engine.getMasterVolume())
  const prefs = useCuePrefs((s) => s.prefs)
  const set = useCuePrefs((s) => s.set)
  return (
    <div className="sound-prefs">
      <style>{css}</style>
      <label style={{ margin: 0 }}>
        <span className="small muted">Sound volume (this device) {Math.round(volume * 100)}%</span>
        <input type="range" min={0} max={1} step={0.01} value={volume}
          onChange={(e) => { const v = Number(e.target.value); setVolume(v); engine.setMasterVolume(v) }} />
      </label>
      <span className="small muted">Cues (each also shows a notice)</span>
      {(['turn', 'expired'] as CueId[]).map((id) => (
        <div key={id} className="cue-row">
          <span>{CUE_LABELS[id]}</span>
          <label className="check"><input type="checkbox" checked={prefs[id].sound} onChange={(e) => set(id, { sound: e.target.checked })} /> <span>Sound</span></label>
          <label className="check"><input type="checkbox" checked={prefs[id].speech} onChange={(e) => set(id, { speech: e.target.checked })} /> <span>Speech</span></label>
        </div>
      ))}
    </div>
  )
}

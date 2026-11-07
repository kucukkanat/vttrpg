/** The feel checkboxes under "Skip 3D dice" in the Players panel (see prefs.ts). */
import { hapticsSupported } from './haptics'
import { setPref, usePref, type FeelPref } from './prefs'

function PrefBox({ pref, label, hint }: { pref: FeelPref; label: string; hint: string }) {
  const on = usePref(pref)
  return (
    <label className="check">
      <input type="checkbox" checked={on} onChange={(e) => setPref(pref, e.target.checked)} />
      <span>{label} <span className="muted small">· {hint}</span></span>
    </label>
  )
}

export function FeelPrefs() {
  return (
    <>
      <PrefBox pref="turnCue" label="Turn chime" hint="sound and ring when your turn starts" />
      <PrefBox pref="twoTapMove" label="Tap twice to move" hint="touch: preview the path, tap again to go" />
      {hapticsSupported() && <PrefBox pref="haptics" label="Vibration" hint="short buzz on taps and your turn" />}
    </>
  )
}

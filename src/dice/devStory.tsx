/** Dev story for the dice tray: `#/dev/dice`. Rolls a formula with a fresh seed on demand. */
import { useCallback, useState } from 'react'
import { DiceTrayOverlay } from './DiceTrayOverlay'
import { DEFAULT_SCHEME, IVORY_SCHEME, OBSIDIAN_SCHEME, type DiceColorScheme } from './atlas'
import { newSeed, rollFromSeed } from './fair'

const SCHEMES: Record<string, DiceColorScheme> = { pastel: DEFAULT_SCHEME, ivory: IVORY_SCHEME, obsidian: OBSIDIAN_SCHEME }

interface Roll { seed: string; formula: string; dice: { sides: number; value: number }[]; total: number }

export function DevStory() {
  const [formula, setFormula] = useState('2d6+1d20')
  const [roll, setRoll] = useState<Roll | null>(null)
  const [settled, setSettled] = useState<string | null>(null)
  const [impacts, setImpacts] = useState(0)
  const [scheme, setScheme] = useState<keyof typeof SCHEMES>('pastel')
  const [error, setError] = useState<string | null>(null)

  const doRoll = useCallback(async (f: string) => {
    try {
      const r = await rollFromSeed(f, newSeed())
      setError(null)
      setSettled(null)
      setImpacts(0)
      setRoll(r)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }, [])

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 40%, #2a2630 0%, #121216 70%)' }}>
      <DiceTrayOverlay
        rollId={roll?.seed ?? null}
        dice={roll?.dice ?? []}
        colorScheme={SCHEMES[scheme]}
        onSettled={(id) => setSettled(id)}
        onImpact={() => setImpacts((n) => n + 1)}
      />
      <div style={{ position: 'absolute', top: 12, left: 12, display: 'grid', gap: 8, width: 300, zIndex: 1 }}>
        <div className="row" style={{ marginTop: 0 }}>
          <input value={formula} onChange={(e) => setFormula(e.target.value)} style={{ width: 150 }} />
          <button className="primary" onClick={() => doRoll(formula)}>Roll</button>
          <select value={scheme} onChange={(e) => setScheme(e.target.value as keyof typeof SCHEMES)} style={{ width: 'auto' }}>
            {Object.keys(SCHEMES).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div className="row" style={{ marginTop: 0 }}>
          {['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', '1d4+1d6+1d8+1d10+1d12+1d20+1d100'].map((f) => (
            <button key={f} onClick={() => { setFormula(f); doRoll(f) }}>{f === '1d4+1d6+1d8+1d10+1d12+1d20+1d100' ? 'all' : f}</button>
          ))}
        </div>
        {error && <div className="error small">{error}</div>}
        {roll && (
          <div className="small" style={{ background: 'rgba(0,0,0,.5)', padding: 8, borderRadius: 6 }}>
            <div><b>{roll.formula}</b> = <b style={{ color: 'var(--accent)' }}>{roll.total}</b></div>
            <div className="muted">dice: {roll.dice.map((d) => `d${d.sides}:${d.value}`).join('  ')}</div>
            <div className="muted">seed {roll.seed.slice(0, 12)}… · {settled ? 'settled' : 'rolling'} · {impacts} impacts</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default DevStory

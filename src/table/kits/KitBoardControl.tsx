/**
 * The GM's small level control on the board: the level being worked on (up, down; PgUp / PgDn do the
 * same) and the cutaway (follow the selected token, or cut at the build level). Shown once the
 * scene has storeys or a kit tool is out. HTML, over the canvas.
 */
import { useBuildUi } from '../build/buildState'
import { stepLevel } from './KitLayer'
import { useKitUi } from './kitState'
import type { KitScene } from './useKitScene'

const box: React.CSSProperties = {
  position: 'absolute', right: 'max(12px, env(safe-area-inset-right))', top: 12, display: 'flex', flexDirection: 'column',
  alignItems: 'stretch', gap: 4, padding: 4, borderRadius: 10, background: 'var(--scrim, rgba(10,10,14,0.7))', color: 'var(--on-glass, #f3ead8)',
  fontSize: 12, fontWeight: 600, zIndex: 3, touchAction: 'manipulation', userSelect: 'none',
}
const btn: React.CSSProperties = {
  minWidth: 44, minHeight: 36, borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(0,0,0,0.25)',
  color: 'inherit', font: 'inherit', cursor: 'pointer', padding: '0 6px',
}

export function KitBoardControl({ kit }: { kit: KitScene }) {
  const level = useKitUi((s) => s.level)
  const cutaway = useKitUi((s) => s.cutaway)
  const set = useKitUi((s) => s.set)
  const building = useBuildUi((s) => s.tool === 'kit')
  const top = kit.levels[kit.levels.length - 1] ?? 0
  if (top === 0 && level === 0 && !building && cutaway === null) return null
  const cutLabel = kit.cut === Infinity ? 'all' : `≤ ${kit.cut}`
  return (
    <div style={box} role="group" aria-label="Levels" data-testid="kit-levels">
      <button type="button" style={btn} title="One level up (PgUp)" aria-label="Level up" onClick={() => stepLevel(1)}>▲</button>
      <div style={{ textAlign: 'center', padding: '2px 0' }} aria-live="polite">Level {level}</div>
      <button type="button" style={btn} title="One level down (PgDn)" aria-label="Level down" onClick={() => stepLevel(-1)} disabled={level === 0}>▼</button>
      <button type="button" style={{ ...btn, marginTop: 4, background: cutaway !== null ? 'rgba(124,196,255,0.25)' : btn.background }}
        title={cutaway === null ? 'Cutaway follows the selected token; tap to cut at the build level' : 'Cutaway set by hand; tap to follow the selected token again'}
        aria-pressed={cutaway !== null}
        onClick={() => set({ cutaway: cutaway === null ? level : null })}>
        ✂ {cutaway === null ? `auto ${cutLabel}` : cutLabel}
      </button>
    </div>
  )
}

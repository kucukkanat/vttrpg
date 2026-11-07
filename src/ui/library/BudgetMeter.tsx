/**
 * The scene budget meter at the foot of the Build tray: one thin bar for what the active scene
 * costs against this device's graphics tier, warning-coloured when it is over the low tier (the
 * scene will stutter on weak devices). Hovering or clicking it opens the breakdown and the five
 * heaviest models, with "Select all of these". Figures come from `table/build/sceneBudget.ts`.
 */
import { useMemo, useRef, useState } from 'react'
import { useGame } from '@/state/store'
import { getModelStats } from '@/table/gltf'
import { GRAPHICS_LABELS, useGraphics } from '@/table/graphics'
import { compact, heaviestModels, idsOf, megabytes, modelUses, readBudget, SCENE_BUDGETS, sceneCost, useFrameStats } from '@/table/build/sceneBudget'
import './BudgetMeter.css'

const LABELS = { triangles: 'triangles', drawCalls: 'draw calls', textureBytes: 'texture memory' } as const

export function BudgetMeter() {
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const sceneModel = useGame((s) => (sceneId ? s.scenes[sceneId]?.model?.sha256 : undefined))
  const props = useGame((s) => s.props)
  const frame = useFrameStats()
  const tier = useGraphics().tier
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const uses = useMemo(() => modelUses(props, sceneId), [props, sceneId])
  // Model stats are filled in as models load; the frame sample ticks often enough to pick them up.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cost = useMemo(() => sceneCost(uses, getModelStats, frame, sceneModel ? [sceneModel] : []), [uses, frame, sceneModel])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const heavy = useMemo(() => heaviestModels(uses, getModelStats), [uses, frame])
  const reading = readBudget(cost, tier)
  const budget = SCENE_BUDGETS[tier]
  const warn = reading.overLow.length > 0
  const pct = Math.min(100, Math.round(reading.fraction * 100))
  const summary = `${compact(cost.triangles)} tris · ${cost.drawCalls} calls · ${megabytes(cost.textureBytes)}`
  if (!sceneId) return null

  return (
    <div className={`budget${warn ? ' budget--warn' : ''}${open ? ' open' : ''}`} ref={box}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false) }}>
      <button type="button" className="budget-bar" aria-expanded={open} onClick={() => setOpen((o) => !o)} onMouseEnter={() => setOpen(true)}
        aria-label={`Scene budget: ${pct}% of the ${GRAPHICS_LABELS[tier]} budget. ${summary}${warn ? '. Over the low tier' : ''}`}>
        <span className="budget-label">Scene</span>
        <span className="budget-track" aria-hidden="true"><span className="budget-fill" style={{ width: `${pct}%` }} /></span>
        <span className="budget-text">{summary}</span>
      </button>
      {open && (
        <div className="budget-pop skin-paper" role="dialog" aria-label="Scene budget">
          <p className="small"><strong>{pct}%</strong> of the {GRAPHICS_LABELS[tier]} budget on this device.</p>
          <table className="budget-table small">
            <tbody>
              {(['triangles', 'drawCalls', 'textureBytes'] as const).map((k) => (
                <tr key={k} className={reading.overLow.includes(k) ? 'over' : undefined}>
                  <th scope="row">{LABELS[k]}</th>
                  <td>{k === 'textureBytes' ? megabytes(cost[k]) : compact(cost[k])}</td>
                  <td className="muted">/ {k === 'textureBytes' ? megabytes(budget[k]) : compact(budget[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {warn && <p className="small budget-note">Over the low tier ({reading.overLow.map((k) => LABELS[k]).join(', ')}): older phones will stutter.</p>}
          {heavy.length > 0 ? (
            <>
              <p className="small muted budget-sub">Heaviest models</p>
              <ol className="budget-list small">
                {heavy.map((m) => (
                  <li key={m.sha256}>
                    <span className="budget-name">{m.title}</span>
                    <span className="muted">{m.ids.length} × {compact(m.triangles)} tris{m.textureBytes ? ` · ${megabytes(m.textureBytes)}` : ''}</span>
                  </li>
                ))}
              </ol>
              <button type="button" className="tiny" onClick={() => { useGame.getState().setPropSelection(idsOf(heavy)); setOpen(false) }}>
                Select all of these
              </button>
            </>
          ) : <p className="small muted">No props in this scene yet.</p>}
        </div>
      )}
    </div>
  )
}

export default BudgetMeter

/**
 * New game in three steps on one page: names, a template card, Create. Built for thumbs: every
 * target is at least 48 px tall and the layout is a single column at phone width.
 */
import { useState } from 'react'
import { Shell } from '../components'
import { navigate } from '../router'
import { useSession } from '../session'
import { startGame } from '../bootstrap'
import { BUILTIN_PACKS } from '@/rules'
import { TEMPLATES, applyTemplate, templateById, type GameTemplate } from '../templates'
import { useCoarsePointer, verb } from '../useMediaQuery'
import type { GameController } from '../controller'

const css = `
.ng-step { margin: 18px 0 6px; display: flex; align-items: baseline; gap: 10px; }
.ng-step .n { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--accent); color: #111; font-weight: 700; font-size: 13px; }
.ng-step h2 { margin: 0; font-size: 16px; }
.ng input, .ng select { min-height: 48px; font-size: 16px; }
.ng label { margin: 8px 0; }
.ng-cards { display: grid; gap: 10px; }
.ng-card { display: grid; gap: 4px; text-align: left; padding: 14px 16px; min-height: 64px; border-radius: 12px;
  background: var(--panel); border: 2px solid var(--border); color: var(--fg); touch-action: manipulation; }
.ng-card:hover { border-color: var(--accent); }
.ng-card.selected { border-color: var(--accent); background: #26231c; }
.ng-card .title { font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.ng-card .title .badge { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: var(--border); color: var(--muted); font-weight: 500; }
.ng-card .desc { color: var(--muted); font-size: 13px; line-height: 1.35; }
.ng-actions { display: grid; gap: 10px; margin-top: 16px; }
.ng-actions button { min-height: 52px; font-size: 16px; border-radius: 10px; }
.ng-progress { display: flex; align-items: center; gap: 10px; min-height: 24px; color: var(--muted); font-size: 14px; }
.ng-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--accent); animation: ng-spin .8s linear infinite; }
@keyframes ng-spin { to { transform: rotate(360deg); } }
@media (max-width: 520px) { .shell:has(.ng) { margin: 0 auto; padding: 16px; padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px)); } }
`

type Phase = 'idle' | 'creating' | 'applying' | 'done'

export function NewGame() {
  const { setController } = useSession()
  const coarse = useCoarsePointer()
  const [name, setName] = useState('My table')
  const [displayName, setDisplayName] = useState('GM')
  const [templateId, setTemplateId] = useState(TEMPLATES[0]!.id)
  const [pack, setPack] = useState(BUILTIN_PACKS[0]?.id ?? 'mausritter')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<GameController | null>(null)

  const template = templateById(templateId) ?? TEMPLATES[0]!
  const busy = phase === 'creating' || phase === 'applying'
  const canCreate = !busy && name.trim().length > 0 && displayName.trim().length > 0

  async function create() {
    setError(null)
    setPhase('creating')
    setProgress('Creating the game…')
    let c: GameController | null = created
    try {
      if (!c) {
        c = await startGame({
          mode: 'create', name: name.trim(), packId: template.sceneFile ? template.packId : pack, displayName: displayName.trim(),
        })
        setController(c)
        setCreated(c)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
      return
    }
    setPhase('applying')
    try {
      await applyTemplate(c, template, { onProgress: setProgress })
      setPhase('done')
      navigate('/game')
    } catch (e) {
      // The game exists; let the GM open it empty rather than lose it.
      setError(`Could not set up the template: ${e instanceof Error ? e.message : String(e)}`)
      setPhase('idle')
    }
  }

  return (
    <Shell title="New game">
      <style>{css}</style>
      <div className="ng">
        <Step n={1} title="Who is playing" />
        <label>Game name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" disabled={busy} /></label>
        <label>Your name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" disabled={busy} aria-describedby="ng-name-hint" />
          <span id="ng-name-hint" className="muted small">Shown to players in chat and the Players list.</span>
        </label>

        <Step n={2} title="Pick a start" />
        <div className="ng-cards" role="radiogroup" aria-label="Template">
          {TEMPLATES.map((t) => (
            <TemplateCard key={t.id} template={t} selected={t.id === templateId} disabled={busy} onPick={() => setTemplateId(t.id)} />
          ))}
        </div>
        {!template.sceneFile && (
          <label>System
            <select value={pack} onChange={(e) => setPack(e.target.value)} disabled={busy}>
              {BUILTIN_PACKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}

        <Step n={3} title="Open the table" />
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          {verb(coarse)} <strong>Create and open table</strong>. You will get an invite link to share from the table; players join from any browser.
        </p>
        {error && <p className="error">{error}</p>}
        <div className="ng-progress" aria-live="polite">
          {busy && <span className="ng-spin" />}
          {busy ? progress : created ? 'Game created. Try again or open it empty.' : ''}
        </div>
        <div className="ng-actions">
          <button className="primary" disabled={!canCreate} onClick={() => void create()}>
            {busy ? 'Setting up…' : created ? 'Retry template' : 'Create and open table'}
          </button>
          {created && !busy && <button onClick={() => navigate('/game')}>Open table anyway</button>}
          <button disabled={busy} onClick={() => navigate('/')}>Back</button>
        </div>
      </div>
    </Shell>
  )
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <div className="ng-step">
      <span className="n">{n}</span>
      <h2>{title}</h2>
    </div>
  )
}

function TemplateCard({ template, selected, disabled, onPick }: { template: GameTemplate; selected: boolean; disabled: boolean; onPick(): void }) {
  const pack = BUILTIN_PACKS.find((p) => p.id === template.packId)?.name
  return (
    <button type="button" role="radio" aria-checked={selected} className={`ng-card${selected ? ' selected' : ''}`} disabled={disabled} onClick={onPick}>
      <span className="title">
        {template.name}
        {template.sceneFile && pack && <span className="badge">{pack}</span>}
      </span>
      <span className="desc">{template.description}</span>
    </button>
  )
}

/**
 * Things over the table: the camera and table tools (the tool rail), the dice well's readout and
 * pad, and the shared overlay layers. All ignore pointer events except on their own controls.
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import { useGame } from '@/state/store'
import { useTableUi } from '@/table/tableState'
import type { ChatMessage, RollAdvantage, RollVisibility } from '@/core/doc'
import { ContextMenu } from './ContextMenu'
import { Toasts } from './Toasts'
import { DiceValues } from '../components'
import { Icon } from '../icons'
import { TurnCue } from '../feedback/TurnCue'
import { TipLayer } from '../tips/TipLayer'
import { lastRollFormula, quickDice, rememberRollFormula } from '../panels/ChatPanel'
import { useSession } from '../session'
import { newSeed } from '@/dice'
import { DICE_SETTLED_EVENT } from '@/dice/choreography'
import { useRollMode } from '../rollMode'
import { useBuildUi } from '@/table/build/buildState'
import { fogButtonTitle, fogToolAvailable, isFogTool } from './fogTool'
import './Hud.css'

const READOUT_MS = 8000

const FogPopout = lazy(() => import('./FogPopout'))

/**
 * Camera and table tools: Eyes (first person from your token; off means the free orbit camera),
 * Top, the grid toggle, touch Select, ruler and ping. The tool rail on the board's left edge on wide
 * screens, the Tools sheet on phones (Table.css). Key hints show with a keyboard. Hidden while no
 * table is mounted.
 */
export function CameraPill() {
  const active = useTableUi((s) => s.cameraActive)
  const firstPerson = useTableUi((s) => s.firstPerson)
  const showGrid = useTableUi((s) => s.showGrid)
  const multiSelect = useTableUi((s) => s.multiSelect)
  const tool = useTableUi((s) => s.tool)
  const set = useTableUi((s) => s.set)
  if (!active) return null
  const eyes = active.mode === 'token' && firstPerson
  const noToken = !active.canFollow
  return (
    <div className="cam-pill" role="toolbar" aria-label="Camera">
      <div className="cam-group">
        <button type="button" className={`cam-btn cam-eyes${eyes ? ' on' : ''}`} aria-pressed={eyes} disabled={noToken && !eyes}
          title={noToken ? 'Select a token to look through its eyes' : eyes ? 'Back to the table camera (F)' : 'Look through the token\'s eyes (F)'}
          onClick={() => set({ firstPerson: !eyes })}>
          <Icon name="eye" className="cam-icon" />
          <span className="cam-label">Eyes</span>
          <kbd aria-hidden>F</kbd>
        </button>
      </div>
      <TacticalButtons orbit={active.mode === 'orbit'} />
      <div className="cam-group">
        <button type="button" className={`cam-btn cam-grid${showGrid ? ' on' : ''}`} aria-pressed={showGrid} aria-label={showGrid ? 'Hide grid' : 'Show grid'}
          title={`${showGrid ? 'Hide' : 'Show'} grid (G)`} onClick={() => set({ showGrid: !showGrid })}>
          <Icon name="grid" className="cam-icon" />
          <kbd aria-hidden>G</kbd>
        </button>
      </div>
      {/* Touch only (Hud.css): taps add tokens to the selection while on; desktop uses Shift/Cmd-click. */}
      <div className="cam-group cam-group--select">
        <button type="button" className={`cam-btn cam-select${multiSelect ? ' on' : ''}`} aria-pressed={multiSelect}
          title="Select several tokens by tapping them" onClick={() => set({ multiSelect: !multiSelect })}>
          <Icon name="select" className="cam-icon" />
          <span className="cam-label">Select</span>
        </button>
      </div>
      <div className="cam-group" role="group" aria-label="Table tools">
        <button type="button" className={`cam-btn cam-tool${tool === 'ruler' ? ' on' : ''}`} aria-pressed={tool === 'ruler'} aria-label="Ruler: measure distance"
          title={`${tool === 'ruler' ? 'Put away' : 'Measure with'} the ruler (M)`} onClick={() => set({ tool: tool === 'ruler' ? null : 'ruler' })}>
          <Icon name="ruler" className="cam-icon" />
          <kbd aria-hidden>M</kbd>
        </button>
        <button type="button" className={`cam-btn cam-tool${tool === 'ping' ? ' on' : ''}`} aria-pressed={tool === 'ping'} aria-label="Ping: mark a spot for everyone"
          title={tool === 'ping' ? 'Tap the table to ping, Esc to cancel' : 'Ping a spot on the table (or double-tap the floor)'} onClick={() => set({ tool: tool === 'ping' ? null : 'ping' })}>
          <Icon name="pin" className="cam-icon" />
        </button>
      </div>
      <FogButton />
    </div>
  )
}

/**
 * GM: Fog on the rail, with a pop-out for the brush (Reveal / Hide, size, Reveal all, Hide all). It
 * arms the build fog tools. Esc or closing the pop-out puts the brush away.
 */
function FogButton() {
  const { controller } = useSession()
  const tool = useBuildUi((s) => s.tool)
  const [open, setOpen] = useState(false)
  const available = fogToolAvailable(!!controller?.connection.isGm)
  const brushing = isFogTool(tool)
  const close = () => {
    setOpen(false)
    if (isFogTool(useBuildUi.getState().tool)) useBuildUi.getState().set({ tool: null })
  }
  useEffect(() => {
    if (!open) return
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== 'Escape' || (t && ((t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') || t.tagName === 'TEXTAREA'))) return
      close()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [open])
  // Losing the GM seat folds the pop-out away.
  useEffect(() => { if (!available) setOpen(false) }, [available])
  if (!available || !controller) return null
  return (
    <div className="cam-group cam-group--fog">
      <button type="button" className={`cam-btn cam-fog${brushing || open ? ' on' : ''}`} aria-pressed={brushing} aria-expanded={open} aria-haspopup="dialog"
        title={fogButtonTitle(tool)} onClick={() => (open ? close() : setOpen(true))}>
        <Icon name="fog" className="cam-icon" />
        <span className="cam-label">Fog</span>
      </button>
      {open && <Suspense fallback={null}><FogPopout controller={controller} onClose={close} /></Suspense>}
    </div>
  )
}

/**
 * Tactical view: top-down camera (T), turned in 45° steps (Q / E) while it is on. Also entered by
 * zooming out past the orbit limit (CameraRig). Only with the orbit camera.
 */
function TacticalButtons({ orbit }: { orbit: boolean }) {
  const tactical = useTableUi((s) => s.tactical)
  const set = useTableUi((s) => s.set)
  const turn = (by: number) => set({ tacticalTurn: useTableUi.getState().tacticalTurn + by })
  const on = tactical && orbit
  return (
    <div className="cam-group" role="group" aria-label="Tactical view">
      <button type="button" className={`cam-btn cam-tactical${on ? ' on' : ''}`} aria-pressed={on} disabled={!orbit && !tactical}
        title={on ? 'Back to the angled camera (T)' : 'Top-down tactical view (T)'} onClick={() => set({ tactical: !on, firstPerson: false })}>
        <Icon name="map" className="cam-icon" />
        <span className="cam-label">Top</span>
        <kbd aria-hidden>T</kbd>
      </button>
      {on && (
        <>
          <button type="button" className="cam-btn" aria-label="Turn the view left 45°" title="Turn left 45° (Q)" onClick={() => turn(-1)}>
            <Icon name="chevron-left" className="cam-icon" />
            <kbd aria-hidden>Q</kbd>
          </button>
          <button type="button" className="cam-btn" aria-label="Turn the view right 45°" title="Turn right 45° (E)" onClick={() => turn(1)}>
            <Icon name="chevron-right" className="cam-icon" />
            <kbd aria-hidden>E</kbd>
          </button>
        </>
      )}
    </div>
  )
}

/**
 * The table's shared overlays, mounted once by the shell: the toast line, the turn cue, the token
 * context menu and the tip layer.
 */
export function HudLayers() {
  return (
    <>
      <Toasts />
      <TurnCue />
      <ContextMenu />
      <TipLayer />
    </>
  )
}

/**
 * The latest roll, read out on the rim of the dice well: who rolled, the formula, the total (it pops
 * when the dice come to rest) and the outcome. Tap to read it in the scroll. Fades after a while.
 */
export function WellReadout({ roll, who, onOpenChat }: { roll: ChatMessage | null; who(pubkey: string): string; onOpenChat(): void }) {
  const [shown, setShown] = useState<ChatMessage | null>(null)
  useEffect(() => {
    if (!roll?.roll || roll.at < Date.now() - READOUT_MS) return
    setShown(roll)
    const t = setTimeout(() => setShown(null), READOUT_MS)
    return () => clearTimeout(t)
  }, [roll])
  const [pop, setPop] = useState(0)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== roll?.roll?.seed) return
      setPop((n) => n + 1)
      clearTimeout(t)
      t = setTimeout(() => setPop(0), 900)
    }
    window.addEventListener(DICE_SETTLED_EVENT, on)
    return () => { window.removeEventListener(DICE_SETTLED_EVENT, on); clearTimeout(t) }
  }, [roll])
  const r = shown?.roll
  if (!shown || !r) return null
  const success = r.outcome && 'success' in r.outcome ? !!r.outcome.success : null
  const critical = !!r.outcome?.critical
  return (
    <button type="button" className="well-readout roll-toast" onClick={onOpenChat} aria-live="polite" title="Read it in the scroll">
      <span className="well-who">{who(shown.author)} · <span className="toast-formula">{shown.text}</span></span>
      <span key={pop} className={`toast-total${pop ? ' pop' : ''}`}>{r.total}</span>
      <DiceValues className="well-dice" formula={r.formula} dice={r.dice} />
      {success !== null && (
        <span className={`roll-toast-outcome ${success ? 'ok' : 'bad'}`}>
          {critical && <Icon name={success ? 'crit' : 'fumble'} size={14} />}{critical ? (success ? 'critical success' : 'critical fail') : success ? 'success' : 'fail'}
        </span>
      )}
    </button>
  )
}

/**
 * The dice well's pad: the quick dice, "Last" and a formula field. Rolls go to chat and tumble in
 * the well like `/r`. Who sees the result and advantage are set once, in the scroll; the pad shows
 * that setting and links to it.
 */
export function DicePad({ onRolled, onRollMode }: { onRolled?(): void; onRollMode?(): void }) {
  const { controller } = useSession()
  const pack = useGame((s) => s.meta?.pack)
  const [formula, setFormula] = useState('')
  const [last, setLast] = useState(lastRollFormula)
  const armed = useRollMode((s) => s.advantage)
  const visibility = useRollMode((s) => s.visibility)
  if (!controller) return null
  const roll = (f: string) => {
    const t = f.trim()
    if (!t) return
    rememberRollFormula(t)
    setLast(t)
    onRolled?.()
    void controller.dispatch({ type: 'roll', formula: t, seed: newSeed() })
  }
  return (
    <div className="dice-pad" role="group" aria-label="Roll dice">
      <div className="dice-pad-row">
        {quickDice(pack).map((f) => <button key={f} type="button" className="die-chip" onClick={() => roll(f)} aria-label={`Roll ${f}`}>{f}</button>)}
        <button type="button" className="die-chip" disabled={!last} onClick={() => { if (last) roll(last) }} title={last ? `Roll ${last} again` : 'Nothing rolled yet'}>Last</button>
      </div>
      <form className="dice-pad-form" onSubmit={(e) => { e.preventDefault(); roll(formula); setFormula('') }}>
        <input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="2d6+1" aria-label="Dice formula" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <button type="submit" className="primary" disabled={!formula.trim()}>Roll</button>
      </form>
      <button type="button" className="dice-pad-mode" onClick={onRollMode} title="Set who sees rolls and advantage in the scroll">
        {rollModeLabel(visibility, armed)} <Icon name="chevron-right" size={14} />
      </button>
    </div>
  )
}

/** "Everyone sees · next d20 with advantage": the roll mode in words, for read-only tags. */
export function rollModeLabel(visibility: RollVisibility, advantage: RollAdvantage | null): string {
  const who = visibility === 'public' ? 'Everyone sees' : visibility === 'gm' ? 'GM only' : 'Blind roll'
  return advantage ? `${who} · next d20 with ${advantage}` : who
}

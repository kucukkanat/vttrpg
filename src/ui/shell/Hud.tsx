/**
 * Things that stay visible over the table while panels are hidden: the selected token (tap to open
 * its sheet, "Find me" to frame the player's own token), the camera mode pill with the grid toggle,
 * and the latest dice result. All ignore pointer events except on their own controls.
 */
import { useEffect, useState } from 'react'
import { firstOwnedToken, useGame } from '@/state/store'
import { useTableUi } from '@/table/tableState'
import type { ChatMessage, Token } from '@/core/doc'
import type { PlayerPubkey } from '@/core/ids'
import { ContextMenu } from './ContextMenu'
import { Toasts } from './Toasts'
import { DiceValues } from '../components'
import { Icon } from '../icons'
import { InitiativeChip } from '../panels/InitiativePanel'
import { lastRollFormula, quickDice, rememberRollFormula } from '../panels/ChatPanel'
import { useSession } from '../session'
import { newSeed } from '@/dice'
import { RollModeBar } from '../panels/RollCards'
import { useRollMode } from '../rollMode'
import './Hud.css'

const TOAST_MS = 6000

/**
 * Selected token with a "Find me" control. With nothing selected it offers the player's first owned
 * token instead, so "where am I?" is always one tap away on a phone (`pubkey` is the local player).
 */
export function SelectedTokenChip({ onOpen, pubkey }: { onOpen(): void; pubkey?: PlayerPubkey }) {
  const selected = useGame((s) => s.selectedToken)
  const token = useGame((s) => (selected ? s.tokens[selected] : undefined))
  const character = useGame((s) => (token?.character ? s.characters[token.character] : undefined))
  const mine = useGame((s) => firstOwnedToken(s, pubkey))
  const setSelectedToken = useGame((s) => s.setSelectedToken)
  const focusToken = useTableUi((s) => s.focusToken)
  const find = (t: Token) => { setSelectedToken(t.id); focusToken(t.id) }

  if (!token) {
    if (!mine) return null
    return (
      <div className="chip chip--find">
        <button type="button" className="chip-main" onClick={() => find(mine)} aria-label={`Find my token ${mine.name}`}>
          <span className="dot" style={{ background: mine.color }} />
          <span className="chip-name">{mine.name}</span>
          <span className="chip-hint">⌖ Find me</span>
        </button>
      </div>
    )
  }
  // Prefer the player's own token; the GM (owning nothing) centres on the selection instead.
  const target = mine ?? token
  const findLabel = target.id === token.id ? `Centre the camera on ${token.name}` : `Find my token ${target.name}`
  return (
    <div className="chip">
      <button type="button" className="chip-main" onClick={onOpen} aria-label={`Selected: ${token.name}. Open character sheet`}>
        <span className="dot" style={{ background: token.color }} />
        <span className="chip-name">{token.name}</span>
        {character && character.name !== token.name && <span className="muted small">{character.name}</span>}
        <span className="chip-hint">Sheet ›</span>
      </button>
      <button type="button" className="chip-find" onClick={() => find(target)} aria-label={findLabel} title={findLabel}>⌖</button>
    </div>
  )
}

/**
 * Camera and table tools over the top-right of the table: Eyes (first person from your token; off
 * means the free orbit camera), the grid toggle, touch Select, ruler and ping. Key hints show on
 * desktop; phones and tablets get a vertical rail of 44px buttons under the chip row (Hud.css).
 * Hidden while no table is mounted.
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
      <DicePad />
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

export function RollToast({ roll, who, onOpenChat }: { roll: ChatMessage | null; who(pubkey: string): string; onOpenChat(): void }) {
  const [shown, setShown] = useState<ChatMessage | null>(null)
  useEffect(() => {
    if (!roll?.roll || roll.at < Date.now() - TOAST_MS) return
    setShown(roll)
    const t = setTimeout(() => setShown(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [roll])
  const r = shown?.roll
  const success = r?.outcome && 'success' in r.outcome ? !!r.outcome.success : null
  const critical = !!r?.outcome?.critical
  // The general toast stack (ui/toasts.ts), the initiative chip and the token context menu ride
  // along here so the shell mounts them in the HUD; the chip takes the next chip row under the camera pill.
  return (
    <>
      <Toasts />
      <InitiativeChip />
      <ContextMenu />
      {shown && r && (
        <button type="button" className="toast roll-toast" onClick={onOpenChat} aria-live="polite">
          <span className="muted small">{who(shown.author)}</span>
          <span className="toast-formula">{shown.text}</span>
          <span className="toast-total">{r.total}</span>
          <DiceValues className="muted small" formula={r.formula} dice={r.dice} />
          {success !== null && <span className={success ? 'ok' : 'bad'}>{success ? 'success' : 'fail'}{critical ? '!' : ''}</span>}
        </button>
      )}
    </>
  )
}

/**
 * Dice on the table: a die button on the camera rail opens a pad with the quick dice, "Last" and a
 * formula field. Rolls go to chat and show the 3D dice like `/r`. Esc or a tap outside closes it.
 */
function DicePad() {
  const { controller } = useSession()
  const pack = useGame((s) => s.meta?.pack)
  const [open, setOpen] = useState(false)
  const [formula, setFormula] = useState('')
  const [last, setLast] = useState(lastRollFormula)
  const armed = useRollMode((s) => s.advantage)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('.dice-pad, .cam-dice')) setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true) }
  }, [open])
  if (!controller) return null
  const roll = (f: string) => {
    const t = f.trim()
    if (!t) return
    rememberRollFormula(t)
    setLast(t)
    setOpen(false)
    void controller.dispatch({ type: 'roll', formula: t, seed: newSeed() })
  }
  return (
    <div className="cam-group cam-dice-group">
      <button type="button" className={`cam-btn cam-dice${open ? ' on' : ''}`} aria-expanded={open} aria-label={armed ? `Roll dice (next d20 with ${armed})` : 'Roll dice'} title={armed ? `Next d20 roll with ${armed}` : 'Roll dice'} onClick={() => setOpen(!open)}>
        <Icon name="dice" className="cam-icon" />
        {armed && <kbd aria-hidden>{armed === 'advantage' ? 'ADV' : 'DIS'}</kbd>}
      </button>
      {open && (
        <div className="dice-pad" role="dialog" aria-label="Roll dice">
          <div className="dice-pad-row">
            {quickDice(pack).map((f) => <button key={f} type="button" className="die-chip" onClick={() => roll(f)} aria-label={`Roll ${f}`}>{f}</button>)}
            <button type="button" className="die-chip" disabled={!last} onClick={() => { if (last) roll(last) }} title={last ? `Roll ${last} again` : 'Nothing rolled yet'}>Last</button>
          </div>
          <RollModeBar />
          <form className="dice-pad-form" onSubmit={(e) => { e.preventDefault(); roll(formula); setFormula('') }}>
            <input value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="2d6+1" aria-label="Dice formula" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <button type="submit" className="primary" disabled={!formula.trim()}>Roll</button>
          </form>
        </div>
      )}
    </div>
  )
}

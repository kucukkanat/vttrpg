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
import { InitiativeChip } from '../panels/InitiativePanel'
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
          <span className="cam-label">Eyes</span>
          <kbd aria-hidden>F</kbd>
        </button>
      </div>
      <div className="cam-group">
        <button type="button" className={`cam-btn cam-grid${showGrid ? ' on' : ''}`} aria-pressed={showGrid} aria-label={showGrid ? 'Hide grid' : 'Show grid'}
          title={`${showGrid ? 'Hide' : 'Show'} grid (G)`} onClick={() => set({ showGrid: !showGrid })}>
          <span className="cam-label" aria-hidden>▦</span>
          <kbd aria-hidden>G</kbd>
        </button>
      </div>
      {/* Touch only (Hud.css): taps add tokens to the selection while on; desktop uses Shift/Cmd-click. */}
      <div className="cam-group cam-group--select">
        <button type="button" className={`cam-btn cam-select${multiSelect ? ' on' : ''}`} aria-pressed={multiSelect}
          title="Select several tokens by tapping them" onClick={() => set({ multiSelect: !multiSelect })}>
          <span className="cam-label">Select</span>
        </button>
      </div>
      <div className="cam-group" role="group" aria-label="Table tools">
        <button type="button" className={`cam-btn cam-tool${tool === 'ruler' ? ' on' : ''}`} aria-pressed={tool === 'ruler'} aria-label="Ruler: measure distance"
          title={`${tool === 'ruler' ? 'Put away' : 'Measure with'} the ruler (M)`} onClick={() => set({ tool: tool === 'ruler' ? null : 'ruler' })}>
          <span className="cam-label" aria-hidden>📏</span>
          <kbd aria-hidden>M</kbd>
        </button>
        <button type="button" className={`cam-btn cam-tool${tool === 'ping' ? ' on' : ''}`} aria-pressed={tool === 'ping'} aria-label="Ping: mark a spot for everyone"
          title={tool === 'ping' ? 'Tap the table to ping, Esc to cancel' : 'Ping a spot on the table (or double-tap the floor)'} onClick={() => set({ tool: tool === 'ping' ? null : 'ping' })}>
          <span className="cam-label" aria-hidden>📍</span>
        </button>
      </div>
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

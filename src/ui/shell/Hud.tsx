/**
 * Things that stay visible over the table while panels are hidden: the selected token (tap to open
 * its sheet) and the latest dice result. Both ignore pointer events except on their own controls.
 */
import { useEffect, useState } from 'react'
import { useGame } from '@/state/store'
import type { ChatMessage } from '@/core/doc'
import { Toasts } from './Toasts'
import { DiceValues } from '../components'

const TOAST_MS = 6000

export function SelectedTokenChip({ onOpen }: { onOpen(): void }) {
  const selected = useGame((s) => s.selectedToken)
  const token = useGame((s) => (selected ? s.tokens[selected] : undefined))
  const character = useGame((s) => (token?.character ? s.characters[token.character] : undefined))
  if (!token) return null
  return (
    <button type="button" className="chip" onClick={onOpen} aria-label={`Selected: ${token.name}. Open character sheet`}>
      <span className="dot" style={{ background: token.color }} />
      <span className="chip-name">{token.name}</span>
      {character && character.name !== token.name && <span className="muted small">{character.name}</span>}
      <span className="chip-hint">Sheet ›</span>
    </button>
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
  // The general toast stack (ui/toasts.ts) rides along here so the shell mounts it in the HUD.
  return (
    <>
      <Toasts />
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

import { useState } from 'react'
import type { GameController } from '../controller'
import { useEffectiveToken, useGame } from '@/state/store'
import { SheetView, sheetFor } from '@/rules'
import { newSeed } from '@/dice'
import type { Character } from '@/core/doc'
import type { CharacterId } from '@/core/ids'
import { CharacterCard } from './CharacterCard'
import { loadSheetMode, saveSheetMode, type SheetMode } from './sheetCard'
import { setDataPath } from '../sheetEdit'
import { RollModeBar } from './RollCards'

export function CharacterPanel({ controller }: { controller: GameController }) {
  // The selected token, else the player's own: the sheet stays available when nothing is selected.
  const token = useEffectiveToken(controller.pubkey)
  const character = useGame((s) => (token?.character ? s.characters[token.character] : undefined))
  const [busy, setBusy] = useState(false)
  // Card or full form, remembered per device.
  const [mode, setModeState] = useState<SheetMode>(loadSheetMode)
  const setMode = (m: SheetMode) => { setModeState(m); saveSheetMode(m) }
  const rules = controller.rules
  const isGm = controller.connection.isGm
  const mine = token?.owner === controller.pubkey

  if (!rules) return <div className="panel"><h3>Character</h3><p className="muted small">Rules pack not loaded.</p></div>
  if (!token) return <div className="panel"><h3>Character</h3><p className="muted small">Select a token.</p></div>

  const generate = async () => {
    setBusy(true)
    try {
      const c = await rules.generateCharacter(newSeed(), token.name)
      const owned: Character = { ...c, owner: token.owner ?? (isGm ? undefined : controller.pubkey) }
      await controller.dispatch({ type: 'character.upsert', character: owned })
      await controller.dispatch({ type: 'token.update', token: token.id, patch: { character: owned.id as CharacterId, name: owned.name } })
    } finally { setBusy(false) }
  }

  if (!character) {
    return (
      <div className="panel">
        <h3>Character</h3>
        <p className="muted small">{token.name} has no sheet.</p>
        {(isGm || mine) && <button disabled={busy} onClick={() => void generate()}>{busy ? 'Rolling…' : 'Generate character'}</button>}
      </div>
    )
  }

  const canEdit = isGm || character.owner === controller.pubkey
  const roll = (formula: string, label: string) => void controller.dispatch({ type: 'roll', formula, seed: newSeed(), label, character: character.id })
  return (
    <div className="panel sheet">
      <h3>
        Character
        {mode === 'card' ? (
          <button type="button" className="tiny" aria-pressed={false} onClick={() => setMode('edit')}>{canEdit ? 'Edit sheet' : 'Full sheet'}</button>
        ) : (
          <button type="button" className="tiny" aria-pressed onClick={() => setMode('card')}>Done</button>
        )}
      </h3>
      <RollModeBar />
      {token.concentrating && (isGm || mine) && (
        <p className="small">
          Concentrating on {token.concentrating.name}{' '}
          <button type="button" className="tiny" onClick={() => void controller.dispatch({ type: 'concentration.end', token: token.id })}>End</button>
        </p>
      )}
      {mode === 'card' ? (
        <CharacterCard rules={rules} character={character} token={token} assets={controller.assets} onRoll={roll} />
      ) : (
        <SheetView
          schema={sheetFor(rules.pack, character)}
          character={character}
          readOnly={!canEdit}
          compute={(expr) => rules.evaluateNow(expr, character)}
          onChange={(path, value) => {
            const next: Character = path === 'name' ? { ...character, name: String(value) } : { ...character, data: setDataPath(character.data, path, value) }
            void controller.dispatch({ type: 'character.upsert', character: next })
          }}
          onRoll={roll}
        />
      )}
    </div>
  )
}

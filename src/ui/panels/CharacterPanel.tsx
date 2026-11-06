import { useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { SheetView } from '@/rules'
import { newSeed } from '@/dice'
import type { Character } from '@/core/doc'
import type { CharacterId } from '@/core/ids'

function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split('.')
  const next = rest.length ? setPath(((obj[head] as Record<string, unknown>) ?? {}), rest.join('.'), value) : value
  return { ...obj, [head]: next }
}

export function CharacterPanel({ controller }: { controller: GameController }) {
  const selected = useGame((s) => s.selectedToken)
  const token = useGame((s) => (selected ? s.tokens[selected] : undefined))
  const character = useGame((s) => (token?.character ? s.characters[token.character] : undefined))
  const [busy, setBusy] = useState(false)
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
  return (
    <div className="panel sheet">
      <h3>Character</h3>
      <SheetView
        schema={rules.pack.sheet}
        character={character}
        readOnly={!canEdit}
        onChange={(path, value) => {
          const next: Character = path === 'name' ? { ...character, name: String(value) } : { ...character, data: setPath(character.data, path, value) }
          void controller.dispatch({ type: 'character.upsert', character: next })
        }}
        onRoll={(formula, label) => void controller.dispatch({ type: 'roll', formula, seed: newSeed(), label, character: character.id })}
      />
    </div>
  )
}

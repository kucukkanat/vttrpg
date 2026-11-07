/**
 * Founder-only controls in the Players panel: make a player co-GM (they can edit the game and
 * keep it running while the founder is away), end that access, and hand hosting (who applies
 * players' moves and rolls) to a co-GM or take it back. Everyone else sees who is co-GM and who
 * is hosting. The net layer enforces all of it; see ARCHITECTURE.md, "Co-GM and handover".
 */
import { useState } from 'react'
import type { GameController } from '../controller'
import type { PlayerPubkey } from '@/core/ids'
import { useGame } from '@/state/store'
import { useAuthority } from '../authority'

const css = `
.cogm { margin-top: var(--sp-3); padding-top: var(--sp-2); border-top: 1px solid var(--border); display: grid; gap: var(--sp-2); }
.cogm h4 { margin: 0; font-size: var(--fs-md); }
.cogm p { margin: 0; }
.cogm-row { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; min-height: 44px; }
.cogm-row strong { flex: 1 1 8em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cogm-row button { min-height: 40px; }
`

export function CoGmControls({ controller }: { controller: GameController }) {
  const { authority, processing } = useAuthority(controller)
  const presence = useGame((s) => s.presence)
  const names = useGame((s) => s.meta?.names)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const conn = controller.connection
  const founder = conn.gm === controller.pubkey && conn.isGm
  const nameOf = (pk: string) => presence[pk]?.name || names?.[pk] || pk.slice(0, 8)
  const hostName = authority.host === controller.pubkey ? 'you' : nameOf(authority.host)

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message.replace(/^net: /, '') : String(e)) } finally { setBusy(null) }
  }

  // Candidates: present players plus co-GMs who are not around right now.
  const people = [...new Set([...Object.keys(presence), ...authority.coGms])].filter((pk) => pk !== conn.gm) as PlayerPubkey[]

  if (!founder) {
    if (!authority.coGms.length) return null
    return (
      <div className="cogm">
        <style>{css}</style>
        <p className="muted small">
          Co-GMs: {authority.coGms.map(nameOf).join(', ')} · hosting: {authority.host === conn.gm ? 'the GM' : hostName}
          {conn.isGm && processing && ' (this device applies moves and rolls now)'}
        </p>
      </div>
    )
  }

  return (
    <div className="cogm">
      <style>{css}</style>
      <h4>Co-GMs</h4>
      <p className="muted small">A co-GM can edit everything and keeps the game running while you are offline. Hosting: {hostName}.</p>
      {people.length === 0 && <p className="muted small">Players who join show up here.</p>}
      {people.map((pk) => {
        const co = authority.coGms.includes(pk)
        const hosting = authority.host === pk
        return (
          <div key={pk} className="cogm-row">
            <strong title={pk}>{nameOf(pk)}</strong>
            {!co && <button type="button" disabled={busy !== null} onClick={() => void run(pk, () => conn.grantCoGm(pk))}>Make co-GM</button>}
            {co && !hosting && <button type="button" disabled={busy !== null} onClick={() => void run(pk, () => conn.setHost(pk))}>Hand over hosting</button>}
            {co && hosting && <button type="button" disabled={busy !== null} onClick={() => void run(pk, () => conn.setHost(null))}>Take hosting back</button>}
            {co && <button type="button" className="danger" disabled={busy !== null} onClick={() => void run(pk, () => conn.revokeCoGm(pk))}>Remove co-GM</button>}
          </div>
        )
      })}
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  )
}

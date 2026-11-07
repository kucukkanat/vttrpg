/**
 * The one token editor: the Build Inspector's token context, and the Tokens card for players on
 * their own tokens. Identity (name, colour), owner, size, vision and light, hidden, a link to the
 * full sheet (the character card), skills (the skill editor card) and initiative. Sheet-heavy
 * packs stay out of it: the card holds the sheet.
 */
import type { ComponentType, ReactNode } from 'react'
import type { GameController } from '../../controller'
import { useGame } from '@/state/store'
import type { Token } from '@/core/doc'
import type { PlayerPubkey } from '@/core/ids'
import { TOKEN_SIZE_LIMITS } from '@/table/editing'
import { InitiativeButton } from '../../skillbar/SkillBar'
import { requestOpenPanel } from '../../shell/useShortcuts'

export const TOKEN_COLORS = ['#e0a458', '#7cc4ff', '#8fd18f', '#f28b82', '#c58af9', '#ffd166', '#9aa0a6']

export type SectionComponent = ComponentType<{ id: string; title: string; summary?: ReactNode; children: ReactNode }>

/** Plain sections for the Tokens card: a heading over its fields. */
export function PlainSection({ title, children }: { id: string; title: string; summary?: ReactNode; children: ReactNode }) {
  return <div className="bw-plain"><h4>{title}</h4>{children}</div>
}

export function TokenEditor({ controller, token, Section = PlainSection }: { controller: GameController; token: Token; Section?: SectionComponent }) {
  const isGm = controller.connection.isGm
  const presence = useGame((s) => s.presence)
  const init = useGame((s) => s.initiative)
  const patch = (p: Partial<Token>) => void controller.dispatch({ type: 'token.update', token: token.id, patch: p })
  const inOrder = !!init?.order.some((e) => e.token === token.id)
  const ownerName = !token.owner || token.owner === controller.pubkey ? 'GM' : presence[token.owner]?.name ?? `${token.owner.slice(0, 8)} (offline)`
  const openCard = (id: string) => {
    useGame.getState().setSelectedToken(token.id)
    requestOpenPanel(id)
  }
  return (
    <>
      <label className="bw-field">Name<input value={token.name} onChange={(e) => patch({ name: e.target.value })} /></label>
      <div className="bw-row row">
        <button type="button" className="tiny" onClick={() => openCard('character')} title="The full sheet, as the card">Sheet ›</button>
        {isGm && <button type="button" className="tiny" onClick={() => openCard('skills-editor')} title="Create and edit skills, as the card">Skills ›</button>}
        {isGm && <InitiativeButton controller={controller} token={token} active={!!init?.active} inOrder={inOrder} />}
      </div>
      <Section id="token.look" title="Colour and size" summary={`×${token.scale}`}>
        <div className="swatches">
          {TOKEN_COLORS.map((c) => <button key={c} type="button" className={`swatch ${c === token.color ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => patch({ color: c })} />)}
        </div>
        <label className="bw-field">Size (cells)
          <input type="number" min={TOKEN_SIZE_LIMITS.min} max={TOKEN_SIZE_LIMITS.max} step={0.25} value={token.scale}
            onChange={(e) => { const v = Number(e.target.value); if (v > 0) patch({ scale: Math.min(TOKEN_SIZE_LIMITS.max, Math.max(TOKEN_SIZE_LIMITS.min, v)) }) }} />
        </label>
      </Section>
      <Section id="token.vision" title="Vision and light" summary={`${token.vision} · ${token.light}`}>
        <div className="grid2">
          <label>Vision<input type="number" min={0} max={30} value={token.vision} onChange={(e) => patch({ vision: Number(e.target.value) })} /></label>
          <label>Light<input type="number" min={0} max={30} value={token.light} onChange={(e) => patch({ light: Number(e.target.value) })} /></label>
        </div>
      </Section>
      {isGm && (
        <Section id="token.access" title="Owner and visibility" summary={`${ownerName}${token.hidden ? ' · hidden' : ''}`}>
          <label className="bw-field">Owner
            <select value={token.owner ?? ''} onChange={(e) => void controller.dispatch({ type: 'token.claim', token: token.id, owner: (e.target.value || controller.pubkey) as PlayerPubkey })}>
              <option value="">GM</option>
              {Object.values(presence).filter((p) => p.pubkey !== controller.pubkey).map((p) => <option key={p.pubkey} value={p.pubkey}>{p.name}</option>)}
              {token.owner && token.owner !== controller.pubkey && !presence[token.owner] && <option value={token.owner}>{token.owner.slice(0, 8)} (offline)</option>}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={token.hidden} onChange={(e) => patch({ hidden: e.target.checked })} /> Hidden from players</label>
          <button type="button" className="tiny danger" onClick={() => { void controller.dispatch({ type: 'token.remove', token: token.id }); useGame.getState().setSelectedToken(null) }}>Remove token</button>
        </Section>
      )}
    </>
  )
}

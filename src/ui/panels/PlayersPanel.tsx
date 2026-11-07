/**
 * Who is at the table: every present player with their name, a GM badge, the token they own in
 * the active scene (or "spectating"). The GM gets an "Assign…" control per player that lists the
 * unowned tokens of the scene; players get "Pick a character", which opens the claim prompt.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { games } from '../games'
import { currentProfile } from '@/net'
import type { Presence } from '@/core/presence'
import type { Token } from '@/core/doc'
import type { PlayerPubkey, TokenId } from '@/core/ids'
import { useClaimPrompt } from './ClaimPrompt'
import { CoGmControls } from './CoGmControls'
import { SoundPrefs } from './SoundPrefs'
import { buildInviteUrl, selectAll, useCopy } from '../invite'
import { ListRow } from '../components'
import { colorName } from '../colorName'
import { setSkipDice, useSkipDicePreference } from '@/dice/skipDice'
import { setTextScale, setThemePref, useAppearance, type TextScale, type ThemePref } from '../theme/theme'
import { FeelPrefs } from '../feedback/FeelPrefs'
import { ownerShapeIn, type OwnerShape } from '@/table/ownerShape'
import { OwnerShapeGlyph } from '@/table/OwnerShapeGlyph'
import { GRAPHICS_LABELS, GRAPHICS_TIERS, resolveTier, setGraphicsSetting, useGraphicsSetting, type GraphicsSetting } from '@/table'
import './invite.css'

/** A player whose presence is older than this is shown as away. */
export const AWAY_AFTER_MS = 35_000

const css = `
.players-row { display: block; }
.players-row .list-row-main { min-height: 52px; padding: var(--sp-1) var(--sp-2); width: 100%; }
.players-row.away .list-row-main { opacity: .55; }
.players-who { flex: 1; min-width: 0; display: grid; gap: 1px; }
.players-name { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; }
.players-name strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.players-badge { flex: none; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .08em; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--accent); color: var(--accent); }
.players-token { color: var(--muted); font-size: var(--fs-sm); display: flex; align-items: center; gap: 6px; min-width: 0; }
.players-token .dot { width: 8px; height: 8px; }
.players-action { flex: none; color: var(--accent); font-size: var(--fs-sm); }
.players-assign { margin: var(--sp-1) 0 var(--sp-2); padding: var(--sp-2); border: 1px solid var(--border); border-radius: var(--r-md); background: var(--panel-2); display: grid; gap: var(--sp-1); }
.players-assign button { justify-content: flex-start; min-height: 44px; }
.players-pick { width: 100%; min-height: 48px; font-size: var(--fs-lg); margin-top: var(--sp-2); }
.players-prefs { margin-top: var(--sp-3); padding-top: var(--sp-2); border-top: 1px solid var(--border); }
.players-prefs .check { margin: 0; }
.players-display { display: flex; flex-wrap: wrap; column-gap: var(--sp-4); }
.players-display .players-graphics { margin: 0; }
.players-graphics { display: flex; align-items: center; gap: var(--sp-2); min-height: 44px; }
.players-graphics select { width: auto; }
.players-toggle { display: flex; align-items: center; gap: var(--sp-2); min-height: 44px; margin-top: var(--sp-2); padding: 0 var(--sp-2); cursor: pointer; font-size: var(--fs-md); }
.players-toggle input { width: 24px; height: 24px; margin: 0; flex: none; accent-color: var(--accent); }
`

interface Row {
  pubkey: PlayerPubkey
  name: string
  color: string
  isGm: boolean
  /** Co-GM by the founder's grant (badge only; the GM badge wins for the founder). */
  isCoGm?: boolean
  isMe: boolean
  away: boolean
  owned: Token[]
}

export function PlayersPanel({ controller }: { controller: GameController }) {
  const presence = useGame((s) => s.presence)
  const tokens = useGame((s) => s.tokens)
  const scene = useGame((s) => s.meta?.activeScene ?? null)
  const showHp = useGame((s) => s.meta?.showHpToPlayers ?? false)
  const gm = controller.connection.gm
  const me = controller.pubkey
  const isGm = controller.connection.isGm
  const show = useClaimPrompt((s) => s.show)
  const [assigning, setAssigning] = useState<PlayerPubkey | null>(null)

  // Presence only arrives from others and carries their clock; tick so "away" updates without input.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  const inScene = useMemo(() => Object.values(tokens).filter((t) => t.scene === scene), [tokens, scene])
  const unowned = useMemo(() => inScene.filter((t) => !t.owner).sort((a, b) => a.name.localeCompare(b.name)), [inScene])

  const rows = useMemo<Row[]>(() => {
    // The registry entry is this device's; under a dev profile it belongs to the default identity, so use the profile name.
    const myName = currentProfile() ?? games.get(controller.connection.gameId)?.displayName ?? (isGm ? 'GM' : 'You')
    const self: Row = { pubkey: me, name: myName, color: '#7cc4ff', isGm, isMe: true, away: false, owned: inScene.filter((t) => t.owner === me) }
    const others = Object.values(presence)
      .filter((p: Presence) => p.pubkey !== me)
      .map<Row>((p) => ({
        pubkey: p.pubkey,
        name: p.name || p.pubkey.slice(0, 8),
        color: p.color,
        isGm: p.pubkey === gm,
        isCoGm: p.pubkey !== gm && (controller.connection.isWriter?.(p.pubkey) ?? false),
        isMe: false,
        away: now - p.lastSeen > AWAY_AFTER_MS,
        owned: inScene.filter((t) => t.owner === p.pubkey),
      }))
      .sort((a, b) => Number(b.isGm) - Number(a.isGm) || Number(a.away) - Number(b.away) || a.name.localeCompare(b.name))
    return [self, ...others]
  }, [presence, inScene, me, gm, isGm, now, controller])

  const assign = (owner: PlayerPubkey, token: TokenId) => {
    void controller.dispatch({ type: 'token.claim', token, owner })
    setAssigning(null)
  }

  const skipDice = useSkipDicePreference()
  const appearance = useAppearance()
  // The shape each player's tokens carry on their owner ring, shown beside the colour.
  const shapes = useMemo(() => {
    const m = new Map<string, OwnerShape>()
    for (const r of rows) { const sh = ownerShapeIn({ tokens, meta: { gm } }, r.pubkey); if (sh) m.set(r.pubkey, sh) }
    return m
  }, [rows, tokens, gm])
  // GM-only meta flag, written straight to the doc like `meta.names` (the GM is the doc's authority).
  const setShowHp = (on: boolean) => {
    if (!isGm) return
    controller.connection.doc.getMap<unknown>('meta').set('showHpToPlayers', on)
  }

  return (
    <div className="panel">
      <style>{css}</style>
      <h3>Players</h3>
      <ul className="list">
        {rows.map((r) => {
          const open = assigning === r.pubkey
          const assignable = isGm && !r.isGm
          const assignBox = open ? (
            <div className="players-assign" role="group" aria-label={`Assign a token to ${r.name}`}>
              {!scene && <span className="muted small">No active scene.</span>}
              {scene && unowned.length === 0 && <span className="muted small">Every token in this scene has an owner.</span>}
              {unowned.map((t) => (
                <button key={t.id} type="button" onClick={() => assign(r.pubkey, t.id as TokenId)}>
                  <span className="dot" style={{ background: t.color }} /> Give {t.name}
                </button>
              ))}
              {r.owned.map((t) => (
                <button key={`back-${t.id}`} type="button" onClick={() => assign(me, t.id as TokenId)}>
                  Take back {t.name}
                </button>
              ))}
            </div>
          ) : null
          return (
            <ListRow
              key={r.pubkey}
              className={`players-row${r.away ? ' away' : ''}`}
              onSelect={assignable ? () => setAssigning(open ? null : r.pubkey) : undefined}
              expanded={assignable ? open : undefined}
              label={assignable ? `${open ? 'Cancel assigning a token to' : 'Assign a token to'} ${r.name}` : undefined}
              trailing={assignBox}
            >
              <span className="dot" style={{ background: r.color }} role="img" aria-label={colorName(r.color)} />
              {!r.isGm && shapes.get(r.pubkey) && <OwnerShapeGlyph shape={shapes.get(r.pubkey)!} color={r.color} size={14} title={`${shapes.get(r.pubkey)} marker on their tokens`} />}
              <div className="players-who">
                <div className="players-name">
                  <strong>{r.name}</strong>
                  {r.isMe && <span className="muted small">you</span>}
                  {r.isGm && <span className="players-badge">GM</span>}
                  {r.isCoGm && <span className="players-badge">Co-GM</span>}
                  {r.away && <span className="muted small">away</span>}
                </div>
                <div className="players-token">
                  {r.owned.length ? (
                    r.owned.map((t) => (
                      <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span className="dot" style={{ background: t.color }} />{t.name}
                      </span>
                    ))
                  ) : r.isGm ? (
                    <span>running the game</span>
                  ) : (
                    <span>spectating</span>
                  )}
                </div>
              </div>
              {assignable && <span className="players-action" aria-hidden>{open ? 'Cancel' : 'Assign…'}</span>}
            </ListRow>
          )
        })}
      </ul>
      {rows.length === 1 && (
        <div className="players-empty">
          <p className="muted">No players yet</p>
          {isGm ? <CopyInvite controller={controller} /> : <p className="muted small">Others appear here as they join.</p>}
        </div>
      )}
      {isGm && (
        <label className="players-toggle">
          <input type="checkbox" checked={showHp} onChange={(e) => setShowHp(e.target.checked)} />
          <span>Show HP and conditions to players</span>
        </label>
      )}
      <CoGmControls controller={controller} />
      {!isGm && scene && (
        <button type="button" className="players-pick" onClick={show}>Pick a character</button>
      )}
      <div className="players-prefs">
        <label className="check">
          <input type="checkbox" checked={skipDice} onChange={(e) => setSkipDice(e.target.checked)} />
          <span>Skip 3D dice <span className="muted small">· results still show in chat</span></span>
        </label>
        <FeelPrefs />
        {/* This device's display: graphics tier, theme and text size side by side, then sound. */}
        <div className="players-display" role="group" aria-label="Display on this device">
          <GraphicsSelect />
          <label className="players-graphics">
            <span>Theme</span>
            <select value={appearance.theme} onChange={(e) => setThemePref(e.target.value as ThemePref)} aria-label="Theme on this device">
              <option value="system">Match the device</option>
              <option value="dark">Dark</option>
              <option value="daylight">Daylight (high contrast)</option>
            </select>
          </label>
          <label className="players-graphics">
            <span>Text size</span>
            <select value={appearance.textScale} onChange={(e) => setTextScale(e.target.value as TextScale)} aria-label="Text size on this device">
              <option value="default">Default</option>
              <option value="large">Large</option>
              <option value="larger">Larger</option>
            </select>
          </label>
        </div>
        <SoundPrefs controller={controller} />
      </div>
    </div>
  )
}

/**
 * Graphics quality on this device (stored locally, never synced). Auto names the tier it picked.
 * Every tier keeps the same look; lower ones trade resolution, shadows and frame rate for battery.
 */
function GraphicsSelect() {
  const setting = useGraphicsSetting()
  const auto = GRAPHICS_LABELS[resolveTier('auto')]
  return (
    <label className="players-graphics">
      <span>Graphics</span>
      <select value={setting} onChange={(e) => setGraphicsSetting(e.target.value as GraphicsSetting)} aria-label="Graphics quality on this device">
        <option value="auto">Auto ({auto})</option>
        {GRAPHICS_TIERS.map((t) => <option key={t} value={t}>{GRAPHICS_LABELS[t]}</option>)}
      </select>
    </label>
  )
}

/** GM: one tap copies the invite link; when the clipboard is blocked the link is shown selected instead. */
function CopyInvite({ controller }: { controller: GameController }) {
  const link = buildInviteUrl(controller.connection)
  const { state, copy } = useCopy(link)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (state === 'failed') selectAll(inputRef.current) }, [state])
  return (
    <>
      <button type="button" className="primary" onClick={() => void copy()} aria-live="polite">
        {state === 'copied' ? 'Copied' : 'Copy invite link'}
      </button>
      {state === 'failed' && (
        <>
          <input ref={inputRef} readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
          <p className="muted small">Copy is blocked here. The link is selected: press Ctrl/⌘+C or long-press it.</p>
        </>
      )}
      <p className="muted small">Players open it in any browser, no account needed.</p>
    </>
  )
}

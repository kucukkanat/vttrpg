/**
 * Token context menu: opened by a right-click or a still long-press on a token (`tableState.contextMenu`,
 * set by TokenMesh), drawn as a DOM overlay inside `.hud` at the pointer, clamped to the table and its
 * safe areas. Rows are 44px; Esc, a tap outside or any action closes it.
 *
 *   Sheet       open the Character panel for this token
 *   Attack      aim the pack's first attack-like skill from this token (no skill or no sheet: open Skills)
 *   Edit        open the Edit panel
 *   Hide/Show   GM: toggle `token.hidden`
 *   Assign to…  GM: submenu of present players (and the GM) → `token.claim`
 *   Remove      GM: `token.remove` for this token, or the whole selection when it is a member (undo toasts come from the controller)
 *
 * Players see Sheet / Attack / Edit on their own tokens only (TokenMesh never opens it on other tokens).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Token } from '@/core/doc'
import type { PlayerPubkey } from '@/core/ids'
import type { SkillDef } from '@/core/pack'
import { useGame } from '@/state/store'
import { useTableUi, type ContextMenuRequest } from '@/table/tableState'
import type { GameController } from '../controller'
import { useSession } from '../session'
import { useTargeting } from '../targeting'
import { requestOpenPanel } from './useShortcuts'
import './ContextMenu.css'

/** The pack's first skill that reads as an attack: deals damage and is aimed at something. Falls back to the first aimed skill. */
export function firstAttackSkill(skills: readonly SkillDef[]): SkillDef | undefined {
  const aimed = skills.filter((s) => s.target.kind !== 'self')
  return aimed.find((s) => s.effects.some((e) => e.kind === 'damage')) ?? aimed[0]
}

export interface MenuPlacement {
  /** Requested point, relative to the container. */
  x: number
  y: number
  /** Menu size. */
  w: number
  h: number
  /** Container size. */
  width: number
  height: number
  /** Container padding (the HUD's includes the safe-area insets). */
  pad: { left: number; top: number; right: number; bottom: number }
}

/** Top-left corner for the menu: at the point, pushed back inside the padded container when it would overflow. */
export function placeMenu(p: MenuPlacement): { left: number; top: number } {
  const maxLeft = Math.max(p.pad.left, p.width - p.pad.right - p.w)
  const maxTop = Math.max(p.pad.top, p.height - p.pad.bottom - p.h)
  return {
    left: Math.min(Math.max(p.x, p.pad.left), maxLeft),
    top: Math.min(Math.max(p.y, p.pad.top), maxTop),
  }
}

export function ContextMenu() {
  const req = useTableUi((s) => s.contextMenu)
  const token = useGame((s) => (req ? s.tokens[req.token] : undefined))
  const controller = useSession().controller
  const close = useCallback(() => useTableUi.getState().set({ contextMenu: null }), [])
  // The token left the document while the menu was up (removed by someone else).
  useEffect(() => { if (req && !token) close() }, [req, token, close])
  if (!req || !token || !controller) return null
  return <Menu key={`${req.token}:${req.x},${req.y}`} req={req} token={token} controller={controller} onClose={close} />
}

function Menu({ req, token, controller, onClose }: { req: ContextMenuRequest; token: Token; controller: GameController; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'main' | 'assign'>('main')
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const presence = useGame((s) => s.presence)
  const selectedCount = useGame((s) => (s.selectedTokens.includes(token.id) ? s.selectedTokens.length : 1))
  const isGm = controller.connection.isGm
  const skill = firstAttackSkill(controller.rules?.allSkills() ?? [])

  // Place at the pointer, inside the HUD (its padding carries the safe-area insets). Re-run when the list changes height.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const parent = el.offsetParent as HTMLElement | null
    const rect = parent?.getBoundingClientRect()
    const cs = parent ? getComputedStyle(parent) : null
    const px = (v: string | undefined) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : 8 }
    setPos(placeMenu({
      x: req.x - (rect?.left ?? 0), y: req.y - (rect?.top ?? 0), w: el.offsetWidth, h: el.offsetHeight,
      width: rect?.width ?? window.innerWidth, height: rect?.height ?? window.innerHeight,
      pad: { left: px(cs?.paddingLeft), top: px(cs?.paddingTop), right: px(cs?.paddingRight), bottom: px(cs?.paddingBottom) },
    }))
  }, [req.x, req.y, mode])

  // Esc closes (and does not also deselect: the table's own Esc handler runs in the bubble phase); a press outside closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose() } }
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true) }
  }, [onClose])
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus() }, [mode])

  const dispatch = (intent: Parameters<GameController['dispatch']>[0]) => void controller.dispatch(intent)
  const sheet = () => { requestOpenPanel('character'); onClose() }
  const edit = () => { requestOpenPanel('object'); onClose() }
  const attack = () => {
    onClose()
    if (!skill || !token.character) { requestOpenPanel('skills'); return }
    useTargeting.getState().start({ skillId: skill.id, name: skill.name, source: token.id, shape: skill.target })
  }
  const toggleHidden = () => { dispatch({ type: 'token.update', token: token.id, patch: { hidden: !token.hidden } }); onClose() }
  const assign = (owner: PlayerPubkey) => { dispatch({ type: 'token.claim', token: token.id, owner }); onClose() }
  const remove = () => {
    const s = useGame.getState()
    const ids = s.selectedTokens.includes(token.id) ? s.selectedTokens : [token.id]
    for (const id of ids) dispatch({ type: 'token.remove', token: id })
    s.clearSelection()
    onClose()
  }

  const players = Object.values(presence).filter((p) => p.pubkey !== controller.pubkey)
  const offlineOwner = token.owner && token.owner !== controller.pubkey && !presence[token.owner] ? token.owner : null
  const style = pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' as const }

  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label={`${token.name} actions`} style={style} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx-head">
        <span className="dot" style={{ background: token.color }} />
        <span className="ctx-name">{token.name}</span>
        {selectedCount > 1 && <span className="ctx-sub">{selectedCount} selected</span>}
      </div>
      {mode === 'main' ? (
        <>
          <button type="button" role="menuitem" className="ctx-row" onClick={sheet}>Sheet</button>
          <button type="button" role="menuitem" className="ctx-row" onClick={attack}>
            Attack{skill && token.character && <span className="ctx-sub">{skill.name}</span>}
          </button>
          <button type="button" role="menuitem" className="ctx-row" onClick={edit}>Edit</button>
          {isGm && (
            <>
              <div className="ctx-sep" role="separator" />
              <button type="button" role="menuitem" className="ctx-row" onClick={toggleHidden}>{token.hidden ? 'Show' : 'Hide'}</button>
              <button type="button" role="menuitem" className="ctx-row" aria-haspopup="menu" onClick={() => setMode('assign')}>
                Assign to…<span className="ctx-sub">{token.owner ? presence[token.owner]?.name ?? (token.owner === controller.pubkey ? 'GM' : token.owner.slice(0, 8)) : 'GM'}</span>
              </button>
              <div className="ctx-sep" role="separator" />
              <button type="button" role="menuitem" className="ctx-row ctx-row--danger" onClick={remove}>
                {selectedCount > 1 ? `Remove ${selectedCount} tokens` : 'Remove'}
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <button type="button" role="menuitem" className="ctx-row" onClick={() => setMode('main')}>‹ Back</button>
          <div className="ctx-sep" role="separator" />
          <button type="button" role="menuitem" className="ctx-row" aria-checked={!token.owner || token.owner === controller.pubkey} onClick={() => assign(controller.pubkey)}>
            GM{(!token.owner || token.owner === controller.pubkey) && <span className="ctx-sub">✓</span>}
          </button>
          {players.map((p) => (
            <button key={p.pubkey} type="button" role="menuitem" className="ctx-row" aria-checked={token.owner === p.pubkey} onClick={() => assign(p.pubkey)}>
              <span className="dot" style={{ background: p.color }} />{p.name}{token.owner === p.pubkey && <span className="ctx-sub">✓</span>}
            </button>
          ))}
          {offlineOwner && <div className="ctx-head">{offlineOwner.slice(0, 8)} (offline) ✓</div>}
          {players.length === 0 && <div className="ctx-head">No players present</div>}
        </>
      )}
    </div>
  )
}

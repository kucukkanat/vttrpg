/**
 * Token context menu: opened by a right-click or a still long-press on a token (`tableState.contextMenu`,
 * set by TokenMesh), drawn as a DOM overlay inside `.hud` at the pointer, clamped to the table and its
 * safe areas. Rows are 44px; Esc, a tap outside or any action closes it.
 *
 *   Sheet       open the Character panel for this token
 *   Attack      aim the pack's first attack-like skill from this token (no skill or no sheet: open Skills)
 *   Edit        edit mode on this token (gizmo and the edit bar), like a double tap
 *   Hide/Show   GM: toggle `token.hidden`
 *   Assign to…  GM: submenu of present players (and the GM) → `token.claim`
 *   Remove      GM: `token.remove` for this token, or the whole selection when it is a member (undo toasts come from the controller)
 *
 * Players see Sheet / Attack / Edit on their own tokens only (TokenMesh never opens it on other tokens).
 *
 * A long-press opens the radial twin instead (`req.radial`): big round buttons in a ring around the
 * finger, clockwise from the top: Sheet, Attack, Ping (rings the token's spot for everyone), the GM's
 * HP −1 / +1 and Hide/Show, Edit, and More, which turns it into the list above (Assign, Remove).
 * The ring is pulled in from the edges so every button stays on screen; the centre closes it.
 *
 * Keyboard: focus starts on the first item, arrows walk the items (wrapping), Home / End jump, Esc
 * closes, and focus returns to whatever opened the menu (the token bar's ⋯).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Token } from '@/core/doc'
import type { PlayerPubkey } from '@/core/ids'
import type { SkillDef } from '@/core/pack'
import { useGame } from '@/state/store'
import { useTableUi, type ContextMenuRequest } from '@/table/tableState'
import { startEditing } from '@/table/editTap'
import { pingAt } from '@/table/ping'
import type { GameController } from '../controller'
import { haptic } from '../feedback/haptics'
import { Icon, type IconName } from '../icons'
import { changeTokenHp } from '../skillbar/changeHp'
import { useSession } from '../session'
import { useTargeting } from '../targeting'
import { requestOpenPanel } from './useShortcuts'
import { tokenSkillList } from '../skillbar/tokenSkills'
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

/** Radial menu metrics: ring radius to the button centres, and the button size (44px+ touch targets). */
export const RADIAL_RADIUS = 84
export const RADIAL_ITEM = 56

/**
 * Centre and button positions for a radial menu of `n` buttons around (x, y), clockwise from the
 * top. The centre is pulled inwards so the whole ring stays inside the padded container (and is
 * centred in it when the container is too small for the ring).
 */
export function radialLayout(n: number, p: { x: number; y: number; width: number; height: number; pad: MenuPlacement['pad'] }, radius = RADIAL_RADIUS, item = RADIAL_ITEM): { cx: number; cy: number; items: { x: number; y: number }[] } {
  const reach = radius + item / 2
  const clampAxis = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi))
  const cx = clampAxis(p.x, p.pad.left + reach, p.width - p.pad.right - reach)
  const cy = clampAxis(p.y, p.pad.top + reach, p.height - p.pad.bottom - reach)
  const items = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, n)
    return { x: Math.round(Math.cos(a) * radius), y: Math.round(Math.sin(a) * radius) }
  })
  return { cx, cy, items }
}

/**
 * Which menu item a key moves focus to: arrows step (wrapping), Home / End jump to the ends;
 * null for any other key. A radial menu takes all four arrows (left/up back, right/down on).
 */
export function menuKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown': case 'ArrowRight': return (index + 1 + count) % count
    case 'ArrowUp': case 'ArrowLeft': return (index - 1 + count) % count
    case 'Home': return 0
    case 'End': return count - 1
    default: return null
  }
}

type MenuMode = 'radial' | 'main' | 'assign'
interface RadialItem { key: string; label: string; icon?: IconName; text?: string; run(): void; more?: boolean }

function Menu({ req, token, controller, onClose }: { req: ContextMenuRequest; token: Token; controller: GameController; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<MenuMode>(req.radial ? 'radial' : 'main')
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const presence = useGame((s) => s.presence)
  const selectedCount = useGame((s) => (s.selectedTokens.includes(token.id) ? s.selectedTokens.length : 1))
  const isGm = controller.connection.isGm
  const skill = firstAttackSkill(tokenSkillList(token, controller.rules?.allSkills() ?? []))
  const hasHp = !!token.character && !!controller.rules?.pack.resources[0]

  // Place at the pointer, inside the HUD (its padding carries the safe-area insets). Re-run when the list changes height.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const parent = el.offsetParent as HTMLElement | null
    const rect = parent?.getBoundingClientRect()
    const cs = parent ? getComputedStyle(parent) : null
    const px = (v: string | undefined) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) ? n : 8 }
    const box = {
      x: req.x - (rect?.left ?? 0), y: req.y - (rect?.top ?? 0),
      width: rect?.width ?? window.innerWidth, height: rect?.height ?? window.innerHeight,
      pad: { left: px(cs?.paddingLeft), top: px(cs?.paddingTop), right: px(cs?.paddingRight), bottom: px(cs?.paddingBottom) },
    }
    if (mode === 'radial') {
      const { cx, cy } = radialLayout(0, box)
      setPos({ left: cx, top: cy })
      return
    }
    setPos(placeMenu({ ...box, w: el.offsetWidth, h: el.offsetHeight }))
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
  // Focus goes back where it came from (the ⋯ button) when the menu closes with focus inside it.
  const returnTo = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement)
  useLayoutEffect(() => {
    const el = ref.current
    return () => {
      const back = returnTo.current
      if (el && el.contains(document.activeElement) && back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus()
    }
  }, [])
  useEffect(() => { if (req.radial) haptic('press') }, [req.radial])

  /** Arrow keys walk the items (wrapping), Home / End jump to the ends. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])
    const next = menuKeyTarget(e.key, items.indexOf(document.activeElement as HTMLElement), items.length)
    if (next === null) return
    e.preventDefault()
    items[next]?.focus()
  }

  const dispatch = (intent: Parameters<GameController['dispatch']>[0]) => void controller.dispatch(intent)
  const ping = () => { pingAt(token.position.x, token.position.z); onClose() }
  const hp = (delta: number) => { changeTokenHp(controller, token, delta) }
  const sheet = () => { requestOpenPanel('character'); onClose() }
  const edit = () => { onClose(); startEditing({ kind: 'token', id: token.id }) }
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

  if (mode === 'radial') {
    const items: RadialItem[] = [
      { key: 'sheet', label: 'Sheet', icon: 'sheet', run: sheet },
      { key: 'attack', label: skill && token.character ? skill.name : 'Attack', icon: 'swords', run: attack },
      { key: 'ping', label: 'Ping', icon: 'pin', run: ping },
      ...(isGm && hasHp ? [
        { key: 'hp-', label: 'HP −1', text: '−1', run: () => hp(-1) },
        { key: 'hp+', label: 'HP +1', text: '+1', run: () => hp(1) },
      ] : []),
      ...(isGm ? [{ key: 'hide', label: token.hidden ? 'Show' : 'Hide', icon: 'eye' as const, run: toggleHidden }] : []),
      { key: 'edit', label: 'Edit', icon: 'wrench', run: edit },
      { key: 'more', label: 'More', icon: 'more', run: () => setMode('main'), more: true },
    ]
    const { items: spots } = radialLayout(items.length, { x: 0, y: 0, width: 0, height: 0, pad: { left: 0, top: 0, right: 0, bottom: 0 } })
    return (
      <div ref={ref} className="ctx-radial" role="menu" aria-label={`${token.name} actions`} style={style} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
        <span className="ctx-radial-name" aria-hidden="true">{token.name}</span>
        {items.map((it, i) => (
          <button key={it.key} type="button" role="menuitem" aria-haspopup={it.more ? 'menu' : undefined} className="ctx-radial-item"
            style={{ '--rx': `${spots[i]!.x}px`, '--ry': `${spots[i]!.y}px`, '--i': i } as CSSProperties} onClick={it.run}>
            {it.icon ? <Icon name={it.icon} className="ctx-radial-icon" /> : <span className="ctx-radial-text" aria-hidden="true">{it.text}</span>}
            <span className="ctx-radial-label">{it.label}</span>
          </button>
        ))}
        <button type="button" className="ctx-radial-close" aria-label="Close menu" onClick={onClose}><Icon name="close" /></button>
      </div>
    )
  }

  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label={`${token.name} actions`} style={style} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
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
            GM{(!token.owner || token.owner === controller.pubkey) && <span className="ctx-sub"><Icon name="check" size={14} label="current owner" /></span>}
          </button>
          {players.map((p) => (
            <button key={p.pubkey} type="button" role="menuitem" className="ctx-row" aria-checked={token.owner === p.pubkey} onClick={() => assign(p.pubkey)}>
              <span className="dot" style={{ background: p.color }} />{p.name}{token.owner === p.pubkey && <span className="ctx-sub"><Icon name="check" size={14} label="current owner" /></span>}
            </button>
          ))}
          {offlineOwner && <div className="ctx-head">{offlineOwner.slice(0, 8)} (offline) <Icon name="check" size={14} label="current owner" /></div>}
          {players.length === 0 && <div className="ctx-head">No players present</div>}
        </>
      )}
    </div>
  )
}

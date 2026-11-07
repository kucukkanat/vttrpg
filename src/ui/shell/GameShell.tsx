/**
 * The game screen's layout. One tree for all breakpoints: the top bar, the table and the
 * chrome slots are always at the same positions, so crossing a breakpoint re-arranges CSS grid
 * areas without remounting the 3D canvas. See docs/UX.md.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useGame } from '@/state/store'
import type { AssetRef } from '@/core/assets'
import { sharedAudioEngine } from '@/audio'
import type { GameController } from '../controller'
import { PANELS, type PanelDef } from '../panels/registry'
import { TopBar } from '../panels/TopBar'
import { useSkillTargeting } from '../panels/SkillsPanel'
import { ClaimPrompt, PresenceBeacon } from '../panels/ClaimPrompt'
import { useBreakpoint } from './useBreakpoint'
import { usePersisted } from './usePersisted'
import { useKeyboardInset } from './useKeyboardInset'
import { useUnread, useUnreadNotes } from './useUnread'
import { focusChatInput, useShortcuts } from './useShortcuts'
import { BottomSheet, type SheetSize } from './BottomSheet'
import { TabBar } from './TabBar'
import { MoreList } from './MoreList'
import { MORE_ID, nextPhoneTab, splitPhoneTabs } from './phoneTabs'
import { Drawer } from './Drawer'
import { SideColumn, RAIL_W, DESKTOP_DEFAULT, DESKTOP_LAYOUT_VERSION, migrateDesktopLayout, type DesktopLayout } from './SideColumn'
import { CameraPill, RollToast, SelectedTokenChip } from './Hud'
import { Dock } from './Dock'
import { useGameAlerts } from './useGameAlerts'
import { GameNotices } from './GameNotices'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { GmCallout } from '../onboarding/GmCallout'
import { DEFAULT_PRESET, isDisplayPreset, isPresetId, presetBreakpoint, presetLayouts, type LayoutPresetId, type TabletLayout } from './layoutPresets'
import { RestoreChrome, ViewMenu, useZenKeys } from './ViewMenu'
import { Cues } from '../cues'
import { downloadBlob, exportGame } from '../gameFile'
import { pushToast } from '../toasts'
import { OnboardingTips } from '../onboarding/OnboardingTips'
import { Icon } from '@/ui/icons'
import { usePackTheme } from '../theme/theme'
import { canSeeRoll } from '../rollMode'

// The 3D stack (three, fiber, drei, rapier, the draco and basis loaders) is loaded on first use, so
// the shell's chrome renders before it downloads. Both are module-level so the components keep
// their identity across renders and the canvas is never remounted by a breakpoint change.
const TableCanvas = lazy(() => import('@/table/TableCanvas').then((m) => ({ default: m.TableCanvas })))
const DiceTrayOverlay = lazy(() => import('@/dice/DiceTrayOverlay').then((m) => ({ default: m.DiceTrayOverlay })))

function TableLoading() {
  return (
    <div className="empty">
      <div><p className="muted">Loading table…</p></div>
    </div>
  )
}

const TABLET_DEFAULT: TabletLayout = { tab: 'chat', open: true, pinned: true }
const DRAWER_W = 360

export function GameShell({ controller }: { controller: GameController }) {
  const deviceBp = useBreakpoint()
  // Layout preset per device (layoutPresets.ts): Compact uses the phone arrangement at any width.
  const [view, setView] = usePersisted<{ preset: LayoutPresetId }>('vtt.shell.preset', { preset: DEFAULT_PRESET })
  const preset = isPresetId(view.preset) ? view.preset : DEFAULT_PRESET
  const bp = presetBreakpoint(preset, deviceBp)
  const display = isDisplayPreset(preset)
  // Zen: every bit of chrome hidden over the table for this session; Z, Esc or the corner button restores.
  const [zen, setZen] = useState(false)
  useZenKeys(zen, setZen)
  const isGm = controller.connection.isGm
  const panels = useMemo(() => PANELS.filter((p) => p.scope === 'all' || isGm), [isGm])
  const phoneTabs = useMemo(() => splitPhoneTabs(panels, isGm), [panels, isGm])
  const meta = useGame((s) => s.meta)
  const chat = useGame((s) => s.chat)
  const presence = useGame((s) => s.presence)
  const targeting = useSkillTargeting(controller)
  usePackTheme(controller.rules?.pack.manifest.theme)
  const keyboard = useKeyboardInset()

  // Layout state per breakpoint. Phone tab is session-only (a panel id, or MORE_ID while the More
  // list is showing); tablet and desktop persist.
  const [phoneTab, setPhoneTab] = useState<string | null>(null)
  const [sheetSize, setSheetSize] = useState<SheetSize>('half')
  const [tablet, setTablet] = usePersisted<TabletLayout>('vtt.shell.tablet', TABLET_DEFAULT)
  const [desktop, setDesktop] = usePersisted<DesktopLayout>('vtt.shell.desktop', DESKTOP_DEFAULT, { version: DESKTOP_LAYOUT_VERSION, migrate: migrateDesktopLayout })

  const byId = (id: string | null): PanelDef | undefined => panels.find((p) => p.id === id)
  const phonePanel = byId(phoneTab)
  const phoneMore = phoneTab === MORE_ID
  // Last panel opened from the More list, so the list can mark it when reopened.
  const [lastMore, setLastMore] = useState<string | null>(null)
  useEffect(() => { if (phoneTab && phoneTabs.more.some((p) => p.id === phoneTab)) setLastMore(phoneTab) }, [phoneTab, phoneTabs])
  const tabletTab = byId(tablet.tab) ? tablet.tab : (panels[0]?.id ?? 'chat')

  // Open a panel wherever the current layout keeps it.
  const openPanel = useCallback((id: string) => {
    if (bp === 'phone') { setPhoneTab(id); setSheetSize('half') }
    else if (bp === 'tablet') setTablet((t) => ({ ...t, tab: id, open: true }))
    else {
      const def = PANELS.find((p) => p.id === id)
      setDesktop((d) => ({
        ...d,
        [def?.side ?? 'right']: { ...d[def?.side ?? 'right'], open: true },
        collapsed: { ...d.collapsed, [id]: false },
      }))
    }
  }, [bp, setTablet, setDesktop])

  // Unread chat: messages appended while the chat panel is not on screen.
  const chatOpen = bp === 'phone' ? phoneTab === 'chat'
    : bp === 'tablet' ? tablet.open && tabletTab === 'chat'
    : desktop.right.open && !desktop.collapsed.chat
  const unread = useUnread(chat.length, chatOpen)
  const journalUnread = useUnreadNotes(controller, bp === 'phone' ? phoneTab === 'journal' : bp === 'tablet' ? tablet.open && tabletTab === 'journal' : desktop.right.open && !desktop.collapsed.journal)
  const journalOpen = bp === 'phone' ? phoneTab === 'journal' : bp === 'tablet' ? tablet.open && tabletTab === 'journal' : desktop.right.open && !desktop.collapsed.journal
  useGameAlerts(controller, { chat: chatOpen, journal: journalOpen }, openPanel)
  const badges = useMemo(() => ({ chat: unread, journal: journalUnread }), [unread, journalUnread])

  // Aiming a skill on a phone needs the whole table: drop the sheet, the table's own bar has Cancel.
  useEffect(() => { if (bp === 'phone' && targeting) setPhoneTab(null) }, [bp, targeting])

  // Dice: animate the most recent roll once; clear the tray a few seconds after it settles.
  const [shownRoll, setShownRoll] = useState<string | null>(null)
  // Hidden rolls (GM only, blind) neither animate nor toast for those who may not read them.
  const lastRoll = useMemo(() => [...chat].reverse().find((m) => m.kind === 'roll' && m.roll?.dice.length && canSeeRoll(m, controller.pubkey, controller.connection.gm)) ?? null, [chat, controller])
  useEffect(() => { if (lastRoll?.roll && lastRoll.at > Date.now() - 15_000) setShownRoll(lastRoll.roll.seed) }, [lastRoll])
  const dice = shownRoll ? (
    <Suspense fallback={null}>
      <DiceTrayOverlay rollId={shownRoll} dice={lastRoll?.roll?.dice ?? []} showRim={false} floor="shadow" onSettled={() => setTimeout(() => setShownRoll(null), 4000)} onImpact={(strength) => sharedAudioEngine({ resolve: (ref) => controller.assets.resolve(ref) }).diceImpact(strength)} />
    </Suspense>
  ) : null

  const resolveAsset = useCallback((ref: AssetRef) => controller.assets.resolve(ref), [controller])
  const viewer = useMemo(() => ({ pubkey: controller.pubkey, isGm }), [controller.pubkey, isGm])
  const who = useCallback((pk: string) => presence[pk]?.name ?? (pk === controller.connection.gm ? 'GM' : pk.slice(0, 6)), [presence, controller])

  // Desktop shortcuts.
  const shortcuts = useMemo(() => ({
    toggleLeft: () => setDesktop((d) => ({ ...d, left: { ...d.left, open: !d.left.open } })),
    toggleRight: () => setDesktop((d) => ({ ...d, right: { ...d.right, open: !d.right.open } })),
    focusChat: () => { openPanel('chat'); requestAnimationFrame(() => focusChatInput()) },
    openPanel,
    togglePanel: (n: number) => {
      const def = panels[n - 1]
      if (def) setDesktop((d) => ({ ...d, collapsed: { ...d.collapsed, [def.id]: !d.collapsed[def.id] } }))
    },
  }), [panels, openPanel, setDesktop])
  useShortcuts(bp === 'desktop', shortcuts)

  const style = {
    '--kb': `${keyboard}px`,
    '--left-w': `${desktop.left.open ? desktop.left.width : RAIL_W}px`,
    '--right-w': `${desktop.right.open ? desktop.right.width : RAIL_W}px`,
    '--drawer-w': `${tablet.open && tablet.pinned ? DRAWER_W : 0}px`,
  } as CSSProperties
  const exportFile = async () => {
    pushToast({ key: 'export', text: 'Exporting the game…', ttl: 0 })
    try {
      const { blob, name, missing } = await exportGame(controller.connection.doc, controller.assets)
      downloadBlob(blob, name)
      pushToast({ key: 'export', text: missing ? `Exported ${name}; ${missing} assets could not be included` : `Exported ${name}` })
    } catch (e) {
      pushToast({ key: 'export', text: `Export failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const pickPreset = (id: LayoutPresetId) => {
    const next = presetLayouts(id)
    if (next.desktop) setDesktop(next.desktop)
    if (next.tablet) setTablet(next.tablet)
    setView({ preset: id })
  }
  const cls = ['game', `game--${bp}`, zen ? 'game--zen' : '', display ? 'game--display' : '', keyboard > 0 ? 'kb' : '', bp === 'phone' && (phonePanel || phoneMore) ? `bsheet-${sheetSize}` : ''].filter(Boolean).join(' ')

  const drawerToggle = bp === 'tablet' ? (
    <button type="button" className="icon drawer-toggle" aria-pressed={tablet.open} aria-label={tablet.open ? 'Hide panels' : 'Show panels'} onClick={() => setTablet((t) => ({ ...t, open: !t.open }))}>
      <Icon name="menu" />{!tablet.open && unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
    </button>
  ) : null

  return (
    <div className={cls} style={style}>
      <TopBar controller={controller} compact={bp === 'phone'} trailing={<><ViewMenu isGm={isGm} preset={preset} onPreset={pickPreset} onZen={() => setZen(true)} onExport={isGm ? () => void exportFile() : undefined} />{drawerToggle}</>} />

      {bp === 'desktop' ? (
        <SideColumn side="left" panels={panels.filter((p) => p.side === 'left')} width={desktop.left.width} open={desktop.left.open}
          collapsed={desktop.collapsed} controller={controller}
          onWidth={(w) => setDesktop((d) => ({ ...d, left: { ...d.left, width: w } }))}
          onOpen={(open) => setDesktop((d) => ({ ...d, left: { ...d.left, open } }))}
          onToggleSection={(id) => setDesktop((d) => ({ ...d, collapsed: { ...d.collapsed, [id]: !d.collapsed[id] } }))} />
      ) : null}

      <section className="table">
        {meta?.activeScene ? (
          <Suspense fallback={<TableLoading />}>
            <TableCanvas onIntent={(i) => void controller.dispatch(i)} onPresence={(p) => controller.presence(p)} resolveAsset={resolveAsset} viewer={viewer} targeting={targeting} />
          </Suspense>
        ) : (
          <div className="empty">
            <div>
              <p>No active scene.</p>
              <p className="muted small">{isGm ? 'Add one from the Scenes panel.' : 'Waiting for the GM.'}</p>
              {isGm && <button type="button" onClick={() => openPanel('scenes')}>Open Scenes</button>}
            </div>
          </div>
        )}
        <div className="hud">
          {bp !== 'desktop' && <SelectedTokenChip pubkey={controller.pubkey} onOpen={() => openPanel('character')} />}
          <CameraPill />
          <RollToast roll={lastRoll} who={who} onOpenChat={() => openPanel('chat')} />
        </div>
        {meta?.activeScene && <Dock controller={controller} />}
        <GameNotices controller={controller} onOpenPanel={openPanel} />
        {isGm && <GmCallout />}
        {meta?.activeScene && <OnboardingTips controller={controller} />}
        {bp !== 'phone' ? dice : null}
        {!isGm && <ClaimPrompt controller={controller} />}
        <PresenceBeacon controller={controller} />
        <Cues controller={controller} />
        {zen ? <RestoreChrome label="Show UI" onRestore={() => setZen(false)} />
          : display ? <RestoreChrome label="Exit display" onRestore={() => pickPreset('auto')} /> : null}
      </section>

      {bp === 'desktop' ? (
        <SideColumn side="right" panels={panels.filter((p) => p.side === 'right')} width={desktop.right.width} open={desktop.right.open}
          collapsed={desktop.collapsed} controller={controller}
          onWidth={(w) => setDesktop((d) => ({ ...d, right: { ...d.right, width: w } }))}
          onOpen={(open) => setDesktop((d) => ({ ...d, right: { ...d.right, open } }))}
          onToggleSection={(id) => setDesktop((d) => ({ ...d, collapsed: { ...d.collapsed, [id]: !d.collapsed[id] } }))} />
      ) : null}

      {bp === 'tablet' && tablet.open ? (
        <Drawer panels={panels} active={tabletTab} badges={badges} pinned={tablet.pinned} controller={controller}
          onSelect={(id) => setTablet((t) => ({ ...t, tab: id }))}
          onPin={(pinned) => setTablet((t) => ({ ...t, pinned }))}
          onClose={() => setTablet((t) => ({ ...t, open: false }))} />
      ) : null}

      {bp === 'phone' ? (
        <TabBar tabs={phoneTabs} active={phoneTab} badges={badges}
          onSelect={(id) => { if (id === phoneTab) setPhoneTab(null); else { setPhoneTab(id); setSheetSize('half') } }}
          // More: closes when its list is showing; otherwise shows the list (also from a More panel, to switch).
          onMore={() => { if (phoneMore) setPhoneTab(null); else { setPhoneTab(MORE_ID); setSheetSize('half') } }} />
      ) : null}

      {bp === 'phone' && (phonePanel || phoneMore) ? (
        <BottomSheet key={phoneTab} def={phonePanel} title={phoneMore ? 'More' : undefined} controller={controller} size={sheetSize} keyboard={keyboard}
          onSize={setSheetSize}
          onClose={() => setPhoneTab(null)}
          onSwipeTab={(dir) => setPhoneTab(nextPhoneTab(phoneTab ?? MORE_ID, dir, phoneTabs))}>
          {phoneMore && <MoreList panels={phoneTabs.more} current={lastMore} badges={badges} onSelect={setPhoneTab} />}
        </BottomSheet>
      ) : null}

      {bp === 'phone' && dice ? <div className="dice-layer">{dice}</div> : null}
      <ShortcutsOverlay />
    </div>
  )
}

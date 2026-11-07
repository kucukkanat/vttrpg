/**
 * The game screen: the table layout (docs/UX.md "Table layout"). The board fills the screen and
 * everything else sits on or around it, one home per thing:
 *
 *   top rail      the game's plaque, the live scene, the combat control, who is here, the bell,
 *                 search (Ctrl/⌘-K) and the menu
 *   standees      turn order along the top edge, only in combat
 *   tool rail     camera and table tools on the left edge, and the journal
 *   the hand      the selected token's card and actions, bottom centre
 *   the scroll    chat on the right edge, rolled up or open
 *   dice well     bottom right; dice roll inside it
 *   GM screen     bottom left (GM): Play / Prep / Build
 *   one card      any other panel, one at a time
 *
 * Phones keep the same pieces as a bottom bar and sheets (PhoneBar.tsx). One React tree for every
 * width, so the 3D canvas never remounts when the layout changes.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useGame } from '@/state/store'
import { useTableUi } from '@/table/tableState'
import type { AssetRef } from '@/core/assets'
import { sharedAudioEngine } from '@/audio'
import type { GameController } from '../controller'
import { PANELS } from '../panels/registry'
import { TopBar, requestInvite } from '../panels/TopBar'
import { useSkillTargeting } from '../panels/SkillsPanel'
import { ClaimPrompt, PresenceBeacon } from '../panels/ClaimPrompt'
import { InitiativeChip } from '../panels/InitiativePanel'
import { usePlaying } from '../panels/soundboard'
import { useBreakpoint } from './useBreakpoint'
import { usePersisted } from './usePersisted'
import { useKeyboardInset } from './useKeyboardInset'
import { useUnread, useUnreadNotes } from './useUnread'
import { focusChatInput, useShortcuts } from './useShortcuts'
import { CameraPill, HudLayers } from './Hud'
import { Dock } from './Dock'
import { useGameAlerts } from './useGameAlerts'
import { GameNotices } from './GameNotices'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { GmCallout } from '../onboarding/GmCallout'
import { DEFAULT_PRESET, isDisplayPreset, isPresetId, presetBreakpoint, type LayoutPresetId } from './layoutPresets'
import { RestoreChrome, ViewMenu, useZenKeys } from './ViewMenu'
import { panelShown, useTableLayout } from './tableLayout'
import { Bell, CardHost, CombatControl, DiceWell, GmScreen, JournalBook, PresenceRow, Scroll } from './TableChrome'
import { CommandPalette, type PaletteActions } from './CommandPalette'
import { PhoneBar, PhoneSheets } from './PhoneBar'
import { Cues } from '../cues'
import { downloadBlob, exportGame } from '../gameFile'
import { pushToast } from '../toasts'
import { OnboardingTips } from '../onboarding/OnboardingTips'
import { Icon } from '@/ui/icons'
import { usePackTheme } from '../theme/theme'
import { canSeeRoll } from '../rollMode'
import './Table.css'

// The 3D stack (three, fiber, drei, rapier, the draco and basis loaders) is loaded on first use, so
// the shell's chrome renders before it downloads. Both are module-level so the components keep
// their identity across renders and the canvas is never remounted by a layout change.
const TableCanvas = lazy(() => import('@/table/TableCanvas').then((m) => ({ default: m.TableCanvas })))
const DiceTrayOverlay = lazy(() => import('@/dice/DiceTrayOverlay').then((m) => ({ default: m.DiceTrayOverlay })))

/** Dice in the well: a camera close over a small tray, so a die reads at the well's size. */
const WELL_ZOOM = 2.4
const PHONE_WELL_ZOOM = 2

function TableLoading() {
  return (
    <div className="empty">
      <div><p className="muted">Loading table…</p></div>
    </div>
  )
}

export function GameShell({ controller }: { controller: GameController }) {
  const deviceBp = useBreakpoint()
  const [view, setView] = usePersisted<{ preset: LayoutPresetId }>('vtt.shell.preset', { preset: DEFAULT_PRESET })
  const preset = isPresetId(view.preset) ? view.preset : DEFAULT_PRESET
  const bp = presetBreakpoint(preset, deviceBp)
  const phone = bp === 'phone'
  const display = isDisplayPreset(preset)
  // Zen: every bit of chrome hidden over the table for this session; Z, Esc or the corner button restores.
  const [zen, setZen] = useState(false)
  useZenKeys(zen, setZen)
  const isGm = controller.connection.isGm
  const panels = useMemo(() => PANELS.filter((p) => p.scope === 'all' || isGm), [isGm])
  const meta = useGame((s) => s.meta)
  const chat = useGame((s) => s.chat)
  const presence = useGame((s) => s.presence)
  const combat = useGame((s) => s.initiative?.active ? s.initiative : null)
  const targeting = useSkillTargeting(controller)
  usePackTheme(controller.rules?.pack.manifest.theme)
  const keyboard = useKeyboardInset()
  const layout = useTableLayout()
  const mode = isGm ? layout.mode : 'play'

  // The scroll starts rolled up (the rod shows unread messages); per device after the first toggle.
  const [scrollPref, setScrollPref] = usePersisted<{ open: boolean | null }>('vtt.shell.scroll', { open: null })
  useEffect(() => {
    useTableLayout.getState().set({ scrollOpen: !phone && (scrollPref.open ?? false) })
    // Only on mount and when the device class changes; later toggles are the user's.
  }, [bp]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!phone) setScrollPref({ open: layout.scrollOpen }) }, [layout.scrollOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  // The table needs to know about Build: the prop gizmo, power keys and box select live there.
  useEffect(() => {
    useTableUi.getState().set({ buildMode: mode === 'build' })
    return () => useTableUi.getState().set({ buildMode: false })
  }, [mode])
  // Players have no Prep or Build; a GM demoted mid-session drops back to Play.
  useEffect(() => { if (!isGm && layout.mode !== 'play') layout.set({ mode: 'play' }) }, [isGm, layout])

  const openPanel = useCallback((id: string) => useTableLayout.getState().open(id, isGm, phone), [isGm, phone])

  const chatOpen = layout.scrollOpen
  const journalOpen = panelShown(layout, 'journal', isGm, phone)
  const unread = useUnread(chat.length, chatOpen)
  const journalUnread = useUnreadNotes(controller, journalOpen)
  useGameAlerts(controller, { chat: chatOpen, journal: journalOpen }, openPanel)

  // Aiming a skill on a phone needs the whole table: drop the sheets, the table's own bar has Cancel.
  useEffect(() => { if (phone && targeting) useTableLayout.getState().set({ card: null, scrollOpen: false, phone: null }) }, [phone, targeting])

  // Dice: animate the most recent roll once, in the well; clear it a few seconds after it settles.
  const [shownRoll, setShownRoll] = useState<string | null>(null)
  // Hidden rolls (GM only, blind) neither animate nor read out for those who may not read them.
  const lastRoll = useMemo(() => [...chat].reverse().find((m) => m.kind === 'roll' && m.roll?.dice.length && canSeeRoll(m, controller.pubkey, controller.connection.gm)) ?? null, [chat, controller])
  useEffect(() => { if (lastRoll?.roll && lastRoll.at > Date.now() - 15_000) setShownRoll(lastRoll.roll.seed) }, [lastRoll])
  const dice = shownRoll ? (
    <Suspense fallback={null}>
      <DiceTrayOverlay rollId={shownRoll} dice={lastRoll?.roll?.dice ?? []} showRim={false} floor="shadow" zoom={phone ? PHONE_WELL_ZOOM : WELL_ZOOM} fill={0.86}
        onSettled={() => setTimeout(() => setShownRoll(null), 4000)}
        onImpact={(strength) => sharedAudioEngine({ resolve: (ref) => controller.assets.resolve(ref) }).diceImpact(strength)} />
    </Suspense>
  ) : null

  const resolveAsset = useCallback((ref: AssetRef) => controller.assets.resolve(ref), [controller])
  const viewer = useMemo(() => ({ pubkey: controller.pubkey, isGm }), [controller.pubkey, isGm])
  const who = useCallback((pk: string) => presence[pk]?.name ?? (pk === controller.connection.gm ? 'GM' : pk.slice(0, 6)), [presence, controller])
  const engine = useMemo(() => (isGm ? sharedAudioEngine({ resolve: (ref) => controller.assets.resolve(ref) }) : null), [isGm, controller])
  const playing = usePlaying(engine)

  // Keyboard: [ puts the card away, ] rolls the scroll, 1–9 open the n-th panel, / writes in the scroll.
  const shortcuts = useMemo(() => ({
    toggleLeft: () => useTableLayout.getState().set({ card: null }),
    toggleRight: () => useTableLayout.getState().set({ scrollOpen: !useTableLayout.getState().scrollOpen }),
    focusChat: () => { openPanel('chat'); requestAnimationFrame(() => focusChatInput()) },
    openPanel,
    togglePanel: (n: number) => {
      const def = panels[n - 1]
      if (!def) return
      const s = useTableLayout.getState()
      if (s.card === def.id) s.set({ card: null })
      else openPanel(def.id)
    },
  }), [panels, openPanel])
  useShortcuts(!phone, shortcuts)

  const exportFile = useCallback(async () => {
    pushToast({ key: 'export', text: 'Exporting the game…', ttl: 0 })
    try {
      const { blob, name, missing } = await exportGame(controller.connection.doc, controller.assets)
      downloadBlob(blob, name)
      pushToast({ key: 'export', text: missing ? `Exported ${name}; ${missing} assets could not be included` : `Exported ${name}` })
    } catch (e) {
      pushToast({ key: 'export', text: `Export failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }, [controller])
  const leave = useCallback(() => { controller.dispose(); window.location.hash = '/' }, [controller])
  const pickPreset = useCallback((id: LayoutPresetId) => setView({ preset: id }), [setView])
  const actions = useMemo<PaletteActions>(() => ({
    openPanel,
    zen: () => setZen(true),
    display: () => pickPreset('display'),
    compact: (on) => pickPreset(on ? 'compact' : 'auto'),
    exportGame: isGm ? () => void exportFile() : undefined,
    leave,
  }), [openPanel, pickPreset, isGm, exportFile, leave])

  const liveLine = [
    playing.size ? `${playing.size} ${playing.size === 1 ? 'sound' : 'sounds'} playing` : '',
    combat ? `round ${combat.round}` : '',
  ].filter(Boolean).join(' · ')

  const style = { '--kb': `${keyboard}px` } as CSSProperties
  const cls = ['game', 'game--table', `game--${bp}`, `game--mode-${mode}`, isGm ? 'game--gm' : '', zen ? 'game--zen' : '', display ? 'game--display' : '', keyboard > 0 ? 'kb' : ''].filter(Boolean).join(' ')
  const chrome = !zen && !display

  const trailing = (
    <>
      {!phone && <PresenceRow me={controller.pubkey} onOpen={() => openPanel('players')} />}
      <Bell compact={phone} />
      <button type="button" className="t-search" onClick={() => layout.set({ palette: true })} aria-label="Search everything" title="Search everything (Ctrl/⌘-K)">
        <Icon name="search" />
        {!phone && <><span className="t-search-word">Search</span><kbd className="key-hint">⌘K</kbd></>}
      </button>
      <ViewMenu preset={preset} onPreset={pickPreset} onZen={() => setZen(true)} onExport={isGm ? () => void exportFile() : undefined}
        onInvite={phone && isGm ? requestInvite : undefined} onLeave={leave} />
    </>
  )

  return (
    <div className={cls} style={style}>
      <TopBar controller={controller} compact={phone} center={<CombatControl controller={controller} />} trailing={trailing}
        onScene={() => layout.set({ card: 'scenes' })} />

      <section className="table">
        {meta?.activeScene ? (
          <Suspense fallback={<TableLoading />}>
            <TableCanvas onIntent={(i) => void controller.dispatch(i)} onPresence={(p) => controller.presence(p)} resolveAsset={resolveAsset} viewer={viewer} targeting={targeting} />
          </Suspense>
        ) : (
          <div className="empty">
            <div>
              <p>No active scene.</p>
              <p className="muted small">{isGm ? 'Raise the GM screen (Prep) and add one.' : 'Waiting for the GM.'}</p>
              {isGm && <button type="button" onClick={() => openPanel('scenes')}>Open Scenes</button>}
            </div>
          </div>
        )}
        <div className="hud">
          <div className="t-standees"><InitiativeChip /></div>
          {!phone && (
            <div className="t-rail" role="group" aria-label="Table tools">
              <CameraPill />
              <JournalBook unread={journalUnread} onOpen={() => openPanel('journal')} />
            </div>
          )}
          <HudLayers />
        </div>
        {meta?.activeScene && <Dock controller={controller} />}
        {!phone && <CardHost controller={controller} panels={panels} />}
        {!phone && <Scroll controller={controller} chat={panels.find((p) => p.id === 'chat')} unread={unread} />}
        {!phone && isGm && <GmScreen controller={controller} panels={panels} live={liveLine} onLive={() => openPanel('sound')} />}
        <DiceWell dice={dice} roll={lastRoll} who={who} compact={phone} />
        <GameNotices controller={controller} onOpenPanel={openPanel} />
        {isGm && <GmCallout />}
        {meta?.activeScene && <OnboardingTips controller={controller} />}
        {!isGm && <ClaimPrompt controller={controller} />}
        <PresenceBeacon controller={controller} />
        <Cues controller={controller} />
        {zen ? <RestoreChrome label="Show UI" onRestore={() => setZen(false)} />
          : display ? <RestoreChrome label="Exit display" onRestore={() => pickPreset('auto')} /> : null}
      </section>

      {phone && chrome && <PhoneSheets controller={controller} panels={panels} keyboard={keyboard} />}
      {phone && chrome && <PhoneBar isGm={isGm} unread={unread} journalUnread={journalUnread} />}
      {chrome && <CommandPalette controller={controller} panels={panels} actions={actions} />}
      <ShortcutsOverlay />
    </div>
  )
}

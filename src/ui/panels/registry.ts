/**
 * Panels the game screen can show. The shell decides placement (side columns on desktop,
 * bottom tab bar + sheets on phones). Add a panel here and it appears everywhere.
 */
import { createElement, lazy, Suspense, type ComponentType } from 'react'
import type { GameController } from '../controller'
import { ScenesPanel } from './ScenesPanel'
import { TokensPanel } from './TokensPanel'
import { PlayersPanel } from './PlayersPanel'
import { CharacterPanel } from './CharacterPanel'
import { SkillsPanel } from './SkillsPanel'
import { ChatPanel } from './ChatPanel'
import { ObjectPanel } from './ObjectPanel'
import { SoundboardPanel } from './SoundboardPanel'
import { JournalPanel } from './JournalPanel'

type PanelComponent = ComponentType<{ controller: GameController }>

/**
 * A panel loaded the first time it is shown. GM-only tools (Prep, Skill editor) are kept out of
 * the game chunk this way; players never download them. The wrapper has the panel's shape, so
 * `PANELS` and the hosts need no special case; the fallback is a plain panel body under the
 * host's own header.
 */
function lazyPanel(load: () => Promise<PanelComponent>): PanelComponent {
  const Loaded = lazy(() => load().then((component) => ({ default: component })))
  const fallback = createElement('div', { className: 'panel' }, createElement('p', { className: 'muted small' }, 'Loading…'))
  return function LazyPanel(props) {
    return createElement(Suspense, { fallback }, createElement(Loaded, props))
  }
}

const PrepPanel = lazyPanel(() => import('./PrepPanel').then((m) => m.PrepPanel))
const SkillEditorPanel = lazyPanel(() => import('./SkillEditorPanel').then((m) => m.SkillEditorPanel))

export interface PanelDef {
  id: string
  title: string
  /** Short label for the mobile tab bar. */
  short: string
  /** Simple glyph for the tab bar (emoji or single character); no icon library. */
  glyph: string
  component: ComponentType<{ controller: GameController }>
  /** Who sees it. */
  scope: 'all' | 'gm'
  /** Preferred desktop column. */
  side: 'left' | 'right'
  /** Takes the remaining height when stacked with others (chat); default false. */
  fill?: boolean
  /**
   * Position (1-based) on the phone tab bar. Four panels get a slot; every other visible panel
   * is listed in the fifth "More" tab's sheet, so nothing is unreachable on a narrow screen.
   */
  phoneSlot?: number
}

export const PANELS: PanelDef[] = [
  { id: 'scenes', title: 'Scenes', short: 'Scenes', glyph: '🗺', component: ScenesPanel, scope: 'all', side: 'left', phoneSlot: 1 },
  { id: 'tokens', title: 'Tokens', short: 'Tokens', glyph: '♟', component: TokensPanel, scope: 'all', side: 'left', phoneSlot: 2 },
  { id: 'object', title: 'Edit', short: 'Edit', glyph: '✎', component: ObjectPanel, scope: 'all', side: 'left' },
  { id: 'sound', title: 'Sound', short: 'Sound', glyph: '🔊', component: SoundboardPanel, scope: 'gm', side: 'left' },
  { id: 'players', title: 'Players', short: 'Players', glyph: '👥', component: PlayersPanel, scope: 'all', side: 'left' },
  { id: 'character', title: 'Character', short: 'Sheet', glyph: '📜', component: CharacterPanel, scope: 'all', side: 'right', phoneSlot: 3 },
  { id: 'skills', title: 'Skills', short: 'Skills', glyph: '✦', component: SkillsPanel, scope: 'all', side: 'right' },
  { id: 'chat', title: 'Chat', short: 'Chat', glyph: '💬', component: ChatPanel, scope: 'all', side: 'right', fill: true, phoneSlot: 4 },
  { id: 'journal', title: 'Journal', short: 'Journal', glyph: '📖', component: JournalPanel, scope: 'all', side: 'right' },
  { id: 'prep', title: 'Prep', short: 'Prep', glyph: '🧰', component: PrepPanel, scope: 'gm', side: 'left' },
  { id: 'skills-editor', title: 'Skill editor', short: 'Editor', glyph: '🛠', component: SkillEditorPanel, scope: 'gm', side: 'right' },
]

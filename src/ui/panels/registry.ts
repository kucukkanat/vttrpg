/**
 * Panels the game screen can show. The shell decides placement (side columns on desktop,
 * bottom tab bar + sheets on phones). Add a panel here and it appears everywhere.
 */
import { createElement, lazy, Suspense, type ComponentType } from 'react'
import type { GameController } from '../controller'
import type { IconName } from '../icons'
import { ScenesPanel } from './ScenesPanel'
import { TokensPanel } from './TokensPanel'
import { PlayersPanel } from './PlayersPanel'
import { CharacterPanel } from './CharacterPanel'
import { SkillsPanel } from './SkillsPanel'
import { ChatPanel } from './ChatPanel'
import { SoundboardPanel } from './SoundboardPanel'
import { JournalPanel } from './JournalPanel'
import { InitiativePanel } from './InitiativePanel'

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
  /** Icon (a name from `ui/icons.tsx`) for the tab bar, More list, drawer tabs and column heads. */
  glyph: IconName
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
  /** Same for a player's tab bar, which has no Scenes or Tokens. */
  playerSlot?: number
}

export const PANELS: PanelDef[] = [
  { id: 'scenes', title: 'Scenes', short: 'Scenes', glyph: 'map', component: ScenesPanel, scope: 'all', side: 'left', phoneSlot: 1 },
  { id: 'tokens', title: 'Tokens', short: 'Tokens', glyph: 'pawn', component: TokensPanel, scope: 'all', side: 'left', phoneSlot: 2 },
  { id: 'sound', title: 'Sound', short: 'Sound', glyph: 'sound', component: SoundboardPanel, scope: 'gm', side: 'left' },
  { id: 'players', title: 'Players', short: 'Players', glyph: 'users', component: PlayersPanel, scope: 'all', side: 'left' },
  { id: 'initiative', title: 'Initiative', short: 'Turns', glyph: 'swords', component: InitiativePanel, scope: 'all', side: 'left', playerSlot: 4 },
  { id: 'character', title: 'Character', short: 'Sheet', glyph: 'sheet', component: CharacterPanel, scope: 'all', side: 'right', phoneSlot: 3, playerSlot: 1 },
  { id: 'skills', title: 'Skills', short: 'Skills', glyph: 'spark', component: SkillsPanel, scope: 'all', side: 'right' },
  { id: 'chat', title: 'Chat', short: 'Chat', glyph: 'chat', component: ChatPanel, scope: 'all', side: 'right', fill: true, phoneSlot: 4, playerSlot: 2 },
  { id: 'journal', title: 'Journal', short: 'Journal', glyph: 'book', component: JournalPanel, scope: 'all', side: 'right', playerSlot: 3 },
  { id: 'prep', title: 'Prep', short: 'Prep', glyph: 'toolbox', component: PrepPanel, scope: 'gm', side: 'left' },
  { id: 'skills-editor', title: 'Skill editor', short: 'Editor', glyph: 'wrench', component: SkillEditorPanel, scope: 'gm', side: 'right' },
]

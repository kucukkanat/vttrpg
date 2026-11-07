/**
 * Panels the game screen can show. The shell decides placement (shell/tableLayout.ts `routePanel`:
 * the scroll, the one card, the GM screen's leaves or tray; sheets on phones). Add a panel here and
 * it is reachable everywhere, including the command palette.
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
const BuildPanel = lazyPanel(() => import('./BuildPanel').then((m) => m.BuildPanel))

export interface PanelDef {
  id: string
  title: string
  /** Short label (palette search words, tight spots). */
  short: string
  /** Icon (a name from `ui/icons.tsx`) for card heads, the Tools list and the palette. */
  glyph: IconName
  component: ComponentType<{ controller: GameController }>
  /** Who sees it. */
  scope: 'all' | 'gm'
}

export const PANELS: PanelDef[] = [
  { id: 'scenes', title: 'Scenes', short: 'Scenes', glyph: 'map', component: ScenesPanel, scope: 'all' },
  { id: 'tokens', title: 'Tokens', short: 'Tokens', glyph: 'pawn', component: TokensPanel, scope: 'all' },
  { id: 'sound', title: 'Sound', short: 'Sound', glyph: 'sound', component: SoundboardPanel, scope: 'gm' },
  { id: 'players', title: 'Players', short: 'Players', glyph: 'users', component: PlayersPanel, scope: 'all' },
  { id: 'initiative', title: 'Initiative', short: 'Turns', glyph: 'swords', component: InitiativePanel, scope: 'all' },
  { id: 'character', title: 'Character', short: 'Sheet', glyph: 'sheet', component: CharacterPanel, scope: 'all' },
  { id: 'skills', title: 'Skills', short: 'Skills', glyph: 'spark', component: SkillsPanel, scope: 'all' },
  { id: 'chat', title: 'Chat', short: 'Chat', glyph: 'chat', component: ChatPanel, scope: 'all' },
  { id: 'journal', title: 'Journal', short: 'Journal', glyph: 'book', component: JournalPanel, scope: 'all' },
  { id: 'build', title: 'Build', short: 'Build', glyph: 'wall', component: BuildPanel, scope: 'gm' },
  { id: 'prep', title: 'Prep', short: 'Prep', glyph: 'toolbox', component: PrepPanel, scope: 'gm' },
  { id: 'skills-editor', title: 'Skill editor', short: 'Editor', glyph: 'wrench', component: SkillEditorPanel, scope: 'gm' },
]

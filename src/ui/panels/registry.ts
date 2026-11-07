/**
 * Panels the game screen can show. The shell decides placement (shell/tableLayout.ts `routePanel`:
 * the scroll, the one card, or the Library dock for the GM; sheets on phones). Add a panel here and
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
 * A panel loaded the first time it is shown. GM-only tools (the Library, Skill editor) are kept out of
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

const SkillEditorPanel = lazyPanel(() => import('./SkillEditorPanel').then((m) => m.SkillEditorPanel))
const LibraryPanel = lazyPanel(() => import('../library/LibraryPanel').then((m) => m.LibraryPanel))
const CreditsPanel = lazyPanel(() => import('../library/CreditsPanel').then((m) => m.CreditsPanel))
// Play (GM drawer): the table-time quick tools, and the scene title's switcher.
const RandomTablesPanel = lazyPanel(() => import('../prep/RandomTables').then((m) => m.RandomTablesPanel))
const NpcCard = lazyPanel(() => import('../prep/NpcCard').then((m) => m.NpcCard))
const EncounterRun = lazyPanel(() => import('../prep/EncounterRun').then((m) => m.EncounterRun))
const SceneSwitcher = lazyPanel(() => import('./SceneSwitcher').then((m) => m.SceneSwitcher))

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
  { id: 'library', title: 'Library', short: 'Models', glyph: 'cube', component: LibraryPanel, scope: 'gm' },
  { id: 'credits', title: 'Credits', short: 'Credits', glyph: 'ribbon', component: CreditsPanel, scope: 'all' },
  { id: 'skills-editor', title: 'Skill editor', short: 'Editor', glyph: 'wrench', component: SkillEditorPanel, scope: 'gm' },
  { id: 'tables', title: 'Random tables', short: 'Tables', glyph: 'dice', component: RandomTablesPanel, scope: 'gm' },
  { id: 'npc', title: 'NPC', short: 'NPC', glyph: 'pawn', component: NpcCard, scope: 'gm' },
  { id: 'encounters', title: 'Encounters', short: 'Encounters', glyph: 'swords', component: EncounterRun, scope: 'gm' },
  { id: 'scene-switcher', title: 'Scene', short: 'Scene: switch, add, settings', glyph: 'map', component: SceneSwitcher, scope: 'gm' },
]

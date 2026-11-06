/**
 * Panels the game screen can show. The shell decides placement (side columns on desktop,
 * bottom tab bar + sheets on phones). Add a panel here and it appears everywhere.
 */
import type { ComponentType } from 'react'
import type { GameController } from '../controller'
import { ScenesPanel } from './ScenesPanel'
import { TokensPanel } from './TokensPanel'
import { PlayersPanel } from './PlayersPanel'
import { CharacterPanel } from './CharacterPanel'
import { SkillsPanel } from './SkillsPanel'
import { ChatPanel } from './ChatPanel'
import { ObjectPanel } from './ObjectPanel'
import { SoundboardPanel } from './SoundboardPanel'
import { SkillEditorPanel } from './SkillEditorPanel'

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
}

export const PANELS: PanelDef[] = [
  { id: 'scenes', title: 'Scenes', short: 'Scenes', glyph: '🗺', component: ScenesPanel, scope: 'all', side: 'left' },
  { id: 'tokens', title: 'Tokens', short: 'Tokens', glyph: '♟', component: TokensPanel, scope: 'all', side: 'left' },
  { id: 'object', title: 'Edit', short: 'Edit', glyph: '✎', component: ObjectPanel, scope: 'all', side: 'left' },
  { id: 'sound', title: 'Sound', short: 'Sound', glyph: '🔊', component: SoundboardPanel, scope: 'gm', side: 'left' },
  { id: 'players', title: 'Players', short: 'Players', glyph: '👥', component: PlayersPanel, scope: 'all', side: 'left' },
  { id: 'character', title: 'Character', short: 'Sheet', glyph: '📜', component: CharacterPanel, scope: 'all', side: 'right' },
  { id: 'skills', title: 'Skills', short: 'Skills', glyph: '✦', component: SkillsPanel, scope: 'all', side: 'right' },
  { id: 'chat', title: 'Chat', short: 'Chat', glyph: '💬', component: ChatPanel, scope: 'all', side: 'right', fill: true },
  { id: 'skills-editor', title: 'Skill editor', short: 'Editor', glyph: '🛠', component: SkillEditorPanel, scope: 'gm', side: 'right' },
]

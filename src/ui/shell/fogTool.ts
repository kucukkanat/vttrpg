/**
 * The fog brush on the Play tool rail (GM): the same build fog tools as Build's (`fog-reveal`,
 * `fog-hide`, the brush size in `useBuildUi`), offered on the rail while the GM plays. Build has
 * its own fog tool, so the rail leaves it out there; players never get it.
 */
import type { BuildTool } from '@/table/build/buildState'
import type { TableMode } from './tableLayout'

export function fogToolAvailable(isGm: boolean, mode: TableMode): boolean {
  return isGm && mode === 'play'
}

export const isFogTool = (tool: BuildTool | null): tool is 'fog-reveal' | 'fog-hide' => tool === 'fog-reveal' || tool === 'fog-hide'

/** The rail button's title for the brush state. */
export function fogButtonTitle(tool: BuildTool | null): string {
  if (tool === 'fog-reveal') return 'Fog brush: revealing (Esc puts it away)'
  if (tool === 'fog-hide') return 'Fog brush: hiding (Esc puts it away)'
  return 'Fog of war: reveal or hide with a brush'
}

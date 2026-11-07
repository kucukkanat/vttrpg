/**
 * The fog brush on the tool rail (GM): the build fog tools (`fog-reveal`, `fog-hide`, the brush
 * size in `useBuildUi`). Players never get it.
 */
import type { BuildTool } from '@/table/build/buildState'

export function fogToolAvailable(isGm: boolean): boolean {
  return isGm
}

export const isFogTool = (tool: BuildTool | null): tool is 'fog-reveal' | 'fog-hide' => tool === 'fog-reveal' || tool === 'fog-hide'

/** The rail button's title for the brush state. */
export function fogButtonTitle(tool: BuildTool | null): string {
  if (tool === 'fog-reveal') return 'Fog brush: revealing (Esc puts it away)'
  if (tool === 'fog-hide') return 'Fog brush: hiding (Esc puts it away)'
  return 'Fog of war: reveal or hide with a brush'
}

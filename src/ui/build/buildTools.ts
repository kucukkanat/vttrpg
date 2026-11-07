/**
 * The Build tool strip's model: five tools over the existing build tool state
 * (`table/build/buildState.ts`, `table/kits/kitState.ts`), so the board's own layers keep working
 * unchanged and the prop keys and box select stand down while a tool is out, as before.
 *
 *   Select  V  no tool: click, box or shift-select, the gizmo and the prop keys
 *   Paint   P  a grid kit tool (floors, walls, doors…); tablet and desktop only
 *   Walls   W  drawn walls, doors and the eraser
 *   Light   L  tap to place a light
 *   Fog     B  the fog brush, revealing or hiding (F stays first person, G the grid)
 */
import { useBuildUi, type BuildTool } from '@/table/build/buildState'
import { useKitUi, type KitTool } from '@/table/kits/kitState'
import type { IconName } from '../icons'

export type StripTool = 'select' | 'paint' | 'walls' | 'light' | 'fog'

export interface StripToolDef {
  id: StripTool
  label: string
  key: string
  icon: IconName
  title: string
  /** Not offered on phones (kit painting needs a tablet or a desktop). */
  wide?: boolean
}

export const STRIP_TOOLS: readonly StripToolDef[] = [
  { id: 'select', label: 'Select', key: 'V', icon: 'select', title: 'Select: click, box or Shift-select props and tokens' },
  { id: 'paint', label: 'Paint', key: 'P', icon: 'grid', title: 'Paint grid kit pieces: floors, walls, doors, stairs, roofs', wide: true },
  { id: 'walls', label: 'Walls', key: 'W', icon: 'wall', title: 'Draw walls and doors for line of sight' },
  { id: 'light', label: 'Light', key: 'L', icon: 'spark', title: 'Place lights' },
  { id: 'fog', label: 'Fog', key: 'B', icon: 'eye', title: 'Fog brush: reveal or hide cells' },
]

/** Which strip tool a build tool belongs to. Holding a model, the eyedropper and prefab stamps are Select (they come from the Library). */
export function stripToolOf(tool: BuildTool | null): StripTool {
  switch (tool) {
    case 'kit': return 'paint'
    case 'wall': case 'door': case 'erase': return 'walls'
    case 'light': return 'light'
    case 'fog-reveal': case 'fog-hide': return 'fog'
    default: return 'select'
  }
}

/** The last sub-tool used per strip tool, so Walls comes back as Door when Door was out last. */
const last: { walls: BuildTool; fog: BuildTool; paint: KitTool } = { walls: 'wall', fog: 'fog-reveal', paint: 'floor' }

/** Remember sub-tools as they change, whoever changes them (the options pane, the palette). */
useBuildUi.subscribe((s) => {
  const t = stripToolOf(s.tool)
  if (t === 'walls' && s.tool) last.walls = s.tool
  if (t === 'fog' && s.tool) last.fog = s.tool
})
useKitUi.subscribe((s) => { if (s.tool) last.paint = s.tool })

/** Take a strip tool out. The active one again goes back to Select. */
export function pickStripTool(id: StripTool): void {
  const build = useBuildUi.getState()
  const kit = useKitUi.getState()
  const current = stripToolOf(build.tool)
  const next = current === id ? 'select' : id
  if (next !== 'paint' && kit.tool) kit.set({ tool: null })
  switch (next) {
    case 'select': build.set({ tool: null }); break
    case 'paint': kit.set({ tool: last.paint }); build.set({ tool: 'kit' }); break
    case 'walls': build.set({ tool: last.walls }); break
    case 'light': build.set({ tool: 'light' }); break
    case 'fog': build.set({ tool: last.fog }); break
  }
}

interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }

/** The strip tool a key press picks, or null. Plain letters only; Cmd/Ctrl+V stays paste. */
export function stripToolForKey(e: KeyLike, phone = false): StripTool | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null
  const k = e.key.length === 1 ? e.key.toUpperCase() : ''
  const def = STRIP_TOOLS.find((t) => t.key === k)
  if (!def || (phone && def.wide)) return null
  return def.id
}

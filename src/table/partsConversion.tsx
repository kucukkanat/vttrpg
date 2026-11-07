/**
 * Runs the one-time conversion of the scene on the table (src/core/partsMigration.ts) on a GM
 * client: drawn walls and doors, imported wall segments and placed lights become invisible wall,
 * door and light props. Watches the scene, so anything that still writes the old records (an older
 * client, a saved group from before) is converted too. Renders nothing.
 */
import { useEffect, useRef } from 'react'
import type { SceneId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import { conversionIntents, needsConversion } from '@/core/partsMigration'
import { useGame } from '@/state/store'

/** Wait this long after the last change before converting, so a burst of edits converts once. */
const SETTLE_MS = 400

export function PartsConversion({ sceneId, floorY, onIntent }: { sceneId: SceneId; floorY: number; onIntent(intent: Intent): void }) {
  const pending = useNeeds(sceneId)
  const sent = useRef<string>('')
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => {
      const s = useGame.getState()
      const doc = { scenes: s.scenes, walls: s.walls, lights: s.lights }
      const intents = conversionIntents(doc, sceneId, floorY)
      // The same batch is never sent twice while the first is on its way.
      const key = JSON.stringify(intents.map((i) => (i.type === 'props.convert' ? [i.walls, i.lights, i.sceneWalls, i.props.length] : null)))
      if (!intents.length || key === sent.current) return
      sent.current = key
      for (const i of intents) onIntent(i)
    }, SETTLE_MS)
    return () => clearTimeout(t)
  }, [pending, sceneId, floorY, onIntent])
  return null
}

/** A key that changes whenever the scene's old walls, segments or lights do; '' when there are none. */
function useNeeds(sceneId: SceneId): string {
  return useGame((s) => {
    if (!needsConversion({ scenes: s.scenes, walls: s.walls, lights: s.lights }, sceneId)) return ''
    let n = s.scenes[sceneId]?.walls?.length ?? 0
    let ids = ''
    for (const id in s.walls) if (s.walls[id as keyof typeof s.walls]!.scene === sceneId) { n++; ids += id }
    for (const id in s.lights) if (s.lights[id as keyof typeof s.lights]!.scene === sceneId) { n++; ids += id }
    return `${n}:${ids.length}:${ids.slice(0, 64)}`
  })
}

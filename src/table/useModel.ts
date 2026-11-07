/**
 * Suspense hook over the shared GLB loader (gltf.ts) for props and minis. The renderer is passed
 * so KTX2 textures work. A model over the budget is reported once per asset: a console warning
 * for everyone and a toast for the GM.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { pushToast } from '@/ui/toasts'
import { useTable } from './context'
import { overBudget, readModel, type ModelStats } from './gltf'

const warned = new Set<string>()

/** Reports an over-budget model once per key; returns whether it warned. Exported for tests. */
export function warnOverBudget(key: string, name: string, stats: ModelStats, toGm: boolean, toast = pushToast): boolean {
  if (warned.has(key)) return false
  const reasons = overBudget(stats)
  if (!reasons.length) return false
  warned.add(key)
  console.warn(`[models] ${name} is over the prop budget: ${reasons.join(', ')}`, stats)
  if (toGm) toast({ text: `${name} is heavy (${reasons.join(', ')}) and may slow the table down.`, key: `model-budget:${key}`, ttl: 8000 })
  return true
}

export function useModel(url: string, sha256?: string, name?: string): GLTF {
  const gl = useThree((s) => s.gl)
  const { viewer } = useTable()
  const loaded = readModel(url, sha256 ? { renderer: gl, sha256 } : { renderer: gl })
  const gm = !viewer || viewer.isGm
  useEffect(() => {
    warnOverBudget(sha256 ?? url, name || 'A model', loaded.stats, gm)
  }, [loaded, sha256, url, name, gm])
  return loaded.gltf
}

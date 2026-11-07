import { describe, expect, it } from 'vitest'
import type { Prop } from '@/core/doc'
import type { AssetHash, PropId, SceneId } from '@/core/ids'
import { compact, heaviestModels, idsOf, megabytes, modelUses, readBudget, SCENE_BUDGETS, sceneCost, type ModelCost } from './sceneBudget'

const S = 's1' as SceneId
function prop(id: string, sha: string, scene = S): Prop {
  return {
    id: id as PropId, scene, name: `${sha} model`,
    model: { sha256: sha as AssetHash, kind: 'glb', mime: 'model/gltf-binary', size: 1, sources: [] },
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  }
}
const MB = 1024 * 1024
const stats: Record<string, ModelCost> = {
  barrel: { triangles: 500, textureBytes: 2 * MB },
  statue: { triangles: 40_000, textureBytes: 16 * MB },
  tree: { triangles: 3_000, textureBytes: 4 * MB },
  scene: { triangles: 90_000, textureBytes: 64 * MB },
}
const statsOf = (sha: string) => stats[sha]

const props = Object.fromEntries([
  ...Array.from({ length: 40 }, (_, i) => prop(`b${i}`, 'barrel')),
  prop('st1', 'statue'),
  ...Array.from({ length: 10 }, (_, i) => prop(`t${i}`, 'tree')),
  prop('x', 'unloaded'),
  prop('elsewhere', 'statue', 'other' as SceneId),
].map((p) => [p.id, p]))

describe('scene budget', () => {
  it('groups the scene props by model', () => {
    const uses = modelUses(props, S)
    expect(uses.map((u) => [u.sha256, u.ids.length])).toEqual([['barrel', 40], ['statue', 1], ['tree', 10], ['unloaded', 1]])
    expect(modelUses(props, null)).toEqual([])
  })

  it('counts each distinct model\'s textures once, the scene model too', () => {
    const cost = sceneCost(modelUses(props, S), statsOf, { triangles: 120_000, calls: 80 }, ['scene', 'barrel'])
    expect(cost).toEqual({ triangles: 120_000, drawCalls: 80, textureBytes: (2 + 16 + 4 + 64) * MB })
  })

  it('reads against the tier and flags what is over the low tier', () => {
    const fine = readBudget({ triangles: 100_000, drawCalls: 50, textureBytes: 32 * MB }, 'high')
    expect(fine.overLow).toEqual([])
    expect(fine.fraction).toBeCloseTo(50 / SCENE_BUDGETS.high.drawCalls)
    const heavy = readBudget({ triangles: 400_000, drawCalls: 200, textureBytes: 32 * MB }, 'high')
    expect(heavy.overLow).toEqual(['triangles', 'drawCalls'])
    expect(heavy.overTier).toEqual([])
    expect(readBudget({ triangles: 400_000, drawCalls: 200, textureBytes: 32 * MB }, 'low').fraction).toBeCloseTo(1.6)
  })

  it('ranks the heaviest models by triangles over every copy, skipping unmeasured ones', () => {
    const heavy = heaviestModels(modelUses(props, S), statsOf, 2)
    expect(heavy.map((m) => [m.sha256, m.totalTriangles])).toEqual([['statue', 40_000], ['tree', 30_000]])
    expect(idsOf(heavy)).toEqual(['st1', ...Array.from({ length: 10 }, (_, i) => `t${i}`)])
    expect(heaviestModels(modelUses(props, S), statsOf).map((m) => m.sha256)).toEqual(['statue', 'tree', 'barrel'])
  })

  it('formats figures compactly', () => {
    expect(compact(950)).toBe('950')
    expect(compact(1234)).toBe('1.2k')
    expect(compact(45_600)).toBe('46k')
    expect(compact(2_500_000)).toBe('2.5M')
    expect(megabytes(3.25 * MB)).toBe('3.3 MB')
    expect(megabytes(128 * MB)).toBe('128 MB')
  })
})

/**
 * The scene budget meter in the Build tray (reports/Level design plan.md, Phase 5): what the
 * active scene costs to draw against the graphics tier's budget. Triangles and draw calls are the
 * last frame's (`renderer.info`, sampled by `FrameStatsProbe`); texture memory adds up
 * `getModelStats` over the distinct models in use. Pure apart from the tiny frame store.
 */
import { create } from 'zustand'
import type { Prop } from '@/core/doc'
import type { PropId, SceneId } from '@/core/ids'
import type { GraphicsTier } from '../graphics'

export interface SceneCost {
  triangles: number
  drawCalls: number
  textureBytes: number
}

const MB = 1024 * 1024

/**
 * What a scene may cost on each tier. The low tier (older phones, integrated graphics) is the one
 * every scene should fit; battery saver draws the same scene, only slower, so it shares it.
 */
export const SCENE_BUDGETS: Record<GraphicsTier, SceneCost> = {
  battery: { triangles: 250_000, drawCalls: 150, textureBytes: 128 * MB },
  low: { triangles: 250_000, drawCalls: 150, textureBytes: 128 * MB },
  medium: { triangles: 600_000, drawCalls: 300, textureBytes: 256 * MB },
  high: { triangles: 1_500_000, drawCalls: 600, textureBytes: 512 * MB },
}

/** Only what the meter needs from a model's measured stats (gltf.ts `ModelStats`). */
export interface ModelCost {
  triangles: number
  textureBytes: number
}

/** One model as used in the scene: how many props draw it and which. */
export interface ModelUse {
  sha256: string
  title: string
  ids: PropId[]
}

/** The scene's props grouped by model, in first-seen order. */
export function modelUses(props: Readonly<Record<string, Prop>>, scene: SceneId | null): ModelUse[] {
  const out = new Map<string, ModelUse>()
  if (!scene) return []
  for (const p of Object.values(props)) {
    if (p.scene !== scene || !p.model?.sha256) continue
    let u = out.get(p.model.sha256)
    if (!u) out.set(p.model.sha256, (u = { sha256: p.model.sha256, title: p.name || p.model.name || 'Model', ids: [] }))
    u.ids.push(p.id)
  }
  return [...out.values()]
}

/**
 * The scene's cost: the frame's triangles and draw calls, and the texture memory of every distinct
 * model in use (a texture is uploaded once however many props share it). `extra` adds models
 * that are not props, such as the scene model itself.
 */
export function sceneCost(uses: readonly ModelUse[], statsOf: (sha256: string) => ModelCost | undefined, frame: { triangles: number; calls: number }, extra: readonly string[] = []): SceneCost {
  let textureBytes = 0
  const seen = new Set<string>()
  for (const sha of [...uses.map((u) => u.sha256), ...extra]) {
    if (seen.has(sha)) continue
    seen.add(sha)
    textureBytes += statsOf(sha)?.textureBytes ?? 0
  }
  return { triangles: frame.triangles, drawCalls: frame.calls, textureBytes }
}

export interface BudgetReading {
  /** The largest share of the tier's budget any figure uses (1 = at the budget). */
  fraction: number
  /** Figures over the low tier's budget: the scene will struggle on weak devices. */
  overLow: Array<keyof SceneCost>
  /** Figures over this device's tier. */
  overTier: Array<keyof SceneCost>
}

const KEYS: Array<keyof SceneCost> = ['triangles', 'drawCalls', 'textureBytes']

export function readBudget(cost: SceneCost, tier: GraphicsTier): BudgetReading {
  const budget = SCENE_BUDGETS[tier]
  const low = SCENE_BUDGETS.low
  return {
    fraction: Math.max(...KEYS.map((k) => cost[k] / budget[k])),
    overLow: KEYS.filter((k) => cost[k] > low[k]),
    overTier: KEYS.filter((k) => cost[k] > budget[k]),
  }
}

export interface HeavyModel extends ModelUse {
  /** Triangles of one copy, and of every copy in the scene. */
  triangles: number
  totalTriangles: number
  textureBytes: number
}

/**
 * The heaviest models in the scene: by triangles over all their copies, then texture memory.
 * Models not measured yet (still loading) are left out.
 */
export function heaviestModels(uses: readonly ModelUse[], statsOf: (sha256: string) => ModelCost | undefined, n = 5): HeavyModel[] {
  const out: HeavyModel[] = []
  for (const u of uses) {
    const s = statsOf(u.sha256)
    if (!s) continue
    out.push({ ...u, triangles: s.triangles, totalTriangles: s.triangles * u.ids.length, textureBytes: s.textureBytes })
  }
  return out.sort((a, b) => b.totalTriangles - a.totalTriangles || b.textureBytes - a.textureBytes).slice(0, n)
}

/** Every prop of the given models, for "Select all of these". */
export function idsOf(models: readonly ModelUse[]): PropId[] {
  return models.flatMap((m) => m.ids)
}

/** 1234 → "1.2k", 2_500_000 → "2.5M". */
export function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`
  return String(Math.round(n))
}

export function megabytes(bytes: number): string {
  return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`
}

/** The last sampled frame (Build only), shared by the canvas probe and the tray meter. */
export const useFrameStats = create<{ triangles: number; calls: number; at: number }>(() => ({ triangles: 0, calls: 0, at: 0 }))

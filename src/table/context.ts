/** Per-canvas context: who is looking, callbacks out, and the resolved scene geometry. */
import { createContext, useContext } from 'react'
import type { AssetRef } from '@/core/assets'
import type { Scene, Token } from '@/core/doc'
import type { GridSpec } from '@/core/geometry'
import type { PlayerPubkey, SceneId } from '@/core/ids'
import type { Intent } from '@/core/intents'
import type { Presence } from '@/core/presence'
import type { GraphicsPreset } from './graphics'
import type { LoadedScene } from './sceneLoader'
import type { WallSegment } from './walls'

export interface ViewerInfo {
  pubkey: PlayerPubkey
  isGm: boolean
  /**
   * A table display (TV, second screen): sees what the party sees, never reveals or moves anything.
   * `follow` glides along with the GM's shared camera; otherwise it frames the whole scene.
   */
  display?: { follow: boolean }
}

export interface TableContextValue {
  sceneId: SceneId
  scene: Scene
  grid: GridSpec
  /** Height of the floor tokens stand on. */
  floorY: number
  loaded: LoadedScene | null
  /** Everything that blocks sight and movement right now: model, imported, prop and drawn walls, closed doors. */
  walls: readonly WallSegment[]
  viewer: ViewerInfo | null
  onIntent(intent: Intent): void
  onPresence(p: Partial<Presence>): void
  resolveAsset(ref: AssetRef): Promise<string>
  /** This device's graphics preset (graphics.ts). */
  graphics: GraphicsPreset
}

export const TableContext = createContext<TableContextValue | null>(null)

export function useTable(): TableContextValue {
  const v = useContext(TableContext)
  if (!v) throw new Error('useTable outside TableCanvas')
  return v
}

/** GM moves anything; owners move their own; an anonymous viewer (dev) is treated as GM. */
export function canControl(viewer: ViewerInfo | null, token: Token): boolean {
  if (!viewer || viewer.isGm) return true
  return token.owner === viewer.pubkey
}

/** Fog is revealed by tokens the viewer controls; the GM also reveals for unowned tokens. */
export function revealsFor(viewer: ViewerInfo | null, token: Token): boolean {
  if (!viewer) return true
  if (viewer.display) return false
  if (viewer.isGm) return !token.owner || token.owner === viewer.pubkey
  return token.owner === viewer.pubkey
}

/** Whose sight a viewer sees through: the GM every token's; a display every player's; a player their own. */
export function seesThrough(viewer: ViewerInfo | null, token: Token): boolean {
  if (!viewer || viewer.isGm) return true
  if (viewer.display) return !!token.owner
  return token.owner === viewer.pubkey
}

/** Default asset resolution when the host passes no resolver: first listed source. */
export async function defaultResolveAsset(ref: AssetRef): Promise<string> {
  const src = ref.sources[0]
  if (!src) throw new Error(`asset ${ref.name ?? ref.sha256} has no sources`)
  return src
}

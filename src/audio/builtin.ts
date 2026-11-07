/** Built-in synthesized one-shots, addressed as AssetRefs with a `builtin:` source. */
import type { AssetRef } from '@/core/assets'
import type { AssetHash } from '@/core/ids'

export const BUILTIN_SOUNDS = ['door', 'sword', 'thunder', 'coin', 'scream', 'drum'] as const
export type BuiltinSound = (typeof BUILTIN_SOUNDS)[number]

export const BUILTIN_LABELS: Record<BuiltinSound, string> = {
  door: 'Door creak',
  sword: 'Sword clash',
  thunder: 'Thunder',
  coin: 'Coin',
  scream: 'Scream',
  drum: 'Drum hit',
}

/** Placeholder hash: built-ins have no bytes to verify. */
export const ZERO_HASH = '0'.repeat(64) as AssetHash
const SCHEME = 'builtin:'

export function builtinRef(name: BuiltinSound): AssetRef {
  return { sha256: ZERO_HASH, kind: 'audio', mime: 'audio/x-builtin', size: 0, name: BUILTIN_LABELS[name], sources: [SCHEME + name] }
}

/** The builtin name if `ref` addresses one, else null. */
export function builtinName(ref: AssetRef): BuiltinSound | null {
  for (const s of ref.sources) {
    if (!s.startsWith(SCHEME)) continue
    const name = s.slice(SCHEME.length)
    if ((BUILTIN_SOUNDS as readonly string[]).includes(name)) return name as BuiltinSound
  }
  return null
}

export const isBuiltin = (ref: AssetRef): boolean => builtinName(ref) !== null

/** Identifies a sound for stop and "playing": `builtin:<name>` or the asset hash. */
export function soundKey(ref: AssetRef): string {
  const b = builtinName(ref)
  return b ? SCHEME + b : ref.sha256
}

/** Roughly how long each synthesized one-shot sounds, for the "playing" indicator (seconds). */
export const BUILTIN_DURATION_S: Record<BuiltinSound, number> = { door: 1.6, sword: 0.9, thunder: 3.5, coin: 0.9, scream: 1.6, drum: 0.7 }

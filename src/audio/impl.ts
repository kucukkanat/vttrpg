// TODO(audio): implement.
import type { AudioEngine } from './index'
export function createAudioEngine(_opts: { resolve(ref: import('@/core/assets').AssetRef): Promise<string> }): AudioEngine {
  throw new Error('audio: not implemented')
}

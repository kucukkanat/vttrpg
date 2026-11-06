// TODO(assets session): implement. See src/assets/index.ts for the contract.
import type { AssetResolver } from './index'

export const DEFAULT_BLOSSOM_SERVERS = ['https://blossom.primal.net', 'https://cdn.satellite.earth']

export function createAssetResolver(_opts: { libraryBase: string }): AssetResolver {
  throw new Error('assets: not implemented')
}

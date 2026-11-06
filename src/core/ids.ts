/** Branded string ids so modules cannot mix them up. */
export type Brand<T, B extends string> = T & { readonly __brand: B }

export type GameId = Brand<string, 'GameId'>
export type SceneId = Brand<string, 'SceneId'>
export type TokenId = Brand<string, 'TokenId'>
export type CharacterId = Brand<string, 'CharacterId'>
export type PlayerPubkey = Brand<string, 'PlayerPubkey'> // hex nostr pubkey
export type AssetHash = Brand<string, 'AssetHash'> // sha256 hex
export type PackId = Brand<string, 'PackId'>
export type SkillId = Brand<string, 'SkillId'>

export function newId<T extends string>(): Brand<string, T> {
  return crypto.randomUUID() as Brand<string, T>
}

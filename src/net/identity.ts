/**
 * Nostr identity: a NIP-07 browser extension when one is installed, otherwise a
 * locally generated secret key persisted in localStorage.
 *
 * Dev profiles: `?as=<name>` in the page query (`/?as=bob#/join/...`) or in the hash query
 * (`#/join/naddr...?k=...&as=bob`) keeps that tab's key under its own storage key, so two
 * players can be tested in one browser. The extension is skipped while a profile is active.
 */
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, type EventTemplate } from 'nostr-tools'
import type { WindowNostr } from 'nostr-tools/nip07'
import type { PlayerPubkey } from '@/core/ids'
import { bytesToHex, hexToBytes } from './codec'
import type { Identity } from './index'

export const SECRET_STORAGE_KEY = 'vttrpg.nostr.secret'
/** Query parameter naming a dev identity profile. */
export const PROFILE_PARAM = 'as'

const memoryStore = new Map<string, string>()

function storage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    const ls = globalThis.localStorage
    if (ls) return ls
  } catch {
    // access denied (privacy mode) or not a browser
  }
  return {
    getItem: (k) => memoryStore.get(k) ?? null,
    setItem: (k, v) => void memoryStore.set(k, v),
  }
}

/** Identity backed by a raw secret key. Used for local keys and the dev harness. */
export function localIdentity(secretKey: Uint8Array): Identity {
  const pubkey = getPublicKey(secretKey) as PlayerPubkey
  return {
    pubkey,
    async sign(event) {
      return finalizeEvent(event as EventTemplate, secretKey)
    },
    async conversationKey(peer) {
      return nip44.v2.utils.getConversationKey(secretKey, peer)
    },
  }
}

function extensionIdentity(ext: WindowNostr, pubkey: string): Identity {
  return {
    pubkey: pubkey as PlayerPubkey,
    async sign(event) {
      return ext.signEvent(event as EventTemplate)
    },
    async conversationKey() {
      throw new Error('NIP-07 extensions do not expose conversation keys; use the extension nip44 API instead')
    },
  }
}

/**
 * Reads the `as` profile out of a URL's page query or hash query. Pure; the app passes
 * `window.location.href`. Names are limited to `[A-Za-z0-9_-]{1,32}`; anything else is ignored.
 */
export function profileFromUrl(href: string): string | null {
  const read = (query: string) => {
    const v = new URLSearchParams(query).get(PROFILE_PARAM)
    return v && /^[A-Za-z0-9_-]{1,32}$/.test(v) ? v : null
  }
  try {
    const hashAt = href.indexOf('#')
    const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href
    const hash = hashAt >= 0 ? href.slice(hashAt + 1) : ''
    const q = beforeHash.indexOf('?')
    const fromPage = q >= 0 ? read(beforeHash.slice(q + 1)) : null
    if (fromPage) return fromPage
    const hq = hash.indexOf('?')
    return hq >= 0 ? read(hash.slice(hq + 1)) : null
  } catch {
    return null
  }
}

/** The active dev profile name for this tab, or null. */
export function currentProfile(): string | null {
  if (typeof window === 'undefined' || !window.location) return null
  return profileFromUrl(window.location.href)
}

/**
 * `.<name>` while a dev profile is active, otherwise ''. Append it to any per-device storage
 * key that should be separate per identity (the secret key is; `games.ts` may do the same).
 */
export function profileSuffix(): string {
  const p = currentProfile()
  return p ? `.${p}` : ''
}

/** Storage key for the secret key of the given profile (default profile when null). */
export function secretStorageKey(profile: string | null = currentProfile()): string {
  return profile ? `${SECRET_STORAGE_KEY}.${profile}` : SECRET_STORAGE_KEY
}

function loadOrCreateSecret(key: string): Uint8Array {
  const store = storage()
  const hex = store.getItem(key)
  if (hex && /^[0-9a-f]{64}$/.test(hex)) return hexToBytes(hex)
  const sk = generateSecretKey()
  store.setItem(key, bytesToHex(sk))
  return sk
}

export async function loadIdentity(): Promise<Identity> {
  const profile = currentProfile()
  if (profile) return localIdentity(loadOrCreateSecret(secretStorageKey(profile)))
  const ext = (globalThis as { nostr?: WindowNostr }).nostr
  if (ext && typeof ext.getPublicKey === 'function') {
    try {
      const pk = await ext.getPublicKey()
      if (/^[0-9a-f]{64}$/.test(pk)) return extensionIdentity(ext, pk)
    } catch (e) {
      console.warn('net: NIP-07 extension refused, falling back to a local key', e)
    }
  }
  return localIdentity(loadOrCreateSecret(secretStorageKey(null)))
}

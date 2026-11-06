/**
 * Nostr identity: a NIP-07 browser extension when one is installed, otherwise a
 * locally generated secret key persisted in localStorage.
 */
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, type EventTemplate } from 'nostr-tools'
import type { WindowNostr } from 'nostr-tools/nip07'
import type { PlayerPubkey } from '@/core/ids'
import { bytesToHex, hexToBytes } from './codec'
import type { Identity } from './index'

export const SECRET_STORAGE_KEY = 'vttrpg.nostr.secret'

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

function loadOrCreateSecret(): Uint8Array {
  const store = storage()
  const hex = store.getItem(SECRET_STORAGE_KEY)
  if (hex && /^[0-9a-f]{64}$/.test(hex)) return hexToBytes(hex)
  const sk = generateSecretKey()
  store.setItem(SECRET_STORAGE_KEY, bytesToHex(sk))
  return sk
}

export async function loadIdentity(): Promise<Identity> {
  const ext = (globalThis as { nostr?: WindowNostr }).nostr
  if (ext && typeof ext.getPublicKey === 'function') {
    try {
      const pk = await ext.getPublicKey()
      if (/^[0-9a-f]{64}$/.test(pk)) return extensionIdentity(ext, pk)
    } catch (e) {
      console.warn('net: NIP-07 extension refused, falling back to a local key', e)
    }
  }
  return localIdentity(loadOrCreateSecret())
}

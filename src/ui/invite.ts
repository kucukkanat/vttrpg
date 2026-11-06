/**
 * Invite link helpers shared by the top bar, the Players panel and the join page: build the
 * link, copy it without ever falling back to `prompt()`, describe where a link points, and
 * look the game up on its relays before a player commits to joining.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameConnection, InviteInfo } from '@/net'
import { localGameStore } from '@/net'
// The net contract does not expose a manifest-only lookup; the join page previews the game
// with the same pieces joinGame uses so the player sees the name before connecting.
import { fetchManifest } from '@/net/connection'
import { createPool } from '@/net/pool'
import type { Manifest } from '@/net/codec'

/** The link players open; one place to change if the format ever moves off the fragment. */
export function buildInviteUrl(connection: Pick<GameConnection, 'inviteLink'>): string {
  return connection.inviteLink()
}

export interface Clipboard {
  writeText(text: string): Promise<void>
}

export interface CopyEnv {
  clipboard?: Clipboard | null
  /** Legacy path: select the text in a hidden field and run the copy command. */
  execCopy?: (text: string) => boolean
}

function defaultEnv(): CopyEnv {
  return {
    clipboard: typeof navigator !== 'undefined' ? navigator.clipboard ?? null : null,
    execCopy: typeof document !== 'undefined' ? execCommandCopy : undefined,
  }
}

function execCommandCopy(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    ta.remove()
  }
}

/**
 * Copies `text`; resolves true when something took it. Tries the async clipboard first, then
 * the legacy copy command. Never opens a dialog: callers show the text selected on failure.
 */
export async function copyText(text: string, env: CopyEnv = defaultEnv()): Promise<boolean> {
  if (env.clipboard) {
    try {
      await env.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy path
    }
  }
  try {
    return env.execCopy ? env.execCopy(text) : false
  } catch {
    return false
  }
}

export type CopyState = 'idle' | 'copied' | 'failed'

/** How long the "Copied" confirmation stays. */
export const COPIED_FOR_MS = 2000

/** "Copy" button state machine: `copied` resets itself, `failed` stays until the next attempt or `reset`. */
export function useCopy(text: string, env?: CopyEnv): { state: CopyState; copy: () => Promise<boolean>; reset: () => void } {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  useEffect(() => clear, [])
  const copy = useCallback(async () => {
    clear()
    const ok = await copyText(text, env)
    setState(ok ? 'copied' : 'failed')
    if (ok) timer.current = setTimeout(() => setState('idle'), COPIED_FOR_MS)
    return ok
  }, [text, env])
  const reset = useCallback(() => { clear(); setState('idle') }, [])
  return { state, copy, reset }
}

/** Selects everything in a field so a manual copy works where the clipboard API does not. */
export function selectAll(el: HTMLInputElement | HTMLTextAreaElement | null): void {
  if (!el) return
  el.focus()
  el.select()
  try { el.setSelectionRange(0, el.value.length) } catch { /* not every input type supports it */ }
}

/** `wss://relay.damus.io/` -> `relay.damus.io` */
export function relayHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.replace(/^wss?:\/\//, '').replace(/\/+$/, '')
  }
}

/** "relay.damus.io", "relay.damus.io and 1 more", "3 relays" when none are listed by name. */
export function describeRelays(relays: string[]): string {
  if (relays.length === 0) return 'the relays'
  const first = relayHost(relays[0])
  if (relays.length === 1) return first
  return `${first} and ${relays.length - 1} more`
}

/** "Shared on 3 of 5 relays" for the invite popover; honest about relays that are down. */
export function relayStatusLine(open: number, total: number): string {
  if (total === 0) return 'No relays configured'
  if (open === 0) return `Not reachable on any of ${total} relays yet`
  if (open === total) return `Shared on ${total} ${total === 1 ? 'relay' : 'relays'}`
  return `Shared on ${open} of ${total} relays`
}

export type RelayHealthLevel = 'good' | 'degraded' | 'none'

export interface RelayHealth {
  open: number
  total: number
  /** `none`: nothing open; `degraded`: fewer than half of the relays are open; `good` otherwise. */
  level: RelayHealthLevel
}

/** Shown under the relay line in the invite popover whenever the health is not `good`. */
export const RELAY_HEALTH_HINT = 'Players may take longer to find the game; keep this tab open.'

/** Clamps `open` into [0, total] and grades the connection for the status label and the invite popover. */
export function relayHealth(open: number, total: number): RelayHealth {
  const t = Math.max(0, total)
  const o = Math.max(0, Math.min(open, t))
  const level: RelayHealthLevel = t === 0 || o === 0 ? 'none' : o * 2 < t ? 'degraded' : 'good'
  return { open: o, total: t, level }
}

export interface GamePreview {
  name: string
  gm: string
}

/** Budget for the join-page preview; the join itself retries with a longer one. */
export const PREVIEW_TIMEOUT_MS = 12_000

/**
 * Looks the game up on the relays named in the invite and returns its manifest. The copy is
 * saved locally so the join that follows can skip the same relay round. Throws when no relay
 * answers within the budget.
 */
export async function previewGame(info: InviteInfo, relays: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<GamePreview> {
  if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const { pool, tracker } = createPool(relays)
  try {
    const found = await Promise.race([
      fetchManifest(pool, relays, info.gameKey, info.gameId, opts.timeoutMs ?? PREVIEW_TIMEOUT_MS),
      new Promise<never>((_, reject) => opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })),
    ])
    const manifest: Manifest = found.manifest
    void localGameStore().saveManifest(info.gameId, manifest).catch(() => {})
    return { name: manifest.name, gm: manifest.gm }
  } finally {
    tracker.dispose()
    pool.destroy()
  }
}

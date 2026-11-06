/**
 * Service worker registration (production only; a no-op in dev) and the update prompt.
 *
 * The worker is registered with `registerType: 'prompt'`, so a new build waits instead of taking
 * over a running session. When one is waiting a sticky toast offers "Reload"; the reload itself
 * is deferred while a token or gizmo drag is in progress or dice are still rolling, for at most
 * `MAX_DEFER_MS`, so a tap on Reload never yanks the page out from under a move.
 */
import { pushToast } from '@/ui/toasts'
import { useTableUi } from '@/table/tableState'
import { useGame } from '@/state/store'
import type { ChatMessage } from '@/core/doc'

/** What the reload decision looks at; read from the table and game stores. */
export interface Activity {
  /** A token is being dragged (ghost on the table). */
  drag: boolean
  /** A gizmo handle or prop drag is in progress. */
  editDrag: boolean
  /** `at` of the most recent roll message, or null when nobody has rolled. */
  lastRollAt: number | null
}

/** A roll counts as in progress for this long after its message: the throw plus the linger. */
export const ROLL_SETTLE_MS = 8_000
/** Longest a requested reload waits for the table to go idle. */
export const MAX_DEFER_MS = 10_000
/** How often a deferred reload re-checks the table. */
export const DEFER_POLL_MS = 250

/** True while a drag is in progress or the latest roll is still animating. */
export function isBusy(a: Activity, now: number): boolean {
  if (a.drag || a.editDrag) return true
  if (a.lastRollAt == null) return false
  const age = now - a.lastRollAt
  return age >= 0 && age < ROLL_SETTLE_MS
}

/** A reload requested at `requestedAt` may run at `now` once the table is idle or the wait is up. */
export function shouldReloadNow(a: Activity, now: number, requestedAt: number): boolean {
  return !isBusy(a, now) || now - requestedAt >= MAX_DEFER_MS
}

/** `at` of the last roll in the chat log, scanning from the end. */
export function lastRollAt(chat: readonly ChatMessage[]): number | null {
  for (let i = chat.length - 1; i >= 0; i--) if (chat[i].kind === 'roll') return chat[i].at
  return null
}

/**
 * Calls `apply` as soon as `shouldReloadNow` allows, polling `read` every `pollMs`. Returns a
 * cancel function; `apply` runs at most once.
 */
export function deferUntilIdle(read: () => Activity, apply: () => void, opts: { now?: () => number; pollMs?: number } = {}): () => void {
  const now = opts.now ?? Date.now
  const pollMs = opts.pollMs ?? DEFER_POLL_MS
  const requestedAt = now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  const tick = () => {
    if (done) return
    if (shouldReloadNow(read(), now(), requestedAt)) {
      done = true
      apply()
      return
    }
    timer = setTimeout(tick, pollMs)
  }
  tick()
  return () => {
    done = true
    if (timer !== undefined) clearTimeout(timer)
  }
}

function readActivity(): Activity {
  const table = useTableUi.getState()
  return { drag: table.drag !== null, editDrag: table.editDrag, lastRollAt: lastRollAt(useGame.getState().chat) }
}

export const UPDATE_TOAST_KEY = 'pwa-update'

/** Registers the service worker in production builds; no-op in dev. */
export function registerPwa(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: false,
        onNeedRefresh() {
          pushToast({
            key: UPDATE_TOAST_KEY,
            ttl: 0,
            text: 'New version ready',
            action: {
              label: 'Reload',
              run() {
                if (isBusy(readActivity(), Date.now())) pushToast({ key: UPDATE_TOAST_KEY, ttl: 0, text: 'Reloading once the table is idle…' })
                deferUntilIdle(readActivity, () => { void updateSW(true) })
              },
            },
          })
        },
        onOfflineReady() {
          pushToast({ key: 'pwa-offline', text: 'Ready to open offline' })
        },
      })
    })
    .catch((e) => console.warn('pwa: service worker not registered', e))
}

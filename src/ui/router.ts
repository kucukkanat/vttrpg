import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'join'; invite: string }
  | { name: 'game' }
  | { name: 'dev'; story: string }

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#/, '')
  if (h.startsWith('/join/')) return { name: 'join', invite: window.location.href }
  if (h.startsWith('/new')) return { name: 'new' }
  if (h.startsWith('/game')) return { name: 'game' }
  // Dev stories exist only in dev builds; in production the hash falls through to home.
  if (import.meta.env.DEV && h.startsWith('/dev/')) return { name: 'dev', story: h.slice('/dev/'.length) }
  return { name: 'home' }
}

/**
 * Set when the page loaded straight onto `#/game` (a reload mid-session). No controller
 * can exist yet, so the home page offers to reconnect to the most recent game instead of
 * the game screen bouncing to an empty home.
 */
let reloadedIntoGame = false

/** True once, if this page load started on `#/game`. */
export function takeReloadedIntoGame(): boolean {
  const v = reloadedIntoGame
  reloadedIntoGame = false
  return v
}

function initialRoute(): Route {
  const route = parseRoute(window.location.hash)
  if (route.name !== 'game') return route
  reloadedIntoGame = true
  // Rewrite the hash without a hashchange so a later navigate('/game') still changes it.
  history.replaceState(null, '', window.location.pathname + window.location.search + '#/')
  return { name: 'home' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(initialRoute)
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function navigate(hash: string) {
  window.location.hash = hash
}

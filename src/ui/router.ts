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
  if (h.startsWith('/dev/')) return { name: 'dev', story: h.slice('/dev/'.length) }
  return { name: 'home' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
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

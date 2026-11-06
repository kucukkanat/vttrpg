/** Registers the service worker in production builds; no-op in dev. */
export function registerPwa(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch((e) => console.warn('pwa: service worker not registered', e))
}

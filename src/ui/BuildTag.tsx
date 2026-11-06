/** Tiny build label so testers can tell which deploy they are looking at. */
export function BuildTag() {
  return (
    <div
      aria-label="build"
      style={{ position: 'fixed', right: 6, top: 'calc(48px + env(safe-area-inset-top, 0px))', fontSize: 10, color: '#6b6a66', pointerEvents: 'none', zIndex: 9999, fontFamily: 'ui-monospace, monospace' }}
    >
      {__BUILD_ID__}
    </div>
  )
}

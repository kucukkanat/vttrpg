/** Tiny build label so testers can tell which deploy they are looking at. */
export function BuildTag() {
  return (
    <div
      aria-label="build"
      style={{ position: 'fixed', right: 6, bottom: 'calc(2px + env(safe-area-inset-bottom, 0px))', fontSize: 10, color: '#6b6a66', pointerEvents: 'none', zIndex: 9999, fontFamily: 'ui-monospace, monospace' }}
    >
      {__BUILD_ID__}
    </div>
  )
}

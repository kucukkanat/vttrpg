/** Tiny build label so testers can tell which deploy they are looking at. */
export function BuildTag() {
  return <div className="build-tag" aria-label="build">{__BUILD_ID__}</div>
}

/**
 * Build label so testers can tell which deploy they are looking at. `inline` renders plain muted
 * text for a host footer (drawer, side column, phone More sheet). The default is the small corner
 * tag used outside the game screen; CSS hides it while a game is on screen so it never overlaps
 * the table or a sheet.
 */
export function BuildTag({ inline = false }: { inline?: boolean }) {
  return <span className={inline ? 'build-id' : 'build-tag'} title={`Build ${__BUILD_ID__}`}>{__BUILD_ID__}</span>
}

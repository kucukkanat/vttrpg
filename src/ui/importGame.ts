/**
 * Import a game file (see gameFile.ts) as a new game run by this identity: create the game with
 * the file's name and pack, cache the embedded assets, then write the document.
 */
import { startGame, type StartedGame } from './bootstrap'
import { decodeAssets, parseGameFile, writeImportedDoc } from './gameFile'

export interface ImportReport {
  /** Assets cached from the file. */
  assets: number
  /** Embedded assets refused because their bytes did not match their hash. */
  bad: number
  /** Assets the exporting device could not include; they load from their original sources, if any. */
  missing: number
}

export async function importGameFile(text: string, displayName: string, onProgress?: (s: string) => void): Promise<{ game: StartedGame; report: ImportReport }> {
  const file = parseGameFile(text)
  const meta = file.doc.meta
  onProgress?.('Creating the game…')
  const game = await startGame({ mode: 'create', name: meta.name, packId: meta.pack, displayName, packSource: meta.packSource, packAsset: meta.packAsset })
  onProgress?.('Unpacking maps and models…')
  const { ok, bad } = await decodeAssets(file)
  let cached = 0
  for (const a of ok) {
    try {
      await game.assets.importFile(new File([a.bytes as BlobPart], a.name ?? a.sha256, { type: a.mime }))
      cached++
    } catch (e) {
      console.warn('import: could not cache asset', a.sha256, e)
    }
  }
  onProgress?.('Restoring the table…')
  writeImportedDoc(game.connection.doc, file, game.pubkey)
  return { game, report: { assets: cached, bad: bad + (ok.length - cached), missing: file.missingAssets.length } }
}

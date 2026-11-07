/**
 * Import a game file (see gameFile.ts) as a new game run by this identity: create the game with
 * the file's name and pack, cache the embedded assets, then write the document.
 */
import { startGame, type StartedGame } from './bootstrap'
import type { AssetRef } from '@/core/assets'
import { decodeAssets, parseGameFile, withSharedRefs, writeImportedDoc } from './gameFile'

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
  // Each embedded file is shared (encrypted and uploaded) so players in the new game can load it,
  // and the doc's refs to it pick up the new key and Blossom URLs before the doc is written.
  const shared = new Map<string, AssetRef>()
  for (const a of ok) {
    try {
      const ref = await game.assets.shareFile(new File([a.bytes as BlobPart], a.name ?? a.sha256, { type: a.mime }))
      if (ref.sha256 === a.sha256) shared.set(ref.sha256, ref)
      cached++
    } catch (e) {
      console.warn('import: could not cache asset', a.sha256, e)
    }
  }
  onProgress?.('Restoring the table…')
  writeImportedDoc(game.connection.doc, { ...file, doc: withSharedRefs(file.doc, shared) }, game.pubkey)
  return { game, report: { assets: cached, bad: bad + (ok.length - cached), missing: file.missingAssets.length } }
}

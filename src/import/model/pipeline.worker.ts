/**
 * Import worker: runs `runCore` off the main thread so a big simplify or a texture re-encode does
 * not freeze the table. Messages: in `{ id, req }`; out `{ id, progress }`, `{ id, result }` or
 * `{ id, error: { code, message } }`.
 */
import { runCore, type CoreRequest, type CoreResult } from './core'
import { isModelImportError, type ImportErrorCode } from './types'

export type CoreReply =
  | { id: number; progress: { fraction: number; message: string } }
  | { id: number; result: CoreResult }
  | { id: number; error: { code: ImportErrorCode; message: string; internal: boolean } }

// Typed loosely so the file also compiles under the app's DOM lib.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; req: CoreRequest }>) => void) | null
  postMessage(m: CoreReply, transfer?: Transferable[]): void
}

scope.onmessage = async (e) => {
  const { id, req } = e.data
  try {
    const result = await runCore(req, (fraction, message) => scope.postMessage({ id, progress: { fraction, message } }))
    scope.postMessage({ id, result }, [result.glb.buffer as ArrayBuffer])
  } catch (err) {
    const known = isModelImportError(err)
    scope.postMessage({ id, error: { code: known ? err.code : 'corrupt', message: err instanceof Error ? err.message : String(err), internal: !known } })
  }
}

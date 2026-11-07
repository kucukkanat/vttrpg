/**
 * Streaming download with progress, a size cap and readable errors, shared by the Poly Haven and
 * Sketchfab clients.
 */
import { MAX_IMPORT_BYTES, ModelImportError } from './types'

type Fetch = typeof fetch

const host = (url: string) => { try { return new URL(url).host } catch { return 'the server' } }

/** Downloads with progress; `onBytes` receives the running total. */
export async function fetchBytes(url: string, opts: { fetch?: Fetch; signal?: AbortSignal; headers?: HeadersInit; onBytes?: (n: number) => void; limit?: number } = {}): Promise<Uint8Array> {
  let res: Response
  try {
    res = await (opts.fetch ?? fetch)(url, { headers: opts.headers, signal: opts.signal })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new ModelImportError('cancelled', 'Cancelled.')
    throw new ModelImportError('network', `The download failed (${host(url)} could not be reached or refused the request).`)
  }
  if (!res.ok) throw new ModelImportError('network', `The download failed: ${host(url)} answered ${res.status}.`)
  const limit = opts.limit ?? MAX_IMPORT_BYTES
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > limit) throw new ModelImportError('too-large', `The file is ${(declared / 1048576).toFixed(0)} MB; the limit is ${(limit / 1048576).toFixed(0)} MB.`)
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > limit) throw new ModelImportError('too-large', `The file is over the ${(limit / 1048576).toFixed(0)} MB limit.`)
    opts.onBytes?.(buf.byteLength)
    return buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    n += value.byteLength
    if (n > limit) {
      await reader.cancel()
      throw new ModelImportError('too-large', `The file is over the ${(limit / 1048576).toFixed(0)} MB limit.`)
    }
    opts.onBytes?.(n)
  }
  const out = new Uint8Array(n)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.byteLength }
  return out
}

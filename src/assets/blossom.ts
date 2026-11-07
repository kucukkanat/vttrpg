/** Blossom (BUD-01/BUD-02) helpers. */
export interface UnsignedEvent {
  kind: number
  created_at: number
  tags: string[][]
  content: string
}

export const BLOSSOM_AUTH_KIND = 24242
const AUTH_TTL_SECONDS = 300

export function buildUploadAuthEvent(
  sha256: string,
  name: string | undefined,
  now = Math.floor(Date.now() / 1000),
): UnsignedEvent {
  return {
    kind: BLOSSOM_AUTH_KIND,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['x', sha256],
      ['expiration', String(now + AUTH_TTL_SECONDS)],
    ],
    content: `Upload ${name ?? sha256}`,
  }
}

export function encodeAuthHeader(signed: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(signed))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `Nostr ${btoa(bin)}`
}

export function normalizeServer(server: string): string {
  return server.trim().replace(/\/+$/, '')
}

export async function describeHttpError(server: string, res: Response): Promise<string> {
  const reason = res.headers.get('X-Reason')
  let body = ''
  if (!reason) {
    try {
      body = (await res.text()).slice(0, 200)
    } catch {
      /* ignore */
    }
  }
  const hint =
    res.status === 401 || res.status === 403 ? 'the server rejected the signed upload authorization'
    : res.status === 402 ? 'the server requires payment'
    : res.status === 413 ? 'the file is too large for this server'
    : res.status === 415 ? 'the server does not accept this file type'
    : 'request refused'
  const detail = reason ?? body
  return `Blossom ${server} answered ${res.status} (${hint})${detail ? `: ${detail}` : ''}`
}

export type BlossomSigner = (event: unknown) => Promise<unknown>

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * BUD-02 upload of raw bytes whose sha256 is already known. Checks the descriptor hash and returns
 * the URL the server reports (or `<server>/<sha256>` when it reports none).
 */
export async function putBlob(
  server: string,
  body: Blob,
  opts: { sha256: string; mime: string; name?: string; sign: BlossomSigner },
): Promise<string> {
  const base = normalizeServer(server)
  const signed = await opts.sign(buildUploadAuthEvent(opts.sha256, opts.name))
  if (!signed || typeof signed !== 'object' || !('sig' in signed) || !('id' in signed)) {
    throw new Error('assets: signer did not return a signed event (missing id/sig)')
  }
  let res: Response
  try {
    res = await fetch(`${base}/upload`, {
      method: 'PUT',
      headers: {
        Authorization: encodeAuthHeader(signed),
        'Content-Type': opts.mime,
        'X-SHA-256': opts.sha256,
      },
      body,
    })
  } catch (e) {
    throw new Error(`Blossom ${base} is unreachable (${errText(e)})`)
  }
  if (!res.ok) throw new Error(await describeHttpError(base, res))
  let descriptor: { url?: unknown; sha256?: unknown }
  try {
    descriptor = (await res.json()) as typeof descriptor
  } catch {
    throw new Error(`Blossom ${base} returned an unreadable blob descriptor`)
  }
  if (descriptor.sha256 !== opts.sha256) {
    throw new Error(`Blossom ${base} stored different bytes (descriptor sha256 ${String(descriptor.sha256)})`)
  }
  return typeof descriptor.url === 'string' ? descriptor.url : `${base}/${opts.sha256}`
}

/** Default pauses between upload attempts: six tries over about two minutes. */
export const UPLOAD_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000]

export interface RetryOptions {
  /** Pauses between rounds; one round more than there are pauses. */
  delaysMs?: number[]
  /** Called before each round, with the previous round's last error. */
  onAttempt?: (attempt: number, lastError?: string) => void
  sleep?: (ms: number) => Promise<void>
}

/**
 * Tries `servers` in order, then the whole round again after each pause in `delaysMs`, until one
 * accepts the bytes. Resolves with the server that took them and its URL; rejects with the last
 * error.
 */
export async function putBlobWithRetry(
  servers: string[],
  body: Blob,
  opts: Parameters<typeof putBlob>[2] & RetryOptions,
): Promise<{ server: string; url: string }> {
  if (!servers.length) throw new Error('assets: no Blossom server to upload to')
  const delays = opts.delaysMs ?? UPLOAD_RETRY_DELAYS_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let last = 'upload failed'
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]!)
    opts.onAttempt?.(attempt + 1, attempt > 0 ? last : undefined)
    for (const server of servers) {
      try {
        return { server: normalizeServer(server), url: await putBlob(server, body, opts) }
      } catch (e) {
        last = errText(e)
      }
    }
  }
  throw new Error(last)
}

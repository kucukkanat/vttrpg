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

import type { AssetHash } from '@/core/ids'
import type { AssetKind } from '@/core/assets'

export function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<AssetHash> {
  let buf: ArrayBuffer
  if (data instanceof Blob) buf = await data.arrayBuffer()
  else if (data instanceof ArrayBuffer) buf = data
  else buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  return toHex(await crypto.subtle.digest('SHA-256', buf)) as AssetHash
}

const EXT: Record<string, { kind: AssetKind; mime: string }> = {
  glb: { kind: 'glb', mime: 'model/gltf-binary' },
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  webp: { kind: 'image', mime: 'image/webp' },
  ktx2: { kind: 'image', mime: 'image/ktx2' },
  gif: { kind: 'image', mime: 'image/gif' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  m4a: { kind: 'audio', mime: 'audio/mp4' },
  json: { kind: 'json', mime: 'application/json' },
}

export function inferKind(name: string, mime: string): AssetKind {
  if (mime === 'model/gltf-binary') return 'glb'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/json') return 'json'
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT[ext]?.kind ?? 'other'
}

export function inferMime(name: string, given: string): string {
  if (given) return given
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT[ext]?.mime ?? 'application/octet-stream'
}

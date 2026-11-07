/**
 * Recognising what the GM dropped: which file is the model, which are its companions, and whether
 * the whole set is within the size limit. Zip archives (Sketchfab's glTF download, zipped uploads)
 * are unpacked here with fflate, loaded on demand.
 */
import { MAX_IMPORT_BYTES, ModelImportError, type InputFile, type SourceFormat } from './types'

export const MODEL_EXTENSIONS: Record<string, SourceFormat> = {
  glb: 'glb',
  gltf: 'gltf',
  obj: 'obj',
  fbx: 'fbx',
  stl: 'stl',
  zip: 'zip',
}

/** Accept string for `<input type=file>`: models plus the companions a glTF or OBJ needs. */
export const ACCEPT = '.glb,.gltf,.obj,.mtl,.fbx,.stl,.zip,.bin,.png,.jpg,.jpeg,.webp,.tga,.bmp'

const UNSUPPORTED_HINTS: Record<string, string> = {
  blend: 'Blender files cannot be read in the browser. Export a GLB from Blender (File > Export > glTF 2.0).',
  max: '3ds Max files cannot be read in the browser. Export FBX or GLB first.',
  ma: 'Maya files cannot be read in the browser. Export FBX or GLB first.',
  mb: 'Maya files cannot be read in the browser. Export FBX or GLB first.',
  c4d: 'Cinema 4D files cannot be read in the browser. Export FBX or GLB first.',
  usdz: 'USDZ is not supported yet. Download the GLB or glTF version instead.',
  usd: 'USD is not supported yet. Download the GLB or glTF version instead.',
  '3mf': '3MF is not supported yet. Export STL instead.',
  dae: 'Collada is not supported yet. Export GLB or FBX instead.',
  rar: 'RAR archives cannot be opened in the browser. Use a zip, or drop the files themselves.',
  '7z': '7-Zip archives cannot be opened in the browser. Use a zip, or drop the files themselves.',
}

export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const i = base.lastIndexOf('.')
  return i < 0 ? '' : base.slice(i + 1).toLowerCase()
}

export function baseName(name: string): string {
  return name.split(/[\\/]/).pop() ?? name
}

/** Title from a file name: "old_wooden-chair_02.glb" → "Old wooden chair 02". */
export function titleFromName(name: string): string {
  const stem = baseName(name).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return stem ? stem[0].toUpperCase() + stem.slice(1) : 'Imported model'
}

export function checkSize(totalBytes: number): void {
  if (totalBytes > MAX_IMPORT_BYTES) {
    const mb = (totalBytes / 1024 / 1024).toFixed(0)
    throw new ModelImportError('too-large', `That is ${mb} MB; the limit is ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Try a lower-resolution download or a simpler model.`)
  }
}

/** Sniff a format from the first bytes when the extension is missing or wrong. */
export function sniffFormat(bytes: Uint8Array): SourceFormat | undefined {
  const ascii = (n: number, off = 0) => String.fromCharCode(...bytes.subarray(off, off + n))
  if (bytes.length >= 4 && ascii(4) === 'glTF') return 'glb'
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip'
  if (bytes.length >= 20 && ascii(18) === 'Kaydara FBX Binary') return 'fbx'
  const head = ascii(Math.min(256, bytes.length)).trimStart()
  if (head.startsWith('{') && head.includes('"asset"')) return 'gltf'
  if (/^solid\s/i.test(head) && /facet\s+normal/i.test(ascii(Math.min(1024, bytes.length)))) return 'stl'
  if (head.startsWith('; FBX')) return 'fbx'
  if (/^(#|v\s|o\s|g\s|mtllib\s)/m.test(head)) return 'obj'
  // Binary STL: 80-byte header, uint32 count, 50 bytes per triangle.
  if (bytes.length >= 84) {
    const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
    if (n > 0 && 84 + n * 50 === bytes.length) return 'stl'
  }
  return undefined
}

export interface ModelSet {
  format: Exclude<SourceFormat, 'zip'>
  main: InputFile
  /** Every file, including `main`, keyed by lower-case base name and by relative path. */
  files: InputFile[]
  totalBytes: number
}

/** Unzips an archive into files (paths kept). Rejects archives that would expand past the limit. */
export async function unzip(bytes: Uint8Array): Promise<InputFile[]> {
  const { unzipSync } = await import('fflate')
  let expanded = 0
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)/.test(f.name)) return false
        expanded += f.originalSize
        if (expanded > MAX_IMPORT_BYTES) throw new ModelImportError('too-large', `The archive expands to over ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`)
        return true
      },
    })
  } catch (e) {
    if (e instanceof ModelImportError) throw e
    throw new ModelImportError('corrupt', 'The zip archive is damaged or uses a compression the browser cannot read.')
  }
  return Object.entries(entries).map(([name, data]) => ({ name, bytes: data }))
}

const MODEL_PRIORITY: Array<Exclude<SourceFormat, 'zip'>> = ['glb', 'gltf', 'fbx', 'obj', 'stl']

/**
 * Picks the model out of the dropped files (unpacking zips) and checks the size limit.
 * Throws ModelImportError for oversize, unsupported or empty selections.
 */
export async function collectModelSet(input: InputFile[]): Promise<ModelSet> {
  if (!input.length) throw new ModelImportError('empty', 'No files were selected.')
  checkSize(input.reduce((n, f) => n + f.bytes.byteLength, 0))
  const files: InputFile[] = []
  for (const f of input) {
    const fmt = MODEL_EXTENSIONS[extOf(f.name)] ?? (extOf(f.name) ? undefined : sniffFormat(f.bytes))
    if (fmt === 'zip') files.push(...(await unzip(f.bytes)))
    else files.push(f)
  }
  const totalBytes = files.reduce((n, f) => n + f.bytes.byteLength, 0)
  checkSize(totalBytes)

  const candidates = files
    .map((f) => ({ f, fmt: (MODEL_EXTENSIONS[extOf(f.name)] ?? (extOf(f.name) ? undefined : sniffFormat(f.bytes))) as ModelSet['format'] | 'zip' | undefined }))
    .filter((c): c is { f: InputFile; fmt: ModelSet['format'] } => !!c.fmt && c.fmt !== 'zip')
  if (!candidates.length) {
    for (const f of files) {
      const hint = UNSUPPORTED_HINTS[extOf(f.name)]
      if (hint) throw new ModelImportError('unsupported', hint)
    }
    const names = files.slice(0, 3).map((f) => baseName(f.name)).join(', ')
    throw new ModelImportError('unsupported', `No model found in ${names}. Supported: GLB, glTF, OBJ, FBX, STL (or a zip of them).`)
  }
  candidates.sort((a, b) => MODEL_PRIORITY.indexOf(a.fmt) - MODEL_PRIORITY.indexOf(b.fmt) || b.f.bytes.byteLength - a.f.bytes.byteLength)
  const { f: main, fmt: format } = candidates[0]
  if (!main.bytes.byteLength) throw new ModelImportError('empty', `${baseName(main.name)} is empty.`)
  return { format, main, files, totalBytes }
}

/**
 * Finds a companion file referenced by a model (`scene.bin`, `textures/wood.jpg`, `..\\tex\\a.png`),
 * matching the relative path first, then the base name, case-insensitively.
 */
export function findCompanion(files: InputFile[], ref: string, relativeTo?: string): InputFile | undefined {
  let wanted = ref
  try { wanted = decodeURIComponent(ref) } catch { /* keep raw */ }
  wanted = wanted.replace(/\\/g, '/').replace(/^\.\//, '')
  const dir = relativeTo ? relativeTo.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : ''
  const full = (dir ? `${dir}/${wanted}` : wanted).toLowerCase()
  const exact = files.find((f) => f.name.replace(/\\/g, '/').toLowerCase() === full)
  if (exact) return exact
  const base = baseName(wanted).toLowerCase()
  return files.find((f) => baseName(f.name).toLowerCase() === base)
}

export function mimeForImage(name: string): string {
  const e = extOf(name)
  return e === 'jpg' || e === 'jpeg' ? 'image/jpeg' : e === 'webp' ? 'image/webp' : e === 'png' ? 'image/png' : e === 'ktx2' ? 'image/ktx2' : 'application/octet-stream'
}

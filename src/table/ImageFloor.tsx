/**
 * The floor of an image-based scene: the map image as a textured plane, `widthCells x heightCells`
 * cells large, centred at the grid origin plus the image offset (see imageScene.ts). Receives
 * shadows from token lights. Until the texture arrives the plane shows the placeholder floor colour,
 * so bounds, grid and fog are right from the first frame; the host shows "Loading map…" and the
 * failure state from `onStatus`.
 *
 * The placeholder and the textured floor are two different material instances (keyed elements).
 * With one `<meshStandardMaterial>` whose `map` goes from nothing to a texture, three.js keeps the
 * shader program it compiled for the untextured material (a program is only rebuilt on
 * `needsUpdate`, which assigning `map` does not set) and the map is never sampled: the floor stays
 * a flat lit grey. A fresh material compiles with the map from its first draw.
 */
import { useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { SRGBColorSpace, Texture, TextureLoader } from 'three'
import type { AssetRef } from '@/core/assets'
import type { GridSpec } from '@/core/geometry'
import { useTable } from './context'
import { imageFrame, imagePlaneSize, type SceneImage } from './imageScene'

export type ImageFloorStatus =
  | { kind: 'loading'; name: string }
  | { kind: 'ready'; name: string; width: number; height: number }
  | { kind: 'error'; name: string; message: string }

/** Anything with `loadAsync(url)`; `TextureLoader` in the app, a stub in tests. */
export interface MapTextureLoader {
  loadAsync(url: string): Promise<Texture>
}

export interface LoadMapTextureOptions {
  loader?: MapTextureLoader
  /** Upper bound for anisotropic filtering, normally `gl.capabilities.getMaxAnisotropy()`. */
  maxAnisotropy?: number
}

/** Display name of the map file for status messages. */
export function mapImageName(asset: AssetRef): string {
  return asset.name || `${asset.sha256.slice(0, 12)}…`
}

/**
 * Resolves the asset to a URL and loads it as a colour texture. The texture is tagged sRGB (map
 * images are authored in sRGB; left linear they render washed out) and filtered anisotropically so
 * grid lines in the image stay crisp at grazing camera angles. Errors carry the file name.
 */
export async function loadMapTexture(
  resolve: (ref: AssetRef) => Promise<string>,
  asset: AssetRef,
  opts: LoadMapTextureOptions = {},
): Promise<Texture> {
  const name = mapImageName(asset)
  let url: string
  try {
    url = await resolve(asset)
  } catch (e) {
    throw new Error(`${name}: ${errMsg(e)}`, { cause: e })
  }
  let texture: Texture
  try {
    texture = await (opts.loader ?? new TextureLoader()).loadAsync(url)
  } catch (e) {
    // ImageLoader rejects with a bare ErrorEvent that says nothing useful.
    const why = e instanceof Error ? e.message : ''
    throw new Error(`${name}: ${why || 'not a readable image'}`, { cause: e })
  }
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = Math.max(1, Math.min(8, opts.maxAnisotropy ?? 1))
  texture.needsUpdate = true
  return texture
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Pixel size of a loaded texture's image, when the loader exposes one (ImageLoader does). */
function texturePixelSize(t: Texture): { width: number; height: number } | null {
  const img = t.image as { width?: unknown; height?: unknown; naturalWidth?: unknown; naturalHeight?: unknown } | undefined
  if (!img) return null
  const w = typeof img.naturalWidth === 'number' && img.naturalWidth > 0 ? img.naturalWidth : img.width
  const h = typeof img.naturalHeight === 'number' && img.naturalHeight > 0 ? img.naturalHeight : img.height
  return typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? { width: w, height: h } : null
}

export interface ImageFloorProps {
  image: SceneImage
  grid: GridSpec
  floorY: number
  /** Loading / ready / failed, for the host's overlay. Fires again on every reload. */
  onStatus?(status: ImageFloorStatus): void
  /** Bump to resolve and load the image again after a failure. */
  retry?: number
}

export function ImageFloor({ image, grid, floorY, onStatus, retry = 0 }: ImageFloorProps) {
  const { resolveAsset, scene } = useTable()
  const gl = useThree((s) => s.gl)
  const [texture, setTexture] = useState<Texture | null>(null)
  const [error, setError] = useState(false)

  // Keyed on the content hash: the store recreates `scene` on every sync and the image must not reload.
  const asset = image.asset
  const assetKey = `${asset.sha256}|${asset.sources.join(',')}`
  const assetRef = useRef(asset)
  assetRef.current = asset
  const resolveRef = useRef(resolveAsset)
  resolveRef.current = resolveAsset
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus
  useEffect(() => {
    let live = true
    let loaded: Texture | null = null
    const a = assetRef.current
    const name = mapImageName(a)
    setTexture(null)
    setError(false)
    statusRef.current?.({ kind: 'loading', name })
    loadMapTexture(resolveRef.current, a, { maxAnisotropy: gl.capabilities.getMaxAnisotropy() })
      .then((t) => {
        if (!live) { t.dispose(); return }
        loaded = t
        setTexture(t)
        const px = texturePixelSize(t)
        statusRef.current?.({ kind: 'ready', name, width: px?.width ?? 0, height: px?.height ?? 0 })
      })
      .catch((e: unknown) => {
        if (!live) return
        console.warn('map image failed to load:', e)
        setError(true)
        statusRef.current?.({ kind: 'error', name, message: errMsg(e) })
      })
    return () => {
      live = false
      loaded?.dispose()
    }
  }, [assetKey, gl, retry])

  const frame = imageFrame(grid, image)
  const px = texture ? texturePixelSize(texture) : null
  const size = imagePlaneSize(frame, px?.width ?? 0, px?.height ?? 0)
  const darkness = Math.min(1, Math.max(0, scene.darkness))
  return (
    <mesh rotation-x={-Math.PI / 2} position={[frame.cx, floorY + 0.004, frame.cz]} receiveShadow>
      <planeGeometry args={[size.width, size.height]} />
      {texture ? (
        // A touch of self-illumination keeps a dark scene's visible cells readable; token lights still add on top.
        <meshStandardMaterial key="map" map={texture} roughness={0.95} metalness={0} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.08 + 0.22 * darkness} />
      ) : (
        <meshStandardMaterial key={error ? 'failed' : 'placeholder'} color={error ? '#4a2f2a' : '#3a3630'} roughness={1} />
      )}
    </mesh>
  )
}

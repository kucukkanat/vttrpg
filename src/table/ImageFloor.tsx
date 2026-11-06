/**
 * The floor of an image-based scene: the map image as a textured plane, `widthCells x heightCells`
 * cells large, centred at the grid origin plus the image offset (see imageScene.ts). Receives
 * shadows from token lights. Until the texture arrives the plane shows the placeholder floor colour,
 * so bounds, grid and fog are right from the first frame.
 */
import { useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { SRGBColorSpace, Texture, TextureLoader } from 'three'
import type { GridSpec } from '@/core/geometry'
import { useTable } from './context'
import { imageFrame, type SceneImage } from './imageScene'

export function ImageFloor({ image, grid, floorY }: { image: SceneImage; grid: GridSpec; floorY: number }) {
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
  useEffect(() => {
    let live = true
    let loaded: Texture | null = null
    setTexture(null)
    setError(false)
    resolveRef.current(assetRef.current)
      .then((url) => new TextureLoader().loadAsync(url))
      .then((t) => {
        if (!live) { t.dispose(); return }
        t.colorSpace = SRGBColorSpace
        t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
        t.needsUpdate = true
        loaded = t
        setTexture(t)
      })
      .catch((e: unknown) => {
        if (!live) return
        console.warn('map image failed to load:', e)
        setError(true)
      })
    return () => {
      live = false
      loaded?.dispose()
    }
  }, [assetKey, gl])

  const frame = imageFrame(grid, image)
  const darkness = Math.min(1, Math.max(0, scene.darkness))
  return (
    <mesh rotation-x={-Math.PI / 2} position={[frame.cx, floorY + 0.004, frame.cz]} receiveShadow>
      <planeGeometry args={[frame.width, frame.height]} />
      {texture ? (
        // A touch of self-illumination keeps a dark scene's visible cells readable; token lights still add on top.
        <meshStandardMaterial map={texture} roughness={0.95} metalness={0} emissiveMap={texture} emissive="#ffffff" emissiveIntensity={0.08 + 0.22 * darkness} />
      ) : (
        <meshStandardMaterial color={error ? '#4a2f2a' : '#3a3630'} roughness={1} />
      )}
    </mesh>
  )
}

/**
 * The library's hover preview: one small shared WebGL canvas beside the hovered card, slowly
 * spinning its model. Loaded on the first hover (desktop only) and kept mounted afterwards, so
 * hovering card after card swaps the model instead of creating a canvas each time.
 */
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Box3, Group, Vector3 } from 'three'
import type { AssetRef } from '@/core/assets'
import type { CatalogueEntry } from '@/core/catalogue'
import { sizeBadge } from './libraryLogic'

const SIZE_PX = 220
/** Radians per second. */
const SPIN = 0.6

class Quiet extends Component<{ children: ReactNode; reset: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(prev: { reset: string }) { if (prev.reset !== this.props.reset && this.state.failed) this.setState({ failed: false }) }
  render() { return this.state.failed ? null : this.props.children }
}

function Spinning({ url }: { url: string }) {
  const gltf = useGLTF(url)
  const group = useRef<Group>(null)
  const { object, scale, offset } = useMemo(() => {
    const o = gltf.scene.clone(true)
    const box = new Box3().setFromObject(o)
    const size = box.getSize(new Vector3())
    const centre = box.getCenter(new Vector3())
    const k = 1.6 / Math.max(size.x, size.y, size.z, 1e-3)
    return { object: o, scale: k, offset: [-centre.x * k, -centre.y * k, -centre.z * k] as [number, number, number] }
  }, [gltf])
  useFrame((_, dt) => { if (group.current) group.current.rotation.y += dt * SPIN })
  return (
    <group ref={group}>
      <group position={offset} scale={scale}><primitive object={object} /></group>
    </group>
  )
}

export default function HoverPreview({ entry, anchor, resolve }: { entry: CatalogueEntry | null; anchor: DOMRect | null; resolve(ref: AssetRef): Promise<string> }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    if (!entry) return
    let live = true
    const plain = !entry.model.enc && entry.model.sources[0]
    if (plain) setUrl(plain)
    else resolve(entry.model).then((u) => { if (live) setUrl(u) }, () => undefined)
    return () => { live = false }
  }, [entry, resolve])
  const visible = !!entry && !!anchor
  // Beside the card, on the side with room, kept on screen.
  const left = anchor ? (anchor.right + 12 + SIZE_PX < window.innerWidth ? anchor.right + 12 : Math.max(8, anchor.left - 12 - SIZE_PX)) : 0
  const top = anchor ? Math.min(Math.max(8, anchor.top + anchor.height / 2 - SIZE_PX / 2), window.innerHeight - SIZE_PX - 40) : 0
  return createPortal(
    <div className="lib-preview skin-paper" style={{ left, top, width: SIZE_PX, visibility: visible ? 'visible' : 'hidden' }} aria-hidden>
      <div className="lib-preview-canvas" style={{ height: SIZE_PX - 40 }}>
        <Canvas frameloop={visible ? 'always' : 'never'} dpr={[1, 1.5]} camera={{ position: [1.9, 1.3, 1.9], fov: 40 }} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}>
          <ambientLight intensity={1.4} />
          <directionalLight position={[3, 5, 2]} intensity={2.2} />
          <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#ffd6a0" />
          {url && (
            <Quiet reset={url}>
              <Suspense fallback={null}><Spinning url={url} /></Suspense>
            </Quiet>
          )}
        </Canvas>
      </div>
      {entry && (
        <div className="lib-preview-meta">
          <strong>{entry.title}</strong>
          <span className="muted small">{sizeBadge(entry.size)} · {entry.triangles.toLocaleString()} tris</span>
        </div>
      )}
    </div>,
    document.body,
  )
}

/**
 * HUD variant of `DiceTray`: its own transparent `<Canvas>` stretched over the parent
 * element (which should be `position: relative/absolute`), camera looking slightly down
 * onto a tray sized to fill the viewport. Pointer events pass through to the UI below.
 */
import { useLayoutEffect, useState, type CSSProperties } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { DiceTray, type DiceTrayProps } from './DiceTray'

export interface DiceTrayOverlayProps extends Omit<DiceTrayProps, 'position' | 'size' | 'floor'> {
  className?: string
  style?: CSSProperties
  /** Camera pitch from straight down, in degrees. Default 20. */
  tilt?: number
  /** Default 'shadow': dice drop shadows onto the UI with no visible floor. */
  floor?: DiceTrayProps['floor']
  /** Fraction of the visible floor the tray occupies. Default 0.9. */
  fill?: number
}

interface Fit { size: [number, number]; z: number }

/** Sizes the tray to the rectangle of the y=0 plane visible from the camera. */
function fitTray(camera: PerspectiveCamera, fill: number): Fit {
  camera.updateMatrixWorld()
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y]) => {
    const p = new Vector3(x, y, 0.5).unproject(camera)
    const dir = p.sub(camera.position).normalize()
    const t = -camera.position.y / dir.y
    return camera.position.clone().addScaledVector(dir, t)
  })
  const halfW = Math.min(...corners.map((c) => Math.abs(c.x)))
  const zNear = Math.max(corners[0].z, corners[1].z) // bottom of the screen
  const zFar = Math.min(corners[2].z, corners[3].z) // top of the screen
  const depth = Math.abs(zNear - zFar)
  return { size: [halfW * 2 * fill, depth * fill], z: (zNear + zFar) / 2 }
}

function Scene({ tilt, fill, dieSize = 0.5, shadows = true, ...tray }: Omit<DiceTrayOverlayProps, 'className' | 'style'> & { tilt: number; fill: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const viewport = useThree((s) => s.size)
  const [fit, setFit] = useState<Fit | null>(null)

  useLayoutEffect(() => {
    const h = dieSize * 26
    const rad = (tilt * Math.PI) / 180
    camera.position.set(0, h * Math.cos(rad), h * Math.sin(rad))
    camera.lookAt(0, 0, 0)
    camera.fov = 35
    camera.near = 0.1
    camera.far = h * 4
    camera.updateProjectionMatrix()
    setFit(fitTray(camera, fill))
  }, [camera, viewport.width, viewport.height, tilt, fill, dieSize])

  if (!fit) return null
  const [w, d] = fit.size
  const r = Math.max(w, d)
  return (
    <>
      <hemisphereLight args={['#fff5e6', '#5a4a3a', 0.9]} />
      <directionalLight
        position={[r * 0.3, r * 0.9, r * 0.4]}
        intensity={2.2}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
        shadow-camera-left={-r}
        shadow-camera-right={r}
        shadow-camera-top={r}
        shadow-camera-bottom={-r}
        shadow-camera-near={0.1}
        shadow-camera-far={r * 3}
      />
      <DiceTray {...tray} dieSize={dieSize} shadows={shadows} size={fit.size} position={[0, 0, fit.z]} />
    </>
  )
}

export function DiceTrayOverlay({ className, style, tilt = 20, fill = 0.9, floor = 'shadow', ...rest }: DiceTrayOverlayProps) {
  return (
    <Canvas
      className={className}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'transparent', ...style }}
      gl={{ alpha: true, antialias: true, premultipliedAlpha: true }}
      dpr={[1, 2]}
      shadows={rest.shadows !== false}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
    >
      <Scene {...rest} tilt={tilt} fill={fill} floor={floor} />
    </Canvas>
  )
}

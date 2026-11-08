/**
 * HUD variant of `DiceTray`: its own transparent `<Canvas>` stretched over the parent
 * element (which should be `position: relative/absolute`), camera looking slightly down
 * onto a tray sized to fill the viewport. Pointer events pass through to the UI below.
 *
 * Once the dice settle the roll toast's total pops (choreography.ts), the dice stay for `lingerMs`
 * (shorter on phones), then fade out over `fadeMs`; on phones they instead shrink into the toast
 * (`yieldTo`), and `yieldNow` sends them off at once. Phones get smaller dice (`zoom` 0.7). When the viewer has
 * asked to skip 3D dice, or the system prefers reduced motion, nothing is drawn and `onSettled`
 * fires at once so the parent can clear the roll.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { DiceTray, type DiceTrayProps } from './DiceTray'
import { useMatchMedia, useSkipDice } from './skipDice'
import { announceDiceSettled, PHONE_LINGER_MS, YIELD_MS, yieldTransform } from './choreography'

export interface DiceTrayOverlayProps extends Omit<DiceTrayProps, 'position' | 'size' | 'floor'> {
  className?: string
  style?: CSSProperties
  /** Camera pitch from straight down, in degrees. Default 20. */
  tilt?: number
  /** Default 'shadow': dice drop shadows onto the UI with no visible floor. */
  floor?: DiceTrayProps['floor']
  /** Fraction of the visible floor the tray occupies. Default 0.9. */
  fill?: number
  /** Apparent die size relative to the default; defaults to 0.7 on phones, 1 elsewhere. */
  zoom?: number
  /** How long settled dice stay fully visible before fading. Default 3000. */
  lingerMs?: number
  /** Fade-out duration after `lingerMs`. Default 1000. Parents clearing `rollId` should wait linger + fade. */
  fadeMs?: number
  /** Phones: where the settled dice shrink to (the roll toast's box); null or missing fades instead. */
  yieldTo?(): DOMRect | null
  /** Get out of the way now (the chat keyboard or a full sheet needs the room). */
  yieldNow?: boolean
  /** Settled dice stay (no linger, fade or yield): the parent clears them by dropping `rolls`. */
  accumulate?: boolean
}

interface Fit { size: [number, number]; z: number }

/** Viewports below this are phones: smaller dice so they do not cover the whole table. */
export const PHONE_QUERY = '(max-width: 699px)'
export const PHONE_ZOOM = 0.7

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

type SceneProps = Omit<DiceTrayOverlayProps, 'className' | 'style' | 'zoom' | 'lingerMs' | 'fadeMs' | 'yieldTo' | 'yieldNow' | 'accumulate'> & { tilt: number; fill: number; zoom: number }

function Scene({ tilt, fill, zoom, dieSize = 0.5, shadows = true, ...tray }: SceneProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const viewport = useThree((s) => s.size)
  const [fit, setFit] = useState<Fit | null>(null)

  useLayoutEffect(() => {
    // The camera height scales with the die, so the die's on-screen size is constant; `zoom` pulls it back.
    const h = (dieSize * 26) / zoom
    const rad = (tilt * Math.PI) / 180
    camera.position.set(0, h * Math.cos(rad), h * Math.sin(rad))
    camera.lookAt(0, 0, 0)
    camera.fov = 35
    camera.near = 0.1
    camera.far = h * 4
    camera.updateProjectionMatrix()
    setFit(fitTray(camera, fill))
  }, [camera, viewport.width, viewport.height, tilt, fill, dieSize, zoom])

  if (!fit) return null
  const [w, d] = fit.size
  const r = Math.max(w, d)
  return (
    <>
      <hemisphereLight args={['#fff5e6', '#6a5a4a', 1.4]} />
      <directionalLight
        position={[r * 0.3, r * 0.9, r * 0.4]}
        intensity={2.6}
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

export function DiceTrayOverlay({ className, style, tilt = 20, fill = 0.9, floor = 'shadow', zoom, lingerMs = 3000, fadeMs = 1000, onSettled, yieldTo, yieldNow = false, accumulate = false, ...rest }: DiceTrayOverlayProps) {
  const skip = useSkipDice()
  const phone = useMatchMedia(PHONE_QUERY)
  const z = zoom ?? (phone ? PHONE_ZOOM : 1)
  // The throw that leaving and skipping follow: the newest one.
  const newest = rest.rolls ? (rest.rolls.at(-1)?.id ?? null) : (rest.rollId ?? null)

  // Leaving: full opacity while rolling and lingering, then a fade, or on phones a shrink into the
  // roll toast (`yieldTransform`); a new roll resets it.
  const [leave, setLeave] = useState<{ kind: 'fade' } | { kind: 'yield'; transform: string } | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef({ onSettled, lingerMs, phone, yieldTo })
  latest.current = { onSettled, lingerMs, phone, yieldTo }
  useEffect(() => {
    setLeave(null)
    clearTimeout(timer.current)
    return () => clearTimeout(timer.current)
  }, [newest])

  const goAway = () => {
    clearTimeout(timer.current)
    const { phone: onPhone, yieldTo: target } = latest.current
    const to = onPhone ? target?.() : null
    const from = canvas.current?.getBoundingClientRect()
    setLeave(to && from && from.width > 0 ? { kind: 'yield', transform: yieldTransform(from, to) } : { kind: 'fade' })
  }
  // The keyboard or a full sheet needs the room: yield now.
  useEffect(() => { if (yieldNow && newest && !accumulate) goAway() }, [yieldNow, newest, accumulate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Skipping: report the roll as settled straight away so the parent clears it on its usual schedule.
  useEffect(() => {
    if (skip && newest) { latest.current.onSettled?.(newest); announceDiceSettled(newest) }
  }, [skip, newest])

  if (skip) return null

  const settled = (id: string) => {
    latest.current.onSettled?.(id)
    announceDiceSettled(id)
    if (accumulate) return
    clearTimeout(timer.current)
    timer.current = setTimeout(goAway, latest.current.phone ? Math.min(PHONE_LINGER_MS, latest.current.lingerMs) : latest.current.lingerMs)
  }

  const leaving = leave !== null
  return (
    <Canvas
      ref={canvas}
      className={className}
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', background: 'transparent',
        opacity: leaving ? 0 : 1,
        transform: leave?.kind === 'yield' ? leave.transform : undefined, transformOrigin: 'center',
        transition: leave?.kind === 'yield'
          ? `transform ${YIELD_MS}ms cubic-bezier(.5, 0, .75, 0), opacity ${YIELD_MS}ms ease-in`
          : `opacity ${fadeMs}ms ease`,
        ...style,
      }}
      gl={{ alpha: true, antialias: true, premultipliedAlpha: true }}
      dpr={[1, 2]}
      shadows={rest.shadows !== false}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
    >
      <Scene {...rest} tilt={tilt} fill={fill} zoom={z} floor={floor} onSettled={settled} />
    </Canvas>
  )
}

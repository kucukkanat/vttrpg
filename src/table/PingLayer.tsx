/**
 * Pings: "look here" rings on the floor that every client sees for two seconds, with the pinger's
 * name over the spot for a moment. Mounted inside the <Canvas>.
 *
 * Sending: double-tap / double-click an empty floor spot, hold a finger on empty floor for half a
 * second while no tool is active, or arm one with the HUD's Ping button (`tableUi.tool === 'ping'`)
 * and tap anywhere. A ping goes out as `presence.ping` through the table's `onPresence` (ephemeral,
 * encrypted, never stored) and is dropped from the presence a few seconds later; the sender plays
 * it locally at once. Receiving: the controller emits `vfxBus` 'ping' for each new ping it sees
 * (see ping.ts `takePing`); this layer plays the ones for the current scene with the RingEffect.
 *
 * The double tap uses the canvas's `onPointerMissed` (a click that hit nothing interactive): the
 * table calls `pingMissed` from there. The long press listens on the window so it runs after the
 * canvas's own pointer-down handling and can ask R3F what the press landed on.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { PresencePing } from '@/core/presence'
import { useGame } from '@/state/store'
import { useTable } from './context'
import type { Bounds2 } from './grid'
import {
  DOUBLE_TAP_MS, isDoubleTap, LONG_PRESS_MS, PING_CLEAR_MS, PING_DURATION_MS, PING_LABEL_MS, PRESS_SLOP_PX, type PingEvent, type Tap,
} from './ping'
import { FloorCatcher, FloorLabel, floorPoint } from './RulerLayer'
import { useTableUi } from './tableState'
import { doubleTapEdit } from './editTap'
import { vfxBus } from './vfx/bus'
import { RingEffect } from './vfx/presets/RingEffect'
import type { ScheduledEffect } from './vfx/schedule'

const DEFAULT_COLOR = '#7cc4ff'
/** Ring pulses per ping: start offset and length, within PING_DURATION_MS. */
const PULSES: { delay: number; duration: number }[] = [{ delay: 0, duration: 1100 }, { delay: 450, duration: 1100 }, { delay: 900, duration: 1100 }]

type MissHandler = (e: MouseEvent) => void
let missHandler: MissHandler | null = null

/** The table's `onPointerMissed` calls this: a click on the floor that hit no token, prop or handle. */
export function pingMissed(e: MouseEvent): void {
  missHandler?.(e)
}

interface ActivePing extends PingEvent { key: string }

export function PingLayer({ bounds }: { bounds: Bounds2 }) {
  const { sceneId, floorY, viewer, onPresence } = useTable()
  const armed = useTableUi((s) => s.tool === 'ping')
  const uiSet = useTableUi((s) => s.set)
  const myColor = useGame((s) => (viewer ? s.presence[viewer.pubkey]?.color : undefined)) ?? DEFAULT_COLOR
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const internal = useThree((s) => s.internal)
  const [pings, setPings] = useState<ActivePing[]>([])
  const seq = useRef(0)

  const play = useCallback((p: PingEvent) => {
    const key = `${p.pubkey}:${p.at}:${seq.current++}`
    setPings((list) => [...list, { ...p, key }].slice(-12))
  }, [])

  // Pings from the others, for this scene only.
  useEffect(() => vfxBus.on('ping', (p) => { if (p.scene === sceneId) play(p) }), [sceneId, play])

  const scratch = useMemo(() => ({ plane: new Plane(new Vector3(0, 1, 0), -floorY), hit: new Vector3(), ray: new Raycaster(), ndc: new Vector2() }), [floorY])
  /** Floor point under client pixel coordinates, through the table camera. */
  const floorAt = useCallback((clientX: number, clientY: number): { x: number; z: number } | null => {
    const rect = gl.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    scratch.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    scratch.ray.setFromCamera(scratch.ndc, camera)
    scratch.plane.set(scratch.plane.normal, -floorY)
    if (!scratch.ray.ray.intersectPlane(scratch.plane, scratch.hit)) return null
    return { x: scratch.hit.x, z: scratch.hit.z }
  }, [gl, camera, floorY, scratch])

  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const send = useCallback((p: { x: number; z: number }) => {
    const ping: PresencePing = { x: p.x, z: p.z, scene: sceneId, at: Date.now(), color: myColor }
    onPresence({ ping })
    // Beacons would keep carrying it; take it back out once everyone has had a chance to see it.
    if (clearTimer.current) clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => { clearTimer.current = null; onPresence({ ping: undefined }) }, PING_CLEAR_MS)
    play({ ...ping, pubkey: viewer?.pubkey ?? ('' as PingEvent['pubkey']), name: 'You' })
  }, [sceneId, myColor, onPresence, play, viewer])
  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current) }, [])

  /** Gestures only while nothing else owns the pointer. */
  const gesturesFree = () => {
    const ui = useTableUi.getState()
    return ui.tool === null && ui.targeting === null && !ui.editDrag && ui.grab === null && ui.drag === null
  }

  // Double tap: two missed clicks close together.
  const lastTap = useRef<Tap | null>(null)
  const suppressClickUntil = useRef(0)
  useEffect(() => {
    missHandler = (e) => {
      if (e.type !== 'click' || e.button !== 0 || !gesturesFree()) return
      const now = performance.now()
      if (now < suppressClickUntil.current) return
      const tap: Tap = { x: e.clientX, y: e.clientY, at: now }
      if (isDoubleTap(lastTap.current, tap)) {
        lastTap.current = null
        // While editing, a double tap on empty table ends edit mode instead of pinging.
        if (useTableUi.getState().editMode) { doubleTapEdit(null); return }
        const p = floorAt(e.clientX, e.clientY)
        if (p) send(p)
      } else {
        lastTap.current = tap
      }
    }
    return () => { missHandler = null }
  }, [floorAt, send])

  // Long press (touch): a steady primary finger on empty floor for LONG_PRESS_MS.
  useEffect(() => {
    let press: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null
    const cancel = () => { if (press) { clearTimeout(press.timer); press = null } }
    const onDown = (e: PointerEvent) => {
      if (press) { cancel(); return } // a second finger: a pinch or pan, not a press
      if (e.pointerType !== 'touch' || !e.isPrimary || e.button !== 0) return
      if (!gl.domElement.contains(e.target as Node | null)) return
      // Runs after the canvas handled the pointer-down: anything interactive under it is already recorded.
      if (internal.initialHits.length || !gesturesFree()) return
      const x = e.clientX
      const y = e.clientY
      press = {
        id: e.pointerId, x, y,
        timer: setTimeout(() => {
          press = null
          if (!gesturesFree()) return
          const p = floorAt(x, y)
          if (!p) return
          suppressClickUntil.current = performance.now() + DOUBLE_TAP_MS * 2
          lastTap.current = null
          send(p)
        }, LONG_PRESS_MS),
      }
    }
    const onMove = (e: PointerEvent) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP_PX) cancel()
    }
    const onEnd = (e: PointerEvent) => { if (press && e.pointerId === press.id) cancel() }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      cancel()
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [gl, internal, floorAt, send])

  // Armed by the HUD: the next tap anywhere on the floor pings and disarms. Esc disarms.
  const armedDown = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const onArmedDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button === 2) { e.stopPropagation(); uiSet({ tool: null }); return }
    if (e.button !== 0) return
    e.stopPropagation()
    armedDown.current = { pointerId: e.pointerId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }
  }
  const onArmedUp = (e: ThreeEvent<PointerEvent>) => {
    const d = armedDown.current
    if (!d || e.pointerId !== d.pointerId) return
    armedDown.current = null
    e.stopPropagation()
    if (Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y) > PRESS_SLOP_PX) return // a camera gesture, stay armed
    const p = floorPoint(e, floorY, scratch)
    uiSet({ tool: null })
    if (p) send(p)
  }
  useEffect(() => {
    if (!armed) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') uiSet({ tool: null }) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [armed, uiSet])

  const finish = useCallback((key: string) => setPings((list) => (list.some((p) => p.key === key) ? list.filter((p) => p.key !== key) : list)), [])

  return (
    <group>
      {armed && <FloorCatcher bounds={bounds} onPointerDown={onArmedDown} onPointerUp={onArmedUp} onPointerCancel={() => { armedDown.current = null }} />}
      {pings.map((p) => <PingMarker key={p.key} ping={p} onDone={() => finish(p.key)} />)}
    </group>
  )
}

/** One ping: staggered ring pulses at the spot plus the sender's name for PING_LABEL_MS. */
function PingMarker({ ping, onDone }: { ping: ActivePing; onDone(): void }) {
  const { grid, floorY } = useTable()
  const [label, setLabel] = useState(true)
  const [started, setStarted] = useState(() => PULSES.map((p) => p.delay === 0))
  useEffect(() => {
    const timers = PULSES.map((p, i) => (p.delay > 0 ? setTimeout(() => setStarted((s) => s.map((v, j) => (j === i ? true : v))), p.delay) : null))
    const hide = setTimeout(() => setLabel(false), PING_LABEL_MS)
    const done = setTimeout(onDone, PING_DURATION_MS + 400)
    return () => { for (const t of timers) if (t) clearTimeout(t); clearTimeout(hide); clearTimeout(done) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const ground = useMemo(() => ({ x: ping.x, y: floorY, z: ping.z }), [ping.x, ping.z, floorY])
  const effects = useMemo<ScheduledEffect[]>(() => PULSES.map((p, i) => ({
    key: `${ping.key}:${i}`, eventId: ping.key, preset: 'ring', fireAt: 0,
    from: { kind: 'point', ground, chest: ground }, to: null,
    color: ping.color, duration: p.duration, radius: 1.4 * grid.cellSize, strength: 0, cellSize: grid.cellSize,
  })), [ping.key, ping.color, ground, grid.cellSize])
  return (
    <group>
      {effects.map((e, i) => started[i] && <RingEffect key={e.key} effect={e} onDone={() => {}} />)}
      {label && <FloorLabel x={ping.x} y={floorY + 0.5 * grid.cellSize} z={ping.z} color={ping.color}>{ping.name}</FloorLabel>}
    </group>
  )
}

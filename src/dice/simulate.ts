/**
 * Deterministic dice throw, pre-simulated with Rapier and recorded as a pose track per die.
 *
 * Why pre-simulate instead of correcting live bodies?
 *  - The final up face is known before the first frame renders, so the visual mesh gets a
 *    constant rotation offset (a symmetry of the polyhedron, see `symmetryRotation`) at spawn.
 *    Nothing is ever swapped mid-flight; the shape stays exactly on the collider and only the
 *    printed numbers differ. There is no moment where a correction could be noticed.
 *  - The throw derives from `rollId` through a seeded PRNG, and Rapier (non-SIMD wasm, fixed
 *    timestep, same body insertion order) is deterministic across machines, so every client
 *    sees the same tumble. Even if a platform disagreed, each client still lands on the
 *    committed values because the offset is computed from its own simulation.
 *  - Playback is a cheap interpolation, independent of frame rate and of whatever physics
 *    world the table runs. Good for iPad and for mounting inside someone else's `<Canvas>`.
 *
 * The world is self-contained (tray colliders + dice) and freed after recording. A roll of
 * five dice records a few seconds at 60 Hz in well under 50 ms on a laptop.
 */
import RAPIER from '@dimforge/rapier3d-compat'
import { Quaternion, Vector3 } from 'three'
import {
  dieDef,
  hullPoints,
  readingForValue,
  symmetryRotation,
  upFlatness,
  upReading,
  type PhysicalDie,
} from './geometry'

export interface ThrowParams {
  /** Seed for the throw (the roll id). Same seed, same tumble. */
  seed: string
  dice: PhysicalDie[]
  /** Circumradius of a unit die in world units. Everything else scales with it. */
  dieSize: number
  /** Inner tray size, centred on the origin, floor at y = 0. */
  tray: { width: number; depth: number }
}

export interface DieTrack {
  die: PhysicalDie
  /** xyz per step. */
  positions: Float32Array
  /** xyzw per step. */
  rotations: Float32Array
  /** Visual mesh rotation relative to the body so the committed value ends up on top. */
  offset: Quaternion
}

export interface RollRecording {
  dt: number
  steps: number
  duration: number
  tracks: DieTrack[]
  /** Collision strengths in [0, 1], one entry at most per step. */
  impacts: { step: number; strength: number }[]
}

export const SIM_DT = 1 / 60
const MAX_STEPS = 60 * 12
const REST_STEPS = 24
const TAIL_STEPS = 12
/** Cosine threshold (about 8 degrees) under which a resting die counts as cocked and gets re-thrown. */
const FLAT_COS = 0.99
const MAX_NUDGES = 8
/** A real d20 is about 12 mm circumradius; gravity scales so big HUD dice fall like real ones. */
const REAL_DIE_RADIUS = 0.012
/** Dice read better a bit slower than life; gravity is scaled down by this factor. */
const SLOW_MOTION = 0.22

/* ---------------------------------- PRNG ---------------------------------- */

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** sfc32 seeded from the roll id. Returns floats in [0, 1). */
export function seededRandom(seed: string): () => number {
  let a = fnv1a(seed + ':a'), b = fnv1a(seed + ':b'), c = fnv1a(seed + ':c'), d = fnv1a(seed + ':d')
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  for (let i = 0; i < 12; i++) next()
  return next
}

/* -------------------------------- Rapier init ------------------------------ */

let ready: Promise<typeof RAPIER> | null = null
export function rapierReady(): Promise<typeof RAPIER> {
  if (!ready) ready = RAPIER.init().then(() => RAPIER)
  return ready
}

/* -------------------------------- Simulation ------------------------------- */

export async function simulateRoll(params: ThrowParams): Promise<RollRecording> {
  await rapierReady()
  return simulateRollSync(params)
}

/** Requires `rapierReady()` to have resolved. */
export function simulateRollSync(params: ThrowParams): RollRecording {
  const { seed, dice, dieSize, tray } = params
  const rnd = seededRandom(seed)
  const range = (lo: number, hi: number) => lo + (hi - lo) * rnd()
  const g = 9.81 * (dieSize / REAL_DIE_RADIUS) * SLOW_MOTION

  const world = new RAPIER.World({ x: 0, y: -g, z: 0 })
  world.timestep = SIM_DT
  world.lengthUnit = dieSize / REAL_DIE_RADIUS
  const events = new RAPIER.EventQueue(true)

  // Tray: floor, four walls, lid. Thick so fast dice cannot tunnel.
  const hw = tray.width / 2, hd = tray.depth / 2
  const wallH = dieSize * 16, thick = dieSize * 4
  const fixed = (desc: RAPIER.ColliderDesc) =>
    world.createCollider(desc.setFriction(0.7).setRestitution(0.25), world.createRigidBody(RAPIER.RigidBodyDesc.fixed()))
  fixed(RAPIER.ColliderDesc.cuboid(hw + thick, thick, hd + thick).setTranslation(0, -thick, 0))
  fixed(RAPIER.ColliderDesc.cuboid(hw + thick, thick, hd + thick).setTranslation(0, wallH + thick, 0))
  fixed(RAPIER.ColliderDesc.cuboid(thick, wallH, hd + thick).setTranslation(hw + thick, wallH / 2, 0))
  fixed(RAPIER.ColliderDesc.cuboid(thick, wallH, hd + thick).setTranslation(-hw - thick, wallH / 2, 0))
  fixed(RAPIER.ColliderDesc.cuboid(hw + thick, wallH, thick).setTranslation(0, wallH / 2, hd + thick))
  fixed(RAPIER.ColliderDesc.cuboid(hw + thick, wallH, thick).setTranslation(0, wallH / 2, -hd - thick))

  // Throw from one side toward the far side, dice fanned out across the throw direction.
  const side = Math.floor(rnd() * 4)
  const dir = new Vector3(side === 0 ? 1 : side === 1 ? -1 : 0, 0, side === 2 ? 1 : side === 3 ? -1 : 0)
  const across = new Vector3(-dir.z, 0, dir.x)
  const start = dir.clone().multiplyScalar(-(dir.x ? hw : hd) * 0.8)
  const speed = Math.sqrt(g * dieSize) * range(2.0, 2.8)
  const acrossHalf = dir.x ? hd : hw
  const laneGap = Math.min(dieSize * 2.6, (acrossHalf * 1.6) / Math.max(1, dice.length - 1))

  const bodies: RAPIER.RigidBody[] = []
  const handleToDie = new Map<number, number>()
  dice.forEach((die, i) => {
    const def = dieDef(die.type)
    const lane = (i - (dice.length - 1) / 2) * laneGap
    const pos = start.clone().addScaledVector(across, lane + range(-0.2, 0.2) * dieSize)
    pos.addScaledVector(dir, -(i % 2) * dieSize * 2.2) // stagger so tight lanes never overlap
    pos.y = dieSize * range(3, 5)
    const q = new Quaternion().setFromAxisAngle(new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), range(0, Math.PI * 2))
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(dir.x * speed + across.x * range(-0.15, 0.15) * speed, range(-0.1, 0.1) * speed, dir.z * speed + across.z * range(-0.15, 0.15) * speed)
        .setAngvel({ x: range(-1, 1), y: range(-1, 1), z: range(-1, 1) })
        .setLinearDamping(0.1)
        .setAngularDamping(0.2)
        .setCcdEnabled(true),
    )
    const spin = Math.sqrt(g / dieSize) * range(1.2, 2.2)
    const w = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(spin)
    body.setAngvel({ x: w.x, y: w.y, z: w.z }, true)
    const hull = RAPIER.ColliderDesc.convexHull(hullPoints(def, dieSize))
    if (!hull) throw new Error(`convex hull failed for ${die.type}`)
    const collider = world.createCollider(hull.setFriction(0.45).setRestitution(0.45).setDensity(1), body)
    collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
    collider.setContactForceEventThreshold(body.mass() * g * 1.5)
    handleToDie.set(collider.handle, i)
    bodies.push(body)
  })

  const n = dice.length
  const positions = dice.map(() => new Float32Array(MAX_STEPS * 3))
  const rotations = dice.map(() => new Float32Array(MAX_STEPS * 4))
  const impactByStep = new Map<number, number>()
  const restLin = 0.2 * dieSize, restAng = 0.5
  let restRun = 0
  let steps = 0
  let nudges = 0

  const record = (step: number) => {
    for (let i = 0; i < n; i++) {
      const t = bodies[i].translation(), r = bodies[i].rotation()
      positions[i].set([t.x, t.y, t.z], step * 3)
      rotations[i].set([r.x, r.y, r.z, r.w], step * 4)
    }
  }

  for (steps = 0; steps < MAX_STEPS; steps++) {
    record(steps)
    world.step(events)
    let maxStrength = 0
    events.drainContactForceEvents((e) => {
      const i = handleToDie.get(e.collider1()) ?? handleToDie.get(e.collider2())
      if (i === undefined) return
      const s = Math.min(1, e.maxForceMagnitude() / (bodies[i].mass() * g * 40))
      maxStrength = Math.max(maxStrength, s)
    })
    if (maxStrength > 0) impactByStep.set(steps, maxStrength)
    const resting = bodies.every((b) => {
      if (b.isSleeping()) return true
      const v = b.linvel(), w = b.angvel()
      return Math.hypot(v.x, v.y, v.z) < restLin && Math.hypot(w.x, w.y, w.z) < restAng
    })
    restRun = resting ? restRun + 1 : 0
    if (restRun >= REST_STEPS) {
      // Cocked dice (leaning on a wall or another die) get a nudge and keep going, like at a real
      // table. Still seeded, so still deterministic.
      const cocked = bodies.filter((b, i) => {
        const r = b.rotation()
        return upFlatness(dieDef(dice[i].type), new Quaternion(r.x, r.y, r.z, r.w)) < FLAT_COS
      })
      if (cocked.length === 0 || nudges >= MAX_NUDGES) { steps++; break }
      nudges++
      restRun = 0
      const hop = Math.sqrt(2 * g * dieSize * 3)
      for (const b of cocked) {
        b.setLinvel({ x: range(-0.4, 0.4) * hop, y: hop, z: range(-0.4, 0.4) * hop }, true)
        const spin = Math.sqrt(g / dieSize) * range(0.8, 1.6)
        b.setAngvel({ x: range(-1, 1) * spin, y: range(-1, 1) * spin, z: range(-1, 1) * spin }, true)
      }
    }
  }
  record(Math.min(steps, MAX_STEPS - 1))
  const baseSteps = Math.min(steps + 1, MAX_STEPS)

  // Final poses → visual offsets, plus a short tail that eases slightly cocked dice flat.
  const tracks: DieTrack[] = []
  const total = baseSteps + TAIL_STEPS
  for (let i = 0; i < n; i++) {
    const def = dieDef(dice[i].type)
    const last = baseSteps - 1
    const q = new Quaternion().fromArray(rotations[i], last * 4)
    const up = upReading(def, q)
    const offset = symmetryRotation(def, readingForValue(def, dice[i].value), up)

    const pos = new Float32Array(total * 3), rot = new Float32Array(total * 4)
    pos.set(positions[i].subarray(0, baseSteps * 3))
    rot.set(rotations[i].subarray(0, baseSteps * 4))
    const flat = new Quaternion()
    const flatness = upFlatness(def, q)
    if (flatness > 0.75 && flatness < 0.9999) {
      const nWorld = def.readings[up].normal.clone().applyQuaternion(q)
      flat.setFromUnitVectors(nWorld, new Vector3(0, 1, 0)).multiply(q)
    } else flat.copy(q)
    const tmp = new Quaternion()
    for (let s = 0; s < TAIL_STEPS; s++) {
      const k = (s + 1) / TAIL_STEPS
      tmp.copy(q).slerp(flat, k * k * (3 - 2 * k))
      pos.set(positions[i].subarray(last * 3, last * 3 + 3), (baseSteps + s) * 3)
      rot.set([tmp.x, tmp.y, tmp.z, tmp.w], (baseSteps + s) * 4)
    }
    tracks.push({ die: dice[i], positions: pos, rotations: rot, offset })
  }

  events.free()
  world.free()

  return {
    dt: SIM_DT,
    steps: total,
    duration: (total - 1) * SIM_DT,
    tracks,
    impacts: [...impactByStep.entries()].map(([step, strength]) => ({ step, strength })).sort((a, b) => a.step - b.step),
  }
}

/** Pose of one track at time `t` (seconds), interpolated between recorded steps. */
export function samplePose(rec: RollRecording, track: DieTrack, t: number, outPos: Vector3, outRot: Quaternion): void {
  const f = Math.max(0, Math.min(rec.steps - 1, t / rec.dt))
  const i0 = Math.floor(f), i1 = Math.min(rec.steps - 1, i0 + 1), k = f - i0
  const p = track.positions, r = track.rotations
  outPos.set(
    p[i0 * 3] + (p[i1 * 3] - p[i0 * 3]) * k,
    p[i0 * 3 + 1] + (p[i1 * 3 + 1] - p[i0 * 3 + 1]) * k,
    p[i0 * 3 + 2] + (p[i1 * 3 + 2] - p[i0 * 3 + 2]) * k,
  )
  outRot.set(r[i0 * 4], r[i0 * 4 + 1], r[i0 * 4 + 2], r[i0 * 4 + 3])
  if (k > 0 && i1 !== i0) outRot.slerp(new Quaternion(r[i1 * 4], r[i1 * 4 + 1], r[i1 * 4 + 2], r[i1 * 4 + 3]), k)
  // visual = body · offset
  outRot.multiply(track.offset)
}

/**
 * Plays `GameEvent`s of kind 'vfx' once each. New events are planned into scheduled effects
 * (pure, see schedule.ts); a per-frame check spawns the ones whose time has come; each effect
 * component removes itself when finished. `shake` goes out through `vfxBus`, `sound` is left to
 * the audio module. An event's `numbers` (resource deltas) become floating damage and heal numbers
 * over the tokens, planned by `numbers.ts` and drawn by `FloatingNumber`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { GameEvent } from '@/core/doc'
import { useGame } from '@/state/store'
import { vfxBus } from './bus'
import { AuraEffect } from './presets/AuraEffect'
import { BeamEffect } from './presets/BeamEffect'
import { clamp01, useLifetime } from './presets/common'
import { FloatingNumber } from './presets/FloatingNumber'
import { HitEffect } from './presets/HitEffect'
import { ProjectileEffect } from './presets/ProjectileEffect'
import { RingEffect } from './presets/RingEffect'
import { planNumbers, type FloatingNumberSpec } from './numbers'
import { planEvent, prunePlayed, splitDue, takeNewEvents, type ScheduledEffect } from './schedule'
import { Rain } from './weather/Rain'

export interface VfxLayerProps {
  /** Events from the store; the layer plays each 'vfx' event once (keyed by id) and ignores events older than `since`. */
  events: GameEvent[]
  since: number
  /** Scene cell size, for scaling presets. */
  cellSize: number
  /** Upper bound on simultaneously running effects; the oldest are dropped beyond it. Default 48. */
  maxActive?: number
}

export function VfxLayer({ events, since, cellSize, maxActive = 48 }: VfxLayerProps) {
  const played = useRef(new Set<string>())
  const pending = useRef<ScheduledEffect[]>([])
  const [active, setActive] = useState<ScheduledEffect[]>([])
  const pendingNumbers = useRef<FloatingNumberSpec[]>([])
  const [numbers, setNumbers] = useState<FloatingNumberSpec[]>([])

  useEffect(() => {
    const fresh = takeNewEvents(events, since, played.current)
    prunePlayed(events, played.current)
    if (!fresh.length) return
    const tokens = useGame.getState().tokens
    const now = performance.now()
    for (const ev of fresh) {
      pending.current.push(...planEvent(ev, tokens, cellSize, now))
      pendingNumbers.current.push(...planNumbers(ev, tokens, cellSize, now))
    }
    pending.current.sort((a, b) => a.fireAt - b.fireAt)
    pendingNumbers.current.sort((a, b) => a.fireAt - b.fireAt)
  }, [events, since, cellSize])

  useFrame(() => {
    const now = performance.now()
    if (pending.current.length) {
      const { due, pending: rest } = splitDue(pending.current, now)
      if (due.length) {
        pending.current = rest
        const visual: ScheduledEffect[] = []
        for (const e of due) {
          if (e.preset === 'shake') vfxBus.emit('shake', e.strength, e.duration)
          else if (e.preset !== 'sound') visual.push(e)
        }
        if (visual.length) setActive((a) => [...a, ...visual].slice(-maxActive))
      }
    }
    if (pendingNumbers.current.length) {
      const { due, pending: rest } = splitDue(pendingNumbers.current, now)
      if (due.length) {
        pendingNumbers.current = rest
        setNumbers((n) => [...n, ...due].slice(-maxActive))
      }
    }
  })

  const finish = useCallback((key: string) => setActive((a) => (a.some((e) => e.key === key) ? a.filter((e) => e.key !== key) : a)), [])
  const finishNumber = useCallback((key: string) => setNumbers((n) => (n.some((e) => e.key === key) ? n.filter((e) => e.key !== key) : n)), [])

  return (
    <>
      {active.map((e) => <Effect key={e.key} effect={e} onDone={() => finish(e.key)} />)}
      {numbers.map((n) => <FloatingNumber key={n.key} spec={n} onDone={() => finishNumber(n.key)} />)}
    </>
  )
}

function Effect({ effect, onDone }: { effect: ScheduledEffect; onDone: () => void }) {
  switch (effect.preset) {
    case 'hit': return <HitEffect effect={effect} onDone={onDone} />
    case 'projectile': return <ProjectileEffect effect={effect} onDone={onDone} />
    case 'ring': return <RingEffect effect={effect} onDone={onDone} />
    case 'aura': return <AuraEffect effect={effect} onDone={onDone} />
    case 'beam': return <BeamEffect effect={effect} onDone={onDone} />
    case 'rain': return <LocalRain effect={effect} onDone={onDone} />
    default: return <Expire effect={effect} onDone={onDone} />
  }
}

/** A short shower over a 5x5-cell box around the anchor, fading in and out. */
function LocalRain({ effect, onDone }: { effect: ScheduledEffect; onDone: () => void }) {
  const [intensity, setIntensity] = useState(0)
  const g = effect.from!.ground
  const r = effect.cellSize * 2.5
  const bounds = useRef({ min: [g.x - r, g.y, g.z - r] as [number, number, number], max: [g.x + r, g.y + effect.cellSize * 2.5, g.z + r] as [number, number, number] })
  const last = useRef(-1)
  useLifetime(effect.duration, (t) => {
    const env = Math.min(clamp01(t / 0.2), clamp01((1 - t) / 0.3))
    // Only re-render on visible change.
    const q = Math.round(env * 20) / 20
    if (q !== last.current) { last.current = q; setIntensity(q) }
  }, onDone)
  return <Rain bounds={bounds.current} density={0.6} intensity={intensity} color={effect.color} />
}

/** Fallback for presets without visuals: just expires after the duration. */
function Expire({ effect, onDone }: { effect: ScheduledEffect; onDone: () => void }) {
  useLifetime(effect.duration, () => {}, onDone)
  return null
}

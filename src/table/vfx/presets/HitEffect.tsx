/** `hit`: a burst of sparks plus a brief flash at the target's chest. */
import type { ScheduledEffect } from '../schedule'
import { Burst } from './Burst'
import { Flash } from './Flash'

export function HitEffect({ effect, onDone }: { effect: ScheduledEffect; onDone: () => void }) {
  const c = effect.from!.chest
  const cell = effect.cellSize
  return (
    <>
      <Burst center={c} color={effect.color} count={56} durationMs={effect.duration} speed={cell * 2.6} size={cell * 0.1} gravity={cell * 3} drag={3} jitter={cell * 0.18} onDone={onDone} />
      <Flash center={c} color={effect.color} size={cell * 1.1} durationMs={Math.min(200, effect.duration * 0.7)} />
    </>
  )
}

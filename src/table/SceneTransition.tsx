/**
 * DOM overlays of the table that outlive a scene swap (styles in SceneTransition.css):
 *
 * - `SceneTransition`: the fade between scenes. Driven by `tableState.transition`; this component
 *   owns the clocks (fade out, fade in, a safety limit on loading) and reports each tick back as a
 *   `SceneTransitionEvent`, while TableCanvas reports the scene change and the load. Honours
 *   prefers-reduced-motion: the swap is instant and the name is shown briefly instead of fading.
 * - `ScenePreviewBar`: "Previewing Forest clearing · Switch for everyone / Back to live", shown to
 *   the GM while `tableState.previewScene` differs from the live scene.
 */
import { useEffect, useRef, useState } from 'react'
import type { SceneTransition as SceneTransitionState, SceneTransitionEvent } from './tableState'
import './SceneTransition.css'

/** Length of each fade; matches the CSS animations. */
export const FADE_MS = 300
/** Reduced motion: how long the name stays on the new scene once it has loaded. */
export const NAME_HOLD_MS = 700
/** A scene that never reports its load is revealed anyway after this long, so nobody is left on black. */
export const SWAP_TIMEOUT_MS = 10_000

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** `window.matchMedia(query).matches`, kept current; false where matchMedia is missing (tests). */
function useMatchMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [match, setMatch] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/** How long each phase lasts before the overlay reports the next event. */
export function phaseDuration(phase: SceneTransitionState['phase'], reducedMotion: boolean): number {
  switch (phase) {
    case 'out': return reducedMotion ? 0 : FADE_MS
    case 'swap': return SWAP_TIMEOUT_MS
    case 'in': return reducedMotion ? NAME_HOLD_MS : FADE_MS
  }
}

/** The event a phase's clock produces when it runs out. */
export function phaseTimeout(t: SceneTransitionState): SceneTransitionEvent {
  switch (t.phase) {
    case 'out': return { type: 'covered' }
    case 'swap': return { type: 'loaded', scene: t.to }
    case 'in': return { type: 'revealed' }
  }
}

export interface SceneTransitionProps {
  transition: SceneTransitionState | null
  onEvent(e: SceneTransitionEvent): void
  /** Overrides the media query (tests, stories). */
  reducedMotion?: boolean
}

export function SceneTransition({ transition, onEvent, reducedMotion }: SceneTransitionProps) {
  const systemReduced = useMatchMedia(REDUCED_MOTION)
  const reduced = reducedMotion ?? systemReduced
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const transitionRef = useRef(transition)
  transitionRef.current = transition
  const phase = transition?.phase ?? null
  // One clock per phase. A retarget during a phase (`to` changes) keeps the running clock, so a
  // GM flicking through scenes does not restart the fade each time.
  useEffect(() => {
    if (!phase) return
    const t = transitionRef.current
    if (!t) return
    const timer = setTimeout(() => {
      const now = transitionRef.current
      if (now && now.phase === phase) onEventRef.current(phaseTimeout(now))
    }, phaseDuration(phase, reduced))
    return () => clearTimeout(timer)
  }, [phase, reduced])

  if (!transition) return null
  const cls = `scene-transition scene-transition--${transition.phase}${reduced ? ' scene-transition--reduced' : ''}`
  return (
    <div className={cls} aria-hidden={transition.phase === 'in' ? undefined : false}>
      <p className="scene-transition__name" role="status" aria-live="polite">{transition.name}</p>
      {transition.phase === 'swap' && <div className="scene-transition__hint" aria-hidden="true">Loading…</div>}
    </div>
  )
}

export interface ScenePreviewBarProps {
  name: string
  /** Make the previewed scene live for everyone. */
  onSwitch(): void
  /** Stop previewing; the table shows the live scene again. */
  onBack(): void
}

export function ScenePreviewBar({ name, onSwitch, onBack }: ScenePreviewBarProps) {
  return (
    <div className="scene-preview-bar" role="region" aria-label="Scene preview">
      <span className="scene-preview-bar__text">Previewing <b>{name}</b></span>
      <div className="scene-preview-bar__actions">
        <button type="button" className="scene-preview-bar__btn scene-preview-bar__btn--primary" onClick={onSwitch}>Switch for everyone</button>
        <button type="button" className="scene-preview-bar__btn" onClick={onBack}>Back to live</button>
      </div>
    </div>
  )
}

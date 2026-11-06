import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SceneId } from '@/core/ids'
import { FADE_MS, NAME_HOLD_MS, phaseDuration, phaseTimeout, ScenePreviewBar, SceneTransition, SWAP_TIMEOUT_MS } from './SceneTransition'

const forest = 'forest' as SceneId

describe('SceneTransition clocks', () => {
  it('fades for 300 ms each way and gives a stuck load a limit', () => {
    expect(phaseDuration('out', false)).toBe(FADE_MS)
    expect(phaseDuration('in', false)).toBe(FADE_MS)
    expect(phaseDuration('swap', false)).toBe(SWAP_TIMEOUT_MS)
    expect(FADE_MS).toBe(300)
  })
  it('swaps at once under reduced motion but still holds the name briefly', () => {
    expect(phaseDuration('out', true)).toBe(0)
    expect(phaseDuration('in', true)).toBe(NAME_HOLD_MS)
    expect(NAME_HOLD_MS).toBeGreaterThan(0)
    expect(NAME_HOLD_MS).toBeLessThan(2000)
  })
  it('reports the event each phase ends with', () => {
    expect(phaseTimeout({ to: forest, name: 'Forest clearing', phase: 'out' })).toEqual({ type: 'covered' })
    expect(phaseTimeout({ to: forest, name: 'Forest clearing', phase: 'swap' })).toEqual({ type: 'loaded', scene: forest })
    expect(phaseTimeout({ to: forest, name: 'Forest clearing', phase: 'in' })).toEqual({ type: 'revealed' })
  })
})

describe('SceneTransition markup', () => {
  it('renders nothing when the table is settled', () => {
    expect(renderToStaticMarkup(<SceneTransition transition={null} onEvent={() => {}} />)).toBe('')
  })
  it('shows the next scene name centred with the phase as a class', () => {
    const html = renderToStaticMarkup(<SceneTransition transition={{ to: forest, name: 'Forest clearing', phase: 'out' }} onEvent={() => {}} />)
    expect(html).toContain('class="scene-transition scene-transition--out"')
    expect(html).toMatch(/<p class="scene-transition__name" role="status" aria-live="polite">Forest clearing<\/p>/)
    expect(html).not.toContain('Loading')
  })
  it('adds a loading hint while black and a reduced-motion class when asked', () => {
    const html = renderToStaticMarkup(<SceneTransition transition={{ to: forest, name: 'Forest clearing', phase: 'swap' }} onEvent={() => {}} reducedMotion />)
    expect(html).toContain('class="scene-transition scene-transition--swap scene-transition--reduced"')
    expect(html).toContain('Loading…')
  })
})

describe('ScenePreviewBar', () => {
  it('names the previewed scene and offers the switch and the way back', () => {
    const html = renderToStaticMarkup(<ScenePreviewBar name="Forest clearing" onSwitch={() => {}} onBack={() => {}} />)
    expect(html).toContain('Previewing <b>Forest clearing</b>')
    expect(html).toMatch(/<button type="button" class="scene-preview-bar__btn scene-preview-bar__btn--primary">Switch for everyone<\/button>/)
    expect(html).toMatch(/<button type="button" class="scene-preview-bar__btn">Back to live<\/button>/)
  })
})

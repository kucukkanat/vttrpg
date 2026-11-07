/**
 * Build's tool strip, bottom centre: Select (V), Paint (P), Walls (W), Light (L), Fog (B). Each
 * sets the existing build tool state (buildTools.ts). Keys work while nothing is typed into and no
 * prop key took the press first.
 */
import { useEffect } from 'react'
import { useBuildUi } from '@/table/build/buildState'
import { isTypingTarget } from '../shell/useShortcuts'
import { Icon } from '../icons'
import { pickStripTool, STRIP_TOOLS, stripToolForKey, stripToolOf } from './buildTools'

/** V / P / W / L / B pick a tool (Paint is left out on phones). */
export function useStripKeys(enabled: boolean, phone: boolean) {
  useEffect(() => {
    if (!enabled) return
    const on = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isTypingTarget(document.activeElement)) return
      const t = stripToolForKey(e, phone)
      if (!t) return
      e.preventDefault()
      pickStripTool(t)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [enabled, phone])
}

export function ToolStrip({ phone = false, onPicked }: { phone?: boolean; onPicked?(): void }) {
  const active = useBuildUi((s) => stripToolOf(s.tool))
  return (
    <div className="bw-strip" role="toolbar" aria-label="Build tools">
      {STRIP_TOOLS.filter((t) => !(phone && t.wide)).map((t) => (
        <button key={t.id} type="button" className={`bw-tool${active === t.id ? ' on' : ''}`} aria-pressed={active === t.id}
          title={`${t.title} (${t.key})`} onClick={() => { pickStripTool(t.id); onPicked?.() }}>
          <Icon name={t.icon} size={18} />
          <span className="bw-tool-word">{t.label}</span>
          {!phone && <kbd aria-hidden>{t.key}</kbd>}
        </button>
      ))}
    </div>
  )
}

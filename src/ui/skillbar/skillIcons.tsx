/**
 * Inline SVG icons for skill chips. Pack skills name an icon (`SkillDef.icon`: "sword", "flame"…);
 * custom skills may carry an emoji instead, or nothing. Every name used by the bundled packs has a
 * drawing here; an unknown name falls back to a glyph for the skill's target kind. Icons are
 * 24x24 line drawings in `currentColor` so they follow the chip's text colour.
 */
import type { ReactNode } from 'react'
import type { TargetShape } from '@/core/geometry'

type Kind = TargetShape['kind']

/** Paths per icon name, drawn with a 2px round stroke on a 24x24 box. */
const ICONS: Record<string, ReactNode> = {
  sword: (
    <>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="m13 19 6-6" />
      <path d="m16 16 4 4" />
      <path d="m19 21 2-2" />
    </>
  ),
  bow: (
    <>
      <path d="M5 3c8 2 14 8 16 16" />
      <path d="M5 3 21 19" opacity=".55" />
      <path d="M3 21 15 9" />
      <path d="M15 9h3V6" />
      <path d="m3 21 2-4M3 21l4-2" />
    </>
  ),
  flame: (
    <path d="M12 22c4 0 7-2.7 7-6.8 0-3.6-2.4-6-4.2-8.2-.4 2-1.3 3.3-2.8 4C12.6 7.5 11 4.4 8.5 2c.3 3.4-1.6 5.6-3 7.6A9 9 0 0 0 5 15.2C5 19.3 8 22 12 22Z" />
  ),
  'heart-plus': (
    <>
      <path d="M19.5 12.6 12 20l-7.5-7.4A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 7.5 6Z" />
      <path d="M12 10v6M9 13h6" />
    </>
  ),
  leaf: (
    <>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z" />
      <path d="M2 21c0-3 1.9-5.4 5.1-6 2.4-.5 4.9-2 5.9-4" />
    </>
  ),
  'message-heart': (
    <>
      <path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12Z" />
      <path d="M15 11.2 12 14l-3-2.8a1.8 1.8 0 0 1 3-1.9 1.8 1.8 0 0 1 3 1.9Z" />
    </>
  ),
  shield: <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" />,
  spark: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  sparkles: (
    <>
      <path d="M10 3 11.8 8.2 17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8L10 3Z" />
      <path d="M18 14v6M15 17h6" />
      <path d="M18 3v3M16.5 4.5h3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  d20: (
    <>
      <path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" />
      <path d="M12 2 7.5 15h9L12 2ZM3 7l4.5 8M21 7l-4.5 8M7.5 15 12 22l4.5-7" />
    </>
  ),
}

/** Fallback drawings by target kind. */
const KIND_ICONS: Record<Kind, ReactNode> = {
  self: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  single: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
    </>
  ),
  radius: (
    <>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  cone: (
    <>
      <path d="M3 12 20 4M3 12l17 8" />
      <path d="M20 4a14 14 0 0 1 0 16" />
    </>
  ),
  line: (
    <>
      <path d="M3 12h16" />
      <path d="m14 6 6 6-6 6" />
    </>
  ),
}

/** Names the drawing table covers (the packs' icon names and `d20` for save chips). */
export const SKILL_ICON_NAMES: readonly string[] = Object.keys(ICONS)

/** A plain icon id ("heart-plus") rather than an emoji or other text. */
export function isIconName(icon: string): boolean {
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i.test(icon)
}

export type IconSource = { type: 'svg'; name: string } | { type: 'kind'; kind: Kind } | { type: 'text'; text: string }

/** What a chip draws for `icon` on a skill of target `kind`. */
export function resolveIcon(icon: string | undefined, kind: Kind): IconSource {
  const v = icon?.trim()
  if (v && !isIconName(v)) return { type: 'text', text: v }
  const name = v?.toLowerCase()
  if (name && name in ICONS) return { type: 'svg', name }
  return { type: 'kind', kind }
}

export function SkillIcon({ icon, kind, className = 'skill-icon' }: { icon?: string; kind: Kind; className?: string }) {
  const src = resolveIcon(icon, kind)
  if (src.type === 'text') return <span className={`${className} skill-icon--text`} aria-hidden="true">{src.text}</span>
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {src.type === 'svg' ? ICONS[src.name] : KIND_ICONS[src.kind]}
    </svg>
  )
}

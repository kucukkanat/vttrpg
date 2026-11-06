/**
 * Phone navigation model: the tab bar has five slots, four panels (`PanelDef.phoneSlot`) plus
 * "More", whose sheet lists every other visible panel. Pure helpers; the shell holds the state.
 */
import type { PanelDef } from '../panels/registry'

/** Sentinel used as the phone tab id while the More list is showing. No panel uses it. */
export const MORE_ID = 'more'

export interface PhoneTabs {
  /** Panels with their own tab, in slot order. */
  primary: PanelDef[]
  /** Panels listed in the More sheet, in registry order. */
  more: PanelDef[]
}

export function splitPhoneTabs(panels: PanelDef[]): PhoneTabs {
  const primary = panels.filter((p) => p.phoneSlot != null).sort((a, b) => (a.phoneSlot ?? 0) - (b.phoneSlot ?? 0))
  const more = panels.filter((p) => p.phoneSlot == null)
  return { primary, more }
}

/**
 * Sheet to show after a horizontal swipe on the sheet header. The four primary slots and the More
 * list form one ring (so swiping past Chat lands on More); the More panels form their own ring.
 */
export function nextPhoneTab(current: string, dir: 1 | -1, tabs: PhoneTabs): string {
  const inMore = tabs.more.some((p) => p.id === current)
  const ring = inMore
    ? tabs.more.map((p) => p.id)
    : [...tabs.primary.map((p) => p.id), ...(tabs.more.length ? [MORE_ID] : [])]
  const i = ring.indexOf(current)
  if (i < 0 || ring.length === 0) return current
  return ring[(i + dir + ring.length) % ring.length]!
}

/** Badge shown on the More tab: the sum over the panels it hides. */
export function sumBadges(panels: PanelDef[], badges: Record<string, number>): number {
  return panels.reduce((n, p) => n + (badges[p.id] ?? 0), 0)
}

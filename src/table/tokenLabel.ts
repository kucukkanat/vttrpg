/**
 * How a token is lettered, shared by the disc texture on the table and the HUD turn strip. Pure; no three.js.
 */

/** Two letters for a token: "Pip" -> "PI", "Old Rat King" -> "OK", "" -> "?". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/** Relative luminance (0..1) of a #rgb / #rrggbb colour, sRGB channels weighted as the disc texture does; 0 when unparsable. */
export function luminance(color: string): number {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return 0
  const hex = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4)
}

/** Text colour that reads on a token colour: dark ink on light tokens, cream on dark ones. */
export function inkOn(color: string): string {
  return luminance(color) > 0.45 ? '#1a1612' : '#f6efe3'
}

/** Ring colour for an owned token whose owner is offline (no presence colour to show). */
export const OFFLINE_OWNER_COLOR = '#9a9892'
/** Colour the local player is shown as when their presence has no colour yet (see the Players panel). */
export const LOCAL_OWNER_COLOR = '#7cc4ff'

/**
 * The owner ring on a token: the owning player's presence colour, or null when nobody but the GM
 * owns it (unowned tokens and the GM's own keep no ring).
 */
export function ownerRingColor(
  owner: string | undefined,
  gm: string | undefined,
  viewer: string | null,
  ownerPresenceColor: string | undefined,
): string | null {
  if (!owner || owner === gm) return null
  if (ownerPresenceColor) return ownerPresenceColor
  return owner === viewer ? LOCAL_OWNER_COLOR : OFFLINE_OWNER_COLOR
}

/** Whether the token's name label shows without hovering: the viewer's own tokens, the selection and the combatant whose turn it is. */
export function nameplateShown(o: { mine: boolean; selected: boolean; hovered: boolean; current: boolean }): boolean {
  return o.mine || o.selected || o.hovered || o.current
}

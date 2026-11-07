/**
 * The app's icon set: small inline SVGs on a 24-unit grid, stroke-based in `currentColor`, so they
 * follow the button's colour (muted, accent when on) and look the same on every device, unlike
 * emoji. No icon library and no network: each icon is a few path elements below.
 *
 * Use `<Icon name="dice" />`; the SVG is decorative (aria-hidden), so the button keeps its own
 * label, aria-label or title.
 */
import type { ReactNode } from 'react'
import { GLYPHS } from './theme/glyphs'

/** The one stroke width of every line icon in the app (this set, skill icons, status glyphs, CSS masks). */
export const ICON_STROKE = 1.75

/** A glyph from the shared path data (theme/glyphs.ts), as icon children. */
const glyph = (name: string) => <>{GLYPHS[name]!.map((d) => <path key={d} d={d} />)}</>

const dot = (cx: number, cy: number, r = 1.4) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />

const ICONS = {
  /** Scenes: a folded map. */
  map: <><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></>,
  /** Tokens: a pawn. */
  pawn: <><circle cx="12" cy="6" r="3" /><path d="M10 9.5 8.5 17h7L14 9.5" /><path d="M6 21h12M7.5 17h9l1 4h-11z" /></>,
  /** Sound: a speaker with waves. */
  sound: <><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  /** Players: two people. */
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></>,
  /** Initiative / turns: crossed swords. */
  swords: <><path d="M4 4l11 11M13 17l4-4M15 15l5 5" /><path d="M20 4 9 15M7 13l4 4M9 15l-5 5" /></>,
  /** Character sheet: a page with lines. */
  sheet: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  /** Skills: a four-point spark. */
  spark: <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" />,
  /** Chat: a speech bubble. */
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  /** Journal: an open book. */
  book: <><path d="M12 6.5C10 5 7 4.5 3 5v13c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5z" /><path d="M12 6.5v13" /></>,
  /** Prep: a toolbox. */
  toolbox: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18M10 12v2h4v-2" /></>,
  /** Skill editor: a wrench. */
  wrench: <path d="M14.5 3.5a5 5 0 0 0-5.3 6.6l-5.7 5.7a1.9 1.9 0 0 0 2.7 2.7l5.7-5.7a5 5 0 0 0 6.6-5.3l-3 3-2.5-.5-.5-2.5 2-4z" />,
  /** Build: a brick wall. */
  wall: <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 9.67h18M3 14.33h18M9 5v4.67M15 5v4.67M6 9.67v4.66M12 9.67v4.66M18 9.67v4.66M9 14.33V19M15 14.33V19" /></>,
  /** More / overflow menu: three dots. */
  more: <>{[dot(5, 12, 1.6), dot(12, 12, 1.6), dot(19, 12, 1.6)]}</>,
  /** First-person camera: an eye. */
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  /** Dice pad: a five-pip die. */
  dice: <><rect x="4" y="4" width="16" height="16" rx="3" />{[dot(8.5, 8.5), dot(15.5, 8.5), dot(12, 12), dot(8.5, 15.5), dot(15.5, 15.5)]}</>,
  /** Grid toggle. */
  grid: <><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16" /></>,
  /** Multi-select: a dashed box with a pointer. */
  select: <><path d="M4 8V4h4M12 4h2M18 4h2v4M4 12v2M4 18v2h2" /><path d="M11 11l9 3.5-3.8 1.4-1.6 4.1L11 11z" /></>,
  /** Ruler. */
  ruler: <><path d="M3 16.5 16.5 3 21 7.5 7.5 21z" /><path d="M6.5 13 8 14.5M9.5 10l2.5 2.5M12.5 7 14 8.5" /></>,
  /** Ping: a map pin. */
  pin: <><path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  /** Pin the drawer: a thumbtack. */
  tack: <path d="M9 3h6M10 3v6l-3 4h10l-3-4V3M12 13v8" />,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.4-4.4" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  /** View and layout presets: a framed panel. */
  layout: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 9h17M9.5 9v10.5" /></>,
  /** Turn a quarter. */
  rotate: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
  /** Stop playback: a rounded square. */
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  /** Play / current turn: a triangle pointing right. */
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5z" />,
  /** Done / chosen: a check mark. */
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  /** A flag (declared, marked). */
  flag: <><path d="M5 21V4" /><path d="M5 4.5h11l-2.5 4 2.5 4H5" /></>,
  /** Add. */
  plus: <path d="M12 5v14M5 12h14" />,
  /** Edit: a pencil. */
  pencil: <><path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5 4 20z" /><path d="M13.5 7l3 3" /></>,
  /** Remove: a bin. */
  trash: <><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" /><path d="M10 11v5.5M14 11v5.5" /></>,
  /** Drawer / menu toggle. */
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  /** Find my token: a crosshair. */
  crosshair: <><circle cx="12" cy="12" r="7" /><path d="M12 2.5V7M12 17v4.5M2.5 12H7M17 12h4.5" /></>,
  /** Warnings (friendly fire, a scene that failed to load). */
  warning: <><path d="M12 3.5 2.5 20h19L12 3.5z" /><path d="M12 10v4.5" />{dot(12, 17.2, 1.1)}</>,
  /** Whisper: a closed padlock. */
  lock: <><rect x="5" y="11" width="14" height="9.5" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  /** A picture (journal entries with an image). */
  image: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M20.5 16.5 15 11l-8 8" /></>,
  /** Soundboard pads. */
  door: <><path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M3.5 21h17" />{dot(14.8, 12.5, 1.2)}</>,
  thunder: <><path d="M7 16.5a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 8" /><path d="M12.5 12 10 16.5h3.5L11 21" /></>,
  coin: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5.5" /><path d="M12 9.5v5" /></>,
  scream: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="15.5" rx="2.2" ry="3" /><path d="M8 9h.5M15.5 9h.5" /></>,
  drum: <><ellipse cx="12" cy="8" rx="8" ry="3" /><path d="M4 8v8c0 1.7 3.6 3 8 3s8-1.3 8-3V8" /><path d="M7 3.5l3 3.5M17 3.5l-3 3.5" /></>,
  /** HP backups: a blood drop when bloodied (half or less), a skull at zero. Same drawings as the table's. */
  bloodied: glyph('bloodied'),
  skull: glyph('skull'),
  /** Dice backups: a star on a natural max, a broken ring on a natural 1. */
  crit: glyph('crit'),
  fumble: glyph('fumble'),
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  /** The model library: a crate seen from a corner. */
  cube: <><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3z" /><path d="M4 7.5 12 12l8-4.5M12 12v9" /></>,
  /** Favourite: a five-pointed star. */
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />,
  /** Eyedropper: pick a model up from the board. */
  dropper: <><path d="M14.5 4.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L17 12l-5-5 2.5-2.5z" /><path d="M12.5 7.5 5 15v4h4l7.5-7.5" /></>,
  /** Credits: a rosette with ribbons. */
  ribbon: <><circle cx="12" cy="9" r="5" /><path d="m9 13.5-2 7 3-1.5 2 2.5M15 13.5l2 7-3-1.5-2 2.5" /></>,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

export const ICON_NAMES = Object.keys(ICONS) as IconName[]

export const isIconName = (name: string): name is IconName => Object.prototype.hasOwnProperty.call(ICONS, name)

export function Icon({ name, size = 20, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg
      className={className ? `icon-svg ${className}` : 'icon-svg'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}

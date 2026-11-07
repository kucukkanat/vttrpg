/**
 * Colour roles for everything drawn on the 3D table (rings, templates, trails, chips, labels) and
 * for TS code that needs a colour outside CSS. One meaning per colour; each role also has a shape
 * or text backup where it is drawn (see docs/UX.md, "Colour roles"). The UI's CSS custom properties
 * in `global.css` carry the same values (`--now`, `--select`, `--mine`, …); `palette.test.ts`
 * keeps the two in step.
 *
 * Table code imports from here instead of writing hex literals. Scenery materials and lighting are
 * not colour roles and stay where they are.
 */

/** Brand and primary actions only (primary buttons, links, the logo). Never a table state. */
export const BRAND = '#e0a458'

/** "Now": whose turn it is (turn ring, YOUR TURN pill, current disc). Always paired with pulse or text. */
export const NOW = '#ffc53d'

/** Selected token or prop: a solid cream ring (the nameplate shows as well). */
export const SELECT = '#f3ead8'
/** Hover: a fainter white ring, thinner than the selection. */
export const HOVER = '#ffffff'

/** "Mine": the viewer's own tokens, aims and pings when no presence colour is known. */
export const MINE = '#7cc4ff'

/** Hostile and targeted: target rings, hostile templates. Backed by a crosshair or sawtooth rim. */
export const HOSTILE = '#ff5a1f'

/** Heals and buffs: friendly templates and buff statuses. Backed by a "+" pattern. */
export const HELP = '#3ee08f'

/** Measurement, range and move paths: neutral cream at low alpha, dashed or labelled. */
export const MEASURE = '#e8dcc0'

/** Text drawn over the table ("in-world" parchment), and dark ink for light token colours. */
export const PARCHMENT = '#f3ead8'
export const INK = '#1a1612'
/** Glass behind table labels (nameplates, distance labels). */
export const LABEL_GLASS = 'rgba(14, 14, 16, 0.82)'

/** A move dropped while the GM was away, waiting to be applied. Muted, not a role colour. */
export const WAITING = '#9a9892'

/** HP bands: hue progression plus pip count, a bloodied glyph at half and a skull at zero. */
export const HP_HIGH = '#3fbf7f'
export const HP_MID = '#f2b33d'
export const HP_LOW = '#d8342c'

/** Floating numbers. */
export const DAMAGE = '#ff5f52'
export const HEAL = '#5fd36b'

/** Status categories: border colour per kind; the border shape carries the same meaning. */
export const STATUS = {
  buff: '#43d39e',
  harm: '#e5484d',
  control: '#ffb347',
  magic: '#4c8dff',
  affliction: '#c77ddd',
} as const
/**
 * The GM's build layer (walls, doors, fog brush). Walls are cream like measurement, open passages
 * green, locked or erasing red-orange, the pen the selection colour; other players' proposals
 * stay a distinct cyan so they never read as the GM's own work.
 */
export const BUILD = {
  wall: '#e8dcc0',
  door: '#3ee08f',
  doorOpen: '#7cc4ff',
  locked: '#ff5a1f',
  base: '#c9c2b0',
  proposal: '#4fd1ff',
  erase: '#ff5a1f',
  pen: '#f3ead8',
  fogReveal: '#f3ead8',
  fogHide: '#6c63ff',
} as const

/** Fill behind a status glyph and the glyph itself (monochrome). */
export const STATUS_FILL = '#16161a'
export const STATUS_GLYPH = '#f3ead8'

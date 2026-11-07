/**
 * Colour checks used by the palette tests and the art-direction notes in docs/UX.md: WCAG 2
 * contrast ratio, a colour-vision-deficiency simulation (Machado, Oliveira and Fernandes 2009,
 * severity 1.0, in linear RGB) and a CIE76 distance in Lab to tell two simulated colours apart.
 * Pure; no DOM.
 */

export type Rgb = [number, number, number]
export type Deficiency = 'protan' | 'deutan' | 'tritan'

/** "#rgb" / "#rrggbb" to 0..1 sRGB channels; throws on anything else so a typo fails the test. */
export function parseHex(color: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) throw new Error(`not a hex colour: ${color}`)
  const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

export function relativeLuminance(color: string): number {
  const [r, g, b] = parseHex(color).map(toLinear) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1..21. AA asks for 4.5 for body text, 3 for large text and UI parts. */
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a)
  const y = relativeLuminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const MATRICES: Record<Deficiency, [Rgb, Rgb, Rgb]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
}

/** How `color` looks with a full protan, deutan or tritan deficiency, as "#rrggbb". */
export function simulate(color: string, kind: Deficiency): string {
  const c = parseHex(color).map(toLinear) as Rgb
  return '#' + MATRICES[kind]
    .map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])))
    .map((v) => Math.round(toGamma(v) * 255).toString(16).padStart(2, '0'))
    .join('')
}

function lab(color: string): Rgb {
  const [r, g, b] = parseHex(color).map(toLinear) as Rgb
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** CIE76 colour difference; about 10 is "clearly different at a glance" for small marks. */
export function deltaE(a: string, b: string): number {
  const p = lab(a)
  const q = lab(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

/** Smallest pairwise difference in a set, for normal vision or one deficiency. */
export function minDistance(colors: readonly string[], kind?: Deficiency): number {
  const seen = kind ? colors.map((c) => simulate(c, kind)) : [...colors]
  let min = Infinity
  for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) min = Math.min(min, deltaE(seen[i]!, seen[j]!))
  return min
}

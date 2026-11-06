/**
 * Pure helpers behind the Initiative panel and its HUD chip: which sheet formula a pack uses for
 * initiative, rolling the opening order for a scene, and the words on the chip. Nothing here
 * touches the document; the panel dispatches the result as `initiative.*` intents.
 */
import type { Character, InitiativeEntry, InitiativeState, Token } from '@/core/doc'
import type { CharacterId, PlayerPubkey, TokenId } from '@/core/ids'
import type { SheetField } from '@/core/pack'
import type { LoadedPack, RulesEngine } from '@/rules'
import { rollFromSeed } from '@/dice/fair'

/** The dice everyone rolls when the pack declares no initiative of its own. */
export const DEFAULT_INITIATIVE_FORMULA = 'd20'

function* fields(list: SheetField[]): Generator<SheetField> {
  for (const f of list) {
    yield f
    if (f.kind === 'list') yield* fields(f.item)
  }
}

/**
 * The formula a pack rolls for initiative: a sheet roll field labelled "Initiative" (D&D 5e has
 * `d20 + initiative`), else `d20 + <attribute>` for an attribute with id `initiative`, else null
 * when the pack leaves it to the table (Mausritter).
 */
export function initiativeFormula(pack: LoadedPack | null | undefined): string | null {
  if (!pack) return null
  for (const section of pack.sheet.sections) {
    for (const f of fields(section.fields)) {
      if (f.kind === 'roll' && /\binitiative\b/i.test(f.label)) return f.formula
    }
  }
  if (pack.attributes.some((a) => a.id === 'initiative')) return 'd20 + initiative'
  return null
}

/** The seed one combatant's roll is derived from; distinct per token, reproducible from the intent's seed. */
export const seedFor = (seed: string, token: TokenId): string => `${seed}:${token}`

/**
 * Combatants for a new encounter: the visible tokens of `scene` that have a sheet, in token order.
 * Hidden tokens stay out so their names are not shown to players; the GM can add them by hand.
 */
export function combatants(tokens: Record<TokenId, Token>, scene: string | null): Token[] {
  if (!scene) return []
  return Object.values(tokens).filter((t) => t.scene === scene && !!t.character && !t.hidden)
}

/**
 * Roll a score per token. With a pack formula the roll runs against each token's sheet through
 * the rules engine (so `initiative` and `dex_mod` resolve); without one, or for a token whose
 * sheet is missing, everyone rolls the default die. Scores that cannot be rolled fall back to 0.
 */
export async function rollInitiative(
  tokens: Token[],
  characters: Record<CharacterId, Character>,
  rules: RulesEngine | null,
  seed: string,
): Promise<InitiativeEntry[]> {
  const formula = initiativeFormula(rules?.pack)
  const out: InitiativeEntry[] = []
  for (const t of tokens) {
    const s = seedFor(seed, t.id)
    const character = t.character ? characters[t.character] : undefined
    let score = 0
    try {
      if (formula && rules && character) score = (await rules.roll(formula, s, { character })).total
      else score = (await rollFromSeed(DEFAULT_INITIATIVE_FORMULA, s)).total
    } catch {
      try {
        score = (await rollFromSeed(DEFAULT_INITIATIVE_FORMULA, s)).total
      } catch {
        score = 0
      }
    }
    out.push({ token: t.id, score })
  }
  return out
}

/** `order` with the entry at `from` moved to `to` (clamped); same array when nothing moves. */
export function moveEntry(order: InitiativeEntry[], from: number, to: number): InitiativeEntry[] {
  const target = Math.max(0, Math.min(order.length - 1, to))
  if (from < 0 || from >= order.length || target === from) return order
  const next = order.slice()
  const [e] = next.splice(from, 1)
  next.splice(target, 0, e)
  return next
}

/** `order` with `token` scored `score`; the list is re-sorted by score the way `initiative.start` sorts it. */
export function withScore(order: InitiativeEntry[], token: TokenId, score: number): InitiativeEntry[] {
  const next = order.map((e) => (e.token === token ? { ...e, score } : e))
  return next.map((e, i) => ({ e, i })).sort((a, b) => b.e.score - a.e.score || a.i - b.i).map(({ e }) => e)
}

/** The combatant whose turn it is, or undefined between encounters. */
export function currentEntry(s: InitiativeState | null): InitiativeEntry | undefined {
  if (!s || !s.active) return undefined
  return s.order[s.turn]
}

/**
 * What the viewer may call a combatant: the token's name, or "Someone" for a hidden token when
 * the viewer is a player (the GM sees every name). A token that left the document reads "Gone".
 */
export function combatantName(token: Token | undefined, isGm: boolean): string {
  if (!token) return 'Gone'
  return token.hidden && !isGm ? 'Someone' : token.name
}

/** Possessive for the toast and chip: "Pip's turn", "Boss's turn", "Mice's turn". */
export function possessive(name: string): string {
  return `${name}'s`
}

/** The chip text: "Round 2 · Pip's turn"; null while no encounter runs. */
export function turnLabel(s: InitiativeState | null, tokens: Record<TokenId, Token>, isGm: boolean): string | null {
  const cur = currentEntry(s)
  if (!s || !cur) return null
  return `Round ${s.round} · ${possessive(combatantName(tokens[cur.token], isGm))} turn`
}

/** Whether `pubkey` should react to `token`'s turn: its owner and the GM do, nobody else. */
export function concernsViewer(token: Token | undefined, pubkey: PlayerPubkey | string, isGm: boolean): boolean {
  if (isGm) return true
  return !!token && token.owner === pubkey
}

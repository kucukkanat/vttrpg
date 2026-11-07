// Pure conversion from an Open5e v2 creature record to a dnd5e pack compendium entry: the stat
// block as sheet data in the shape of `packs/dnd5e/npc-sheet.json` (same keys the PC sheet and the
// pack's skills read, so `target.ac`, saves and passive Perception work on monsters unchanged),
// plus a few top-level fields for search. Actions are parsed from the stat-block text, because
// Open5e's structured attack fields are unreliable (damage types are often wrong or missing).

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const ABILITY_NAMES = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' }

/** Ability behind each skill, matching the PC sheet's skill rolls. */
export const SKILL_ABILITY = {
  acrobatics: 'dex', animal_handling: 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int',
  insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int', sleight_of_hand: 'dex', stealth: 'dex', survival: 'wis',
}

/** Proficiency bonus by challenge rating (same steps as by character level). */
export function pbForCr(cr) {
  return 2 + Math.floor((Math.max(1, Math.ceil(cr)) - 1) / 4)
}

export function crText(cr) {
  if (cr === 0.125) return '1/8'
  if (cr === 0.25) return '1/4'
  if (cr === 0.5) return '1/2'
  return String(cr)
}

const mod = (score) => Math.floor((score - 10) / 2)
/** Proficiency multiple that makes `mod + ratio * pb` equal the stat block's bonus exactly (1, 2 for expertise, or a fraction). */
export function profRatio(extra, pb) {
  if (extra <= 0) return 0
  return extra / pb
}
const title = (s) => String(s ?? '').replace(/\b\w/g, (c) => c.toUpperCase())

/** "20d10 + 40" -> "20d10+40"; unicode minus to ASCII. */
export function normFormula(s) {
  return String(s ?? '').replace(/[−–]/g, '-').replace(/\s+/g, '')
}

/** Dice terms only ("2d6+5+1d8" -> "2d6+1d8"), the part a critical hit doubles. */
export function diceOnly(formula) {
  const terms = normFormula(formula).match(/\d*d\d+/g)
  return terms ? terms.join('+') : ''
}

function speedText(speed) {
  if (!speed) return ''
  const unit = 'ft.'
  const parts = []
  if (typeof speed.walk === 'number') parts.push(`${speed.walk} ${unit}`)
  for (const k of ['burrow', 'climb', 'fly', 'swim']) {
    if (typeof speed[k] === 'number' && speed[k] > 0) parts.push(`${k} ${speed[k]} ${unit}${k === 'fly' && speed.hover ? ' (hover)' : ''}`)
  }
  return parts.join(', ')
}

function sensesText(c) {
  const parts = []
  for (const [k, label] of [['blindsight_range', 'blindsight'], ['darkvision_range', 'darkvision'], ['tremorsense_range', 'tremorsense'], ['truesight_range', 'truesight']]) {
    if (typeof c[k] === 'number' && c[k] > 0) parts.push(`${label} ${c[k]} ft.`)
  }
  if (typeof c.passive_perception === 'number') parts.push(`passive Perception ${c.passive_perception}`)
  return parts.join(', ')
}

/** Damage type ids of the pack's damage model (`pack.json` `damage.types`). */
export const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']
const PHYSICAL = new Set(['bludgeoning', 'piercing', 'slashing'])

/**
 * Damage type ids from a stat block's resistance, immunity or vulnerability text, for the pack's
 * damage model. Physical types qualified by a clause ("from nonmagical attacks", "that aren't
 * silvered") are left out, since the engine cannot tell magical attacks apart; the text keeps them.
 * Open5e's structured lists are not used: they disagree with the text on several creatures.
 */
export function damageTypeList(display) {
  const out = new Set()
  for (const clause of String(display ?? '').toLowerCase().split(';')) {
    const qualified = /nonmagical|non-magical|magic|silvered|adamantine|aren't|that is not|except/.test(clause)
    for (const t of DAMAGE_TYPES) if (new RegExp(`\\b${t}\\b`).test(clause) && !(qualified && PHYSICAL.has(t))) out.add(t)
  }
  return DAMAGE_TYPES.filter((t) => out.has(t))
}

const ACTION_TYPES = { ACTION: 'action', BONUS_ACTION: 'bonus', REACTION: 'reaction', LEGENDARY_ACTION: 'legendary', LAIR_ACTION: 'lair' }

const cells = (feet) => Math.max(1, Math.round(feet / 5))

/**
 * Stat-block text without the source's markup: `_Trigger:_` italics and cross-reference leftovers
 * such as "Sphere [Area of Effect]|XPHB|Sphere" or "Cover|XPHB|Total Cover" (the last part is the
 * text a reader sees).
 */
export function cleanText(s) {
  return String(s ?? '')
    .replace(/(?:\S+ \[[^\]]*\]|(?:Short|Long) Rest|\w+)\|[A-Z]{2,6}\|/g, '')
    .replace(/(^|[\s(—–-])_([^_]+)_/g, '$1$2')
    .trim()
}

/** Damage dealt on a hit or failed save: the first "N (XdY + Z) type damage", plus unconditional "plus ..." riders. */
export function parseDamage(text) {
  const re = /(\d+)\s*\(([\dd\s+\-−]+)\)\s+([A-Za-z]+)\s+damage|(?:Hit:\s*|ft\.\s+)(\d+)\s+([A-Za-z]+)\s+damage/gi
  const m = re.exec(text)
  if (!m) return null
  const parts = [m[2] !== undefined ? normFormula(m[2]) : m[4]]
  const types = [(m[3] ?? m[5]).toLowerCase()]
  // "plus 7 (2d6) fire damage." right after, unless it is conditional ("... if the attack roll had Advantage").
  const rest = text.slice(m.index + m[0].length)
  const plus = /^,?\s*plus\s+(\d+)\s*\(([\dd\s+\-−]+)\)\s+([A-Za-z]+)\s+damage(\s*(?:if|when|while|against)\b)?/i.exec(rest)
  if (plus && !plus[4]) {
    parts.push(normFormula(plus[2]))
    types.push(plus[3].toLowerCase())
  }
  // The damage model gives a row one type: the first (main) one; riders of another type share it.
  return { damage: parts.join('+'), type: DAMAGE_TYPES.includes(types[0]) ? types[0] : undefined, types: [...new Set(types)] }
}

/** Area of effect named in a save action, in grid cells. */
function parseArea(text) {
  const m = /(\d+)-foot(?:-(?:long|radius|wide))?\s+(cone|line|sphere|cube|emanation|cylinder|radius)/i.exec(text)
    ?? /(cone|line|sphere|cube|emanation|cylinder) (?:that is |with a )?(\d+) f(?:ee|oo)t/i.exec(text)
  if (!m) return null
  const [feet, shape] = /^\d/.test(m[1]) ? [Number(m[1]), m[2].toLowerCase()] : [Number(m[2]), m[1].toLowerCase()]
  if (shape === 'cone') return { shape: 'cone', cells: cells(feet) }
  if (shape === 'line') return { shape: 'line', cells: cells(feet) }
  // Spheres and cylinders give a radius; cubes and emanations an extent from the origin.
  const size = shape === 'cube' ? Math.max(1, Math.round(feet / 10)) : cells(feet)
  const within = /(?:within|range)\s+(\d+)\s*f(?:ee|oo)?t/i.exec(text)
  const origin = /originating from|centered on (?:itself|the \w+)|emanation/i.test(text)
  return { shape: 'radius', cells: origin || !within ? 0 : cells(Number(within[1])), size }
}

/**
 * One stat-block action as sheet data. `kind` picks the pack's action-skill template:
 * `melee` / `ranged` (attack roll vs AC, damage), `save` (saving throw vs DC with damage, `half`
 * on a success when the text says so), `save-only` (a save with no damage) or `other` (text only).
 */
export function parseAction(a) {
  const desc = cleanText(a.desc)
  const out = { name: String(a.name ?? 'Action'), type: ACTION_TYPES[a.action_type] ?? 'action', kind: 'other', desc }
  const atk = /(Melee or Ranged|Melee|Ranged)(?: Weapon| Spell)? Attack(?: Roll)?:\s*\+(\d+)/i.exec(desc)
  if (atk) {
    const reach = /reach (\d+) ft/i.exec(desc)
    const range = /range (\d+)(?:\/(\d+))? ft/i.exec(desc)
    const dmg = parseDamage(desc.slice(atk.index))
    if (dmg) {
      const melee = /^melee$/i.test(atk[1])
      out.kind = melee ? 'melee' : 'ranged'
      out.bonus = Number(atk[2])
      out.cells = melee ? cells(reach ? Number(reach[1]) : 5) : cells(range ? Number(range[1]) : reach ? Number(reach[1]) : 5)
      out.damage = dmg.damage
      out.dice = diceOnly(dmg.damage) || dmg.damage
      if (dmg.type) out.damage_type = dmg.type
      return out
    }
  }
  const save24 = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\s*DC (\d+)/i.exec(desc)
  const save14 = /DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i.exec(desc)
  if (save24 || save14) {
    const ability = ABILITY_NAMES[(save24 ? save24[1] : save14[2]).toLowerCase()]
    const dc = Number(save24 ? save24[2] : save14[1])
    const dmg = parseDamage(desc)
    const area = parseArea(desc)
    const within = /within (\d+) f(?:ee|oo)t/i.exec(desc)
    out.ability = ability
    out.dc = dc
    if (area) {
      out.shape = area.shape
      out.cells = area.cells
      if (area.size !== undefined) out.size = area.size
    } else {
      out.shape = 'single'
      out.cells = within ? cells(Number(within[1])) : 1
    }
    if (dmg) {
      out.kind = 'save'
      out.damage = dmg.damage
      if (dmg.type) out.damage_type = dmg.type
      out.half = /half (?:as much )?damage|Success:\s*Half/i.test(desc) ? 1 : 0
    } else out.kind = 'save-only'
    return out
  }
  return out
}

/** The sheet data for one creature (see the pack README's "Creature sheet data"). */
export function creatureData(c) {
  const cr = Number(c.challenge_rating ?? 0)
  const pb = pbForCr(cr)
  const scores = {}
  for (const [name, id] of Object.entries(ABILITY_NAMES)) scores[id] = Number(c.ability_scores?.[name] ?? 10)
  const save_prof = {}
  for (const [name, id] of Object.entries(ABILITY_NAMES)) {
    const v = c.saving_throws?.[name]
    save_prof[id] = typeof v === 'number' ? profRatio(v - mod(scores[id]), pb) : 0
  }
  const prof = {}
  for (const [skill, ability] of Object.entries(SKILL_ABILITY)) {
    const v = c.skill_bonuses?.[skill]
    prof[skill] = typeof v === 'number' ? profRatio(v - mod(scores[ability]), pb) : 0
  }
  const ri = c.resistances_and_immunities ?? {}
  const actions = [...(c.actions ?? [])]
    .sort((a, b) => (ACTION_ORDER[a.action_type] ?? 9) - (ACTION_ORDER[b.action_type] ?? 9) || (a.order_in_statblock ?? 0) - (b.order_in_statblock ?? 0))
    .map(parseAction)
  const data = {
    size: title(c.size?.name),
    creature_type: [c.type?.name, c.subcategory ? `(${c.subcategory})` : ''].filter(Boolean).join(' '),
    alignment: title(c.alignment),
    cr,
    cr_text: crText(cr),
    xp: Number(c.experience_points ?? 0),
    level: 1,
    prof_bonus: pb,
    ...scores,
    save_prof,
    prof,
    armor_base: Number(c.armor_class ?? 10),
    armor_dex_cap: 0,
    shield: 0,
    ac_bonus: 0,
    ac_note: String(c.armor_detail ?? ''),
    hp: { current: Number(c.hit_points ?? 1), max: Number(c.hit_points ?? 1) },
    hp_dice: normFormula(c.hit_dice ?? ''),
    initiative_bonus: typeof c.initiative_bonus === 'number' ? c.initiative_bonus - mod(scores.dex) : 0,
    speed_base: Number(c.speed?.walk ?? 0),
    speed_text: speedText(c.speed_all ?? c.speed),
    senses: sensesText(c),
    languages: String(c.languages?.as_string ?? '') || '—',
    // Lists for the damage model; the stat block's wording stays in the *_text fields.
    vulnerabilities: damageTypeList(ri.damage_vulnerabilities_display),
    resistances: damageTypeList(ri.damage_resistances_display),
    immunities: damageTypeList(ri.damage_immunities_display),
    vulnerabilities_text: String(ri.damage_vulnerabilities_display ?? ''),
    resistances_text: String(ri.damage_resistances_display ?? ''),
    immunities_text: String(ri.damage_immunities_display ?? ''),
    temp_hp: 0,
    condition_immunities: String(ri.condition_immunities_display ?? ''),
    traits: (c.traits ?? []).map((t) => ({ name: String(t.name ?? ''), desc: cleanText(t.desc) })),
    actions,
    conditions: [],
    notes: '',
  }
  return data
}

const ACTION_ORDER = { ACTION: 0, BONUS_ACTION: 1, REACTION: 2, LEGENDARY_ACTION: 3, LAIR_ACTION: 4 }

/** A compendium entry: search fields plus the sheet data. */
export function creatureEntry(c, source) {
  const data = creatureData(c)
  return {
    key: String(c.key),
    name: String(c.name),
    source,
    cr: data.cr,
    xp: data.xp,
    type: String(c.type?.name ?? ''),
    size: data.size,
    data,
  }
}

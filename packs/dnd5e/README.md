# D&D 5e (SRD) pack

A system pack for VTTRPG implementing the core of fifth edition from the System Reference
Document 5.1: six abilities with modifiers, proficiency bonus, d20 attack rolls against Armor
Class, saving throws against a DC, hit points and hit dice, spell slots, the SRD conditions and
4d6-drop-lowest character creation with the SRD races and classes, plus the SRD 5.2.1 and SRD
5.1 creature stat blocks with an NPC sheet and the SRD 5.2.1 encounter XP budget. Everything in
this folder is SRD content under CC-BY-4.0 (attributions in `LICENSE.md`); nothing from the
Player's Handbook or Monster Manual beyond the SRDs is included.

`packs/mausritter/README.md` is the reference for the pack format itself. This file covers what
this pack adds on top of it and how it uses the engine.

## Files

| File | Contents |
|---|---|
| `pack.json` | Manifest, square grid of 1.5 m (one 5-foot square), `resolution: d20-vs-dc` |
| `attributes.json` | Abilities, level and 20 derived attributes (modifiers, proficiency bonus, AC, initiative, speed, passive Perception, spellcasting numbers) |
| `resources.json` | `hp`, `hit_dice`, `slots_1`..`slots_3` with max expressions |
| `conditions.json` | The 15 SRD conditions plus the `shield-of-faith` buff |
| `sheet.json` | Identity, abilities and saves, 18 skills, combat, attacks, spellcasting, equipment, features, conditions, notes |
| `chargen.json` | Roll abilities, race table, class table, Acolyte background, alignment, vitals |
| `skills/*.json` | Two weapon attacks and seven spells |
| `npc-sheet.json` | The `npc` layout for creature stat blocks (see Creatures) |
| `creatures/srd-2024.json`, `creatures/srd-2014.json` | 331 SRD 5.2.1 and 325 SRD 5.1 creatures, built by `npm run creatures` |
| `creature-actions.json` | Templates that turn stat-block actions into skills |
| `encounter.json` | XP budget per character by level (Low, Moderate, High), SRD 5.2.1 |

## Sheet data

```
str dex con int wis cha        ability scores (plain numbers)
level, xp                      numbers
race, class, background, alignment, languages   strings
save_prof.<ability>            0 or 1
prof.<skill>                   0 (none), 1 (proficient), 2 (expertise); skill ids are snake_case
speed_base                     walking speed in feet from race
armor_base, armor_dex_cap, shield, ac_bonus     see Armor Class below
hp, hit_dice                   { current, max }
hit_die, hit_die_sides         "d10" and 10
slots_1, slots_2, slots_3      { current, max }
caster                         'full' | 'half' | 'pact' | 'none'
spell_ability                  'int' | 'wis' | 'cha' | 'none'
melee, ranged                  readied weapons: { name, damage: "1d8", ability: 'str' | 'dex' }
attacks                        list of { name, bonus, damage } for anything else
spells                         list of { name, level }
equipment                      list of { name, qty }
features                       list of strings
conditions                     list of condition ids
notes                          string
```

### Derived attributes

Attributes with a `derived` expression are computed on read from the rest of the sheet and
never stored. They work everywhere an identifier does: sheet roll buttons, chargen `assign`,
skill formulas and `target.x` lookups. Condition modifiers that name a derived id are added on
top of the computed value (`shield-of-faith` adds 2 to `ac`).

| Id | Expression |
|---|---|
| `str_mod` .. `cha_mod` | `floor((score - 10) / 2)` |
| `pb` | `2 + floor((level - 1) / 4)` |
| `ac` | `armor_base + (armor_dex_cap == 0 ? 0 : min(dex_mod, armor_dex_cap)) + shield + ac_bonus` |
| `initiative` | `dex_mod` |
| `speed` | `max(0, speed_base)` |
| `passive_perception` | `10 + wis_mod + prof.perception * pb` |
| `spell_mod`, `spell_attack`, `spell_dc` | from `spell_ability`; attack `pb + spell_mod`, DC `8 + pb + spell_mod` |
| `cantrip_dice` | 1, 2 at level 5, 3 at 11, 4 at 17 |
| `melee_mod`, `ranged_mod` | STR or DEX according to the readied weapon's `ability` |

The sheet shows derived numbers with `computed` fields ("Proficiency bonus", "Armor Class",
"Speed", "Passive Perception", "Spell save DC") and uses them inside every roll.

`prof_bonus` and `initiative_bonus` are stored attributes that are 0 for characters: `pb` is
`max(prof_bonus, 2 + floor((level - 1) / 4))` and `initiative` is `dex_mod + initiative_bonus`,
so creatures can carry their CR-based proficiency bonus and SRD 5.2 initiative. Sheets made before
these existed read them as 0 (the engine treats a declared but missing attribute as 0).

### Armor Class

`armor_base` is the armor's AC (10 when unarmored), `armor_dex_cap` the most DEX it allows
(10 for none or light armor, 2 for medium, 0 for heavy, which ignores DEX entirely), `shield` is
2 with a shield and `ac_bonus` collects everything else: the Defense fighting style, a monk's or
barbarian's Unarmored Defense, magic items.

### Checks, saves and skills

Roll buttons use `d20 + <ability>_mod + save_prof.<ability> * pb` and
`d20 + <ability>_mod + prof.<skill> * pb`; set a proficiency field to 1 (or 2 for expertise) to
turn it on. Advantage and disadvantage are not modelled; roll twice.

### Conditions

Descriptions follow the SRD. The only effects the engine can express are numeric modifiers:
`grappled`, `restrained`, `paralyzed`, `stunned`, `unconscious` and `petrified` set the speed to
0 (a large negative modifier on `speed_base`, clamped by `speed`), and `shield-of-faith` adds 2
to `ac`. Advantage, disadvantage, auto-fail saves and incapacitation are text for the table.
`exhaustion` is a single condition; track the level in notes.

## Chargen

`generateCharacter(seed, name)` builds a level 1 character:

1. Six ability scores, each `4d6kh3`.
2. Defaults: level 1, no proficiencies, unarmored, no spellcasting, empty lists.
3. Race from a `d9` table of the SRD races (Hill Dwarf, High Elf, Lightfoot Halfling, Human,
   Dragonborn, Rock Gnome, Half-Elf, Half-Orc, Tiefling): speed, languages, traits and a
   `race_bonus` object. The next step adds the bonuses to the scores. A table is used rather than
   `choose` because each race carries data; the Half-Elf's two floating +1s go to DEX and CON.
4. Class from a `d12` table of the SRD classes: hit die, saving throw proficiencies, a default
   pick of the class's skill choices, caster type and spellcasting ability, starting armor and
   readied weapons, one of the SRD starting equipment options, starting spells and the level 1
   features in short form.
5. Background: Acolyte, the SRD's only background (Insight and Religion, the kit).
6. Alignment, one of nine via `choose`.
7. Vitals: `hp.max = hit_die_sides + con_mod`, hit dice equal to level, spell slots from the
   caster type and level (full casters 2, warlocks 1, everyone else 0 at level 1).

Resource `max` expressions in `resources.json` give the general formulas (average hit points per
level, full/half/pact slot progressions to 3rd level) for sheets levelled past 1.

## Skills

| Skill | Cost | Target | Effect |
|---|---|---|---|
| `attack-melee` | none | single, reach 1 | `d20 + melee_mod + pb` vs `target.ac`; weapon dice + modifier, natural 20 always hits and doubles the dice, natural 1 always misses |
| `attack-ranged` | none | single, 24 cells | same with the readied ranged weapon and `ranged_mod` |
| `fire-bolt` | none | single, 24 | `d20 + spell_attack` vs AC; `cantrip_dice`d10 fire |
| `magic-missile` | 1 `slots_1` | single, 24 | `3d4 + 3` force, no roll to hit; all three darts at one target |
| `burning-hands` | 1 `slots_1` | cone, 3 cells, 53 degrees | `3d6` fire, each target saves DEX vs `spell_dc` for half |
| `sacred-flame` | none | single, 12 | DEX save vs `spell_dc` or `cantrip_dice`d8 radiant |
| `cure-wounds` | 1 `slots_1` | single, touch | heal `d8 + spell_mod` up to max |
| `healing-word` | 1 `slots_1` | single, 12 | heal `d4 + spell_mod` up to max |
| `shield-of-faith` | 1 `slots_1` | single, 12 | adds the `shield-of-faith` condition (+2 AC) |

Ranges are in grid cells of 5 feet. Saving throws roll `d20 + target.<ability>_mod +
target.save_prof.<ability> * target.pb` against the caster's `spell_dc`; the engine's
`d20-vs-dc` resolution marks success when the total meets the DC. Attack rows read the natural
die as `save.dice.0` to apply the natural 1 and 20 rules.

## Creatures

`pack.json`'s `creatures` section lists the snapshot files and names the sheet keys the encounter
builder writes (`hp`, `hp_dice`, `armor_base` for the AC override, `xp`, `cr`, `notes`). The
snapshots are fetched only when the GM opens the creature browser.

### Creature sheet data

A creature is a character with `sheet: "npc"` whose data uses the PC keys wherever the rules
overlap, so every PC skill works against it (`target.ac`, saving throws, passive Perception):

```
size, creature_type, alignment, cr_text, senses, languages     strings
cr, xp                         numbers (cr 0.25 for 1/4)
level                          1; prof_bonus carries the CR-based proficiency bonus
str .. cha                     ability scores
save_prof.<ability>            (save bonus - modifier) / pb: 1 when proficient, 0 otherwise
prof.<skill>                   (skill bonus - modifier) / pb: 1, 2 for expertise
armor_base                     the stat block's AC; armor_dex_cap 0, shield 0, ac_bonus 0
ac_note                        "natural armor"
hp, hp_dice                    { current, max } (the average) and "2d6+2"
initiative_bonus               stat-block initiative minus the DEX modifier
speed_base, speed_text         walking speed in feet, and every speed as text
vulnerabilities, resistances, immunities, condition_immunities   text
traits                         list of { name, desc }
actions                        list of actions, below
```

Each action is `{ name, desc, type, kind, ... }` where `type` is `action`, `bonus`, `reaction`,
`legendary` or `lair` and `kind` picks a template in `creature-actions.json`:

| `kind` | Fields | Skill |
|---|---|---|
| `melee`, `ranged` | `bonus`, `damage` ("1d6+2"), `dice` ("1d6", doubled on a natural 20), `damage_type`, `cells` | `d20 + bonus` vs `target.ac`; natural 20 always hits for extra dice, natural 1 misses |
| `save` | `ability`, `dc`, `damage`, `half` (1/0), `shape` (`single`, `cone`, `line`, `radius`), `cells`, `size` | damage rolled once, each target saves vs `dc`, half or none on a success |
| `save-only` | `ability`, `dc`, `shape`, `cells`, `size` | each target saves vs `dc`; the effect is adjudicated from the text |
| `other` | none | text on the sheet only (Multiattack, spellcasting, recharge rules) |

Template formulas read the action through its sheet path (`d20 + actions.0.bonus`), so editing a
placed creature's to-hit or damage takes effect at once. The compiled skills are `onlyListed`:
only the creature's tokens get them. Ranges are in 5-foot cells.

The snapshots are parsed from stat-block text, which Open5e serves more reliably than its
structured attack fields. Known gaps: attacks whose damage depends on a condition keep only the
unconditional part, Multiattack and recharge are text, and a handful of attacks with no damage
(grapples) stay `other`.

### Encounter difficulty

`encounter.json` holds the SRD 5.2.1 "XP Budget per Character" table: for a party level, each band
(Low, Moderate, High) has an XP budget per character, added up over the party. The encounter
builder sums `xp` over the non-friendly creatures and shows where the total falls, with the
arithmetic. SRD 5.1 has no encounter-building table; the 2014 multipliers are not used.

## Not modelled

- Advantage and disadvantage, cover, opportunity attacks, reach beyond 5 feet, two-weapon fighting.
- Casting with a higher-level slot, concentration tracking (remove the condition by hand),
  spell preparation limits, components, ritual casting, pact slots recovering on a short rest.
- Death saving throws beyond a plain `d20 >= 10` button; temporary hit points; damage types,
  resistances and vulnerabilities; critical hits from paralysis.
- Levelling up: edit `level`, `hp.max`, hit dice and slot maxima by hand (the `max` expressions
  in `resources.json` give the numbers).
- Monster spellcasting, Multiattack, recharge, legendary action budgets and legendary
  resistances (all text on the NPC sheet).
- Multiclassing, feats, subclasses other than the SRD defaults named in the
  class features, the Half-Elf's skill choices and the free language picks.

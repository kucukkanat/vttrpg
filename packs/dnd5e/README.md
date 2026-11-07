# D&D 5e (SRD) pack

A system pack for VTTRPG implementing the core of fifth edition from the System Reference
Document 5.1: six abilities with modifiers, proficiency bonus, d20 attack rolls against Armor
Class, saving throws against a DC, hit points and hit dice, spell slots, the SRD conditions and
4d6-drop-lowest character creation with the SRD races and classes. Everything in this folder is
SRD 5.1 content under CC-BY-4.0 (attribution in `LICENSE.md`); nothing from the Player's
Handbook beyond the SRD is included.

`packs/mausritter/README.md` is the reference for the pack format itself. This file covers what
this pack adds on top of it and how it uses the engine.

## Files

| File | Contents |
|---|---|
| `pack.json` | Manifest, square grid of 1.5 m (one 5-foot square), `resolution: d20-vs-dc`, the damage model (13 SRD damage types, temporary hit points) and the concentration rule |
| `attributes.json` | Abilities, level and 20 derived attributes (modifiers, proficiency bonus, AC, initiative, speed, passive Perception, spellcasting numbers) |
| `resources.json` | `hp`, `hit_dice`, `slots_1`..`slots_3` with max expressions |
| `conditions.json` | The 15 SRD conditions, the `shield-of-faith` buff and `concentrating`, each with a `category` |
| `sheet.json` | Identity, abilities and saves, 18 skills, combat, attacks, spellcasting, equipment, features, conditions, notes |
| `chargen.json` | Roll abilities, race table, class table, Acolyte background, alignment, vitals |
| `skills/*.json` | Two weapon attacks and eight spells |
| `glossary.json` | Rules terms the tooltips link to: Armor Class, saving throw, spell save DC, attack roll, natural 20 and 1, proficiency bonus, spell slot, cantrip, concentration, ability modifier, bonus action |

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
temp_hp                        temporary hit points, a plain number (spent first, never healed)
resistances, vulnerabilities, immunities   lists of damage type ids (`fire`), or `all`
hit_die, hit_die_sides         "d10" and 10
slots_1, slots_2, slots_3      { current, max }
caster                         'full' | 'half' | 'pact' | 'none'
spell_ability                  'int' | 'wis' | 'cha' | 'none'
melee, ranged                  readied weapons: { name, damage: "1d8", ability: 'str' | 'dex', type: 'slashing' }
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

The generic sheet renderer shows stored values only, so derived numbers appear through the
"Proficiency bonus", "Armor Class", "Speed", "Passive Perception" and "Spell save DC" buttons,
which print the value in chat, and inside every roll.

### Armor Class

`armor_base` is the armor's AC (10 when unarmored), `armor_dex_cap` the most DEX it allows
(10 for none or light armor, 2 for medium, 0 for heavy, which ignores DEX entirely), `shield` is
2 with a shield and `ac_bonus` collects everything else: the Defense fighting style, a monk's or
barbarian's Unarmored Defense, magic items.

### Checks, saves and skills

Roll buttons use `d20 + <ability>_mod + save_prof.<ability> * pb` and
`d20 + <ability>_mod + prof.<skill> * pb`; set a proficiency field to 1 (or 2 for expertise) to
turn it on. Advantage and disadvantage come from the roll-mode toggle (Adv / Dis in the dice
pad, the chat and the character panel): the next roll's `d20` becomes `2d20kh1` or `2d20kl1`.
On a skill it applies to the caster's attack roll, never to the targets' saves.

### Conditions

Descriptions follow the SRD. The only effects the engine can express are numeric modifiers:
`grappled`, `restrained`, `paralyzed`, `stunned`, `unconscious` and `petrified` set the speed to
0 (a large negative modifier on `speed_base`, clamped by `speed`), and `shield-of-faith` adds 2
to `ac`. `petrified` grants resistance to all damage and immunity to poison. Advantage,
disadvantage, auto-fail saves and incapacitation are text for the table. `exhaustion` is a
single condition; track the level in notes.

Conditions can last a number of turns. The GM sets one in the token's Conditions card ("Lasts
N turns", ending at the end or start of the token's turn); skills set it with `duration`. They
count down while initiative runs and end with a chat notice.

### Damage, resistances and temporary hit points

Damage rows carry a type (`fire`, or the readied weapon's `type`). Resistance halves it,
vulnerability doubles it, immunity ignores it, from the sheet's lists and from conditions.
Temporary hit points absorb damage first; gaining more keeps the higher value. Every skill
that deals or heals damage posts a card in chat with what each target took and buttons to
switch to half, double or healing, or undo; a plain roll without a pass/fail (a damage button,
`/r 2d6`) gets an "Apply…" button that applies the total to the selected tokens, with a type
picker. The GM uses any card; a player uses it on tokens they own.

### Concentration

`shield-of-faith` needs concentration. Casting a concentration spell ends the caster's previous
one and every condition it added, and marks the caster `concentrating`. Damage to a
concentrating creature posts a prompt for a CON save (`d20 + con_mod + save_prof.con * pb`)
against DC 10 or half the damage, whichever is higher; failing it, dropping to 0 hit points or
pressing "Drop it" ends the spell. The GM can ignore a prompt.

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
| `shield-of-faith` | 1 `slots_1` | single, 12 | concentration; adds `shield-of-faith` (+2 AC) for 100 of the caster's turns (10 minutes) |
| `false-life` | 1 `slots_1` | self | `d4 + 4` temporary hit points |

Ranges are in grid cells of 5 feet. Saving throws roll `d20 + target.<ability>_mod +
target.save_prof.<ability> * target.pb` against the caster's `spell_dc`; the engine's
`d20-vs-dc` resolution marks success when the total meets the DC. Attack rows read the natural
die as `save.natural` (the kept die under advantage) to apply the natural 1 and 20 rules.

## Not modelled

- Advantage from conditions (a blinded attacker does not get disadvantage by itself; use the
  toggle), cover, opportunity attacks, reach beyond 5 feet, two-weapon fighting.
- Casting with a higher-level slot, incapacitation ending concentration (drop it by hand),
  spell preparation limits, components, ritual casting, pact slots recovering on a short rest.
- Death saving throws beyond a plain `d20 >= 10` button; critical hits from paralysis; damage
  types on attacks listed under `attacks` (only the readied weapons carry one); durations in
  real time outside initiative (an hour of False Life is not tracked).
- Levelling up: edit `level`, `hp.max`, hit dice and slot maxima by hand (the `max` expressions
  in `resources.json` give the numbers).
- Monster stat blocks, multiclassing, feats, subclasses other than the SRD defaults named in the
  class features, the Half-Elf's skill choices and the free language picks.

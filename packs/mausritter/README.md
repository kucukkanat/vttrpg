# Mausritter pack

A system pack for VTTRPG implementing the Mausritter mechanics: three stats (STR, DEX, WIL),
Hit Protection, pips, a ten-slot inventory grid, d20 roll-under saves and one-roll character
generation. This is an independent production compatible with the Mausritter third-party
license: it reproduces mechanics only, every table entry and description is original wording,
and it ships no art.

This file doubles as the reference for authoring other packs. Everything the engine
understands is described here; the engine (`src/rules`) never special-cases a pack.

## Files

| File | Purpose |
|---|---|
| `pack.json` | Manifest: id, name, version, grid defaults, `resolution`, optional `damage` and `concentration`, list of the other files |
| `attributes.json` | `[{ id, name, abbr?, min?, max?, derived? }]` |
| `resources.json` | `[{ id, name, max, resetOn? }]`; `max` is an expression |
| `conditions.json` | `[{ id, name, description, icon?, modifiers?, category?, resist?, immune?, vulnerable? }]`; `modifiers` maps attribute ids to numbers, `category` is `buff`, `debuff` or `neutral`, the last three list damage type ids (`all` for every type) |
| `sheet.json` | Layout rendered by the generic sheet component |
| `chargen.json` | Character generation steps and tables |
| `skills/*.json` | Skills and spells: cost, targeting, effect rows, VFX cues |
| `glossary.json` | Optional `[{ id, term, aliases?, text }]`: rules terms the skill and status tooltips link to (saves, the three attributes, armor, cells) |

Paths in `pack.json` are relative to the pack folder. `loadPack('packs/mausritter/')` fetches
`pack.json`, then every listed file, validates the shapes and parses every expression, so a
typo in a formula fails at load time rather than mid-session.

Optional files this pack does not use (see `packs/dnd5e/README.md` for a pack that does):
`files.sheets` maps extra sheet layout ids to files (a character picks one with its `sheet`
field), `files.creatureActions` holds templates that turn stat-block actions into skills,
`files.encounter` an XP budget for the encounter difficulty meter, and a top-level `creatures`
section lists compendium snapshots fetched on demand. Without `creatures`, the GM's NPC generator
and encounters roll NPCs with `chargen.json` as before. A stored attribute the pack declares but a
sheet lacks reads as 0, so a pack update can add attributes without breaking older sheets.

### Resolution

```json
"resolution": { "kind": "roll-under", "die": "d20" }
```

Tells the engine how to turn a roll with a known target number into an outcome:

- `roll-under`: success when the total is less than or equal to the target (saves against a stat).
- `d20-vs-dc`: success when the total is greater than or equal to the target.

`critical` is set when the resolution die shows its lowest or highest face. The outcome of a
roll is `{ success, critical, target }`; without a target only `critical` is filled.

Advantage and disadvantage work on the resolution die: the first single `d20` (or the
`roll-under` die) of a formula becomes `2d20kh1` or `2d20kl1`, keeping the better or worse,
where better is higher for `d20-vs-dc` and lower for `roll-under`. Formulas without that die
(damage) are left alone. The kept die is the natural one for `critical` and for `save.natural`.

### Damage model (optional)

```json
"damage": {
  "resource": "hp", "temp": "temp_hp",
  "resist": "resistances", "vulnerable": "vulnerabilities", "immune": "immunities",
  "types": [{ "id": "fire", "name": "Fire" }]
}
```

`resource` is what damage and apply-damage cards hit; `temp` names a plain number spent first
and never healed (a `heal` row on it keeps the higher value: temporary points do not stack).
`resist` / `vulnerable` / `immune` are sheet keys holding lists of type ids; active conditions
add theirs. Immunity zeroes typed damage, resistance halves it (rounding down), vulnerability
doubles it. Untyped damage only meets `all`. Packs without a model keep plain damage.

### Concentration (optional)

```json
"concentration": { "condition": "concentrating", "save": "d20 + con_mod + save_prof.con * pb", "dc": "max(10, floor(damage / 2))" }
```

Skills marked `"concentration": true` end the caster's previous concentration skill (and every
condition it added) and show `condition` on the caster. Damage to a concentrating token posts a
save prompt with the `dc` (where `damage` is the damage taken); a failed save, dropping to 0 or
"Drop it" ends the concentration.

## Sheet data

A character's sheet is a plain JSON object (`Character.data`). This pack uses:

```
str, dex, wil      { current, max }
hp                 { current, max }
pips               { current, max }        max is 250
background, birthsign, disposition, detail   strings
coat               { color, pattern }
level, xp, grit    numbers
inventory          array of 10 slots (see below)
conditions         array of condition ids
notes              string
```

Sheet fields bind to dotted paths into this object. The one special bind is `name`, which is
the character's name. Edits are reported as `onChange(path, value)` with the same paths.

### Inventory grid

An `inventory-grid` field declares `cols`, `rows` and optional `slotLabels` for the first cells.
Here the grid is 2 x 5; the first four cells are labelled Main paw, Off paw, Body, Body and the
remaining six are the pack. Cells hold `null` or an item:

```json
{ "name": "Spear", "damage": "d10", "size": 2, "slot": "paw" }
{ "name": "Bark breastplate", "armor": 1, "slot": "body" }
{ "name": "Rations", "usage": 3, "slot": "pack" }
```

- `slot` is a hint matched (case-insensitively) against the slot labels; items without a
  matching free slot fall back to unlabelled cells, then anywhere.
- `size: 2` takes two adjacent cells in one row; the second cell holds `{ "continuationOf": i }`.
- `damage` is a dice formula used by the attack skill; `armor` values are summed.

## Expression DSL

Used by `derived`, `max`, chargen `assign`, skill `cost.amount`, effect `formula`/`vs`, sheet
`roll` buttons and `{...}` placeholders in messages.

```
2d6 + 3                 dice terms: d20, 2d6, 4d6kh3, 3d6kl1
str.current - 2         identifiers are dotted paths into the sheet data
str                     a bare { current, max } id reads as its current value
d20 <= dex              comparisons: < <= > >= == !=
hp.current > 0 and not frightened
save.success ? floor(power / 2) : power
floor(x) ceil(x) abs(x) min(a, b, ...) max(a, b, ...) clamp(x, lo, hi)
roll(weapon.damage)     roll a formula held in a string ("d6"), or pass a number through
```

Rules:

- Dice are consumed left to right from the roll's seed, so every client derives the same
  result. The same seed is shared by all expressions of one chargen run or skill use.
- Attribute lookups (`str`, `str.current`) include the modifiers of active conditions.
- Derived identifiers: `name`, `weapon` (first carried item with a `damage` formula, otherwise
  Unarmed d4) and `armor` (sum of carried `armor`), unless the sheet defines those keys itself.
- Unknown identifiers are errors, as are arithmetic on non-numbers and division by zero.

## Chargen

`chargen.json` has `steps` (run in order) and `tables`. A step may have:

- `assign`: `{ "path": "expression" }`, assigned in key order (`"str.current": "str.max"`).
- `table`: roll the named table and merge the row into the sheet. `die` is a dice formula, or
  `d66` for two d6 read as tens and ones. Row keys are numbers (`"3"`) or ranges (`"4-6"`).
- `choose`: picks one of `options` with the seed and writes it to `bind`.
- `set`: literal values merged into the sheet.

Merging a row or `set` object: an array value under `items` (or the inventory bind) is placed
into the inventory grid; an array value elsewhere appends to an existing array; everything else
is assigned by dotted path.

`generateCharacter(seed, name)` is deterministic for a given seed and pack version.

## Skills

```json
{
  "id": "fireball",
  "cost": [{ "resource": "wil", "amount": "1" }],
  "target": { "kind": "radius", "range": 6, "radius": 2 },
  "effects": [ ... ],
  "vfx": [ ... ]
}
```

`cost.resource` is a resource or attribute id (its `current` is reduced) or any dotted path.
Costs are checked by `validate` and paid first by `resolveSkill`.

Effect rows run in order. Identifiers resolve against the caster (`source.x` also works); per
target, `target.x` is the current target.

| Row | Behaviour |
|---|---|
| `roll` without `vs` | Rolled once; result available as `rolls.<label>.total` and `last.total` |
| `roll` with `vs` | Rolled once per target against the `vs` expression; `save.success`, `save.total`, `save.critical`, `save.natural` are set for that target, using the pack's resolution. Advantage on a skill use applies to rows whose formula does not read `target.*` (attacks, not the targets' saves) |
| `damage` | Per target: `resource` current is reduced by the formula's result, floored at 0. Optional `type` (an id, or `{melee.type}` read from the sheet) applies the damage model |
| `heal` | Per target: raised by the formula's result, capped at the resource's `max` when present |
| `condition` | `add` / `remove` condition ids on each target (or the caster if there are none). Optional `duration: { turns, tick?: start\|end, on?: source\|target }` counts the added conditions down on that token's turns while initiative runs |
| `move` | Reported as a message; the table applies movement |
| `message` | Text with `{expression}` placeholders; emitted per target when it mentions `target` |

Rows that would reference a missing value (an unknown condition id, a save that was never
rolled) are errors, so test each skill against a fixture character.

`vfx` cues pass through untouched to the table engine: `{ at, preset, from?, to?, color?,
duration?, asset? }` with presets `hit projectile ring rain aura beam shake sound` and anchors
`source target point`.

### Skills in this pack

- `attack`: `roll(weapon.damage)` minus the target's `armor`, floored at 0.
- `fireball`: 2d6 power rolled once; each target saves vs DEX for half.
- `magic-missile`: d6+2 to one target, ignoring armor.
- `heal`: restores 2d6 Hit Protection up to the maximum.

Spells cost one point of WIL to cast; attacking is free.

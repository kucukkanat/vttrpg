# Roll modes, damage cards and durations

How the rules side of play works at the table: advantage, hidden rolls, applying damage, and
conditions that run out. Pack authors: the data formats are in `packs/mausritter/README.md`
(pack format reference) and the D&D 5e specifics in `packs/dnd5e/README.md`.

## Roll modes

The roll-mode bar (dice pad, chat, character panel) holds two local toggles:

- **Adv / Dis**: the next roll with a single resolution die (`d20`, or the `roll-under` die)
  rolls it twice and keeps the better or worse (`2d20kh1` / `2d20kl1`; better is lower for
  roll-under packs). It is spent by the roll it applies to; a damage roll leaves it armed. On a
  skill it applies to the caster's own rolls (rows that do not read `target.*`), never to the
  targets' saves. The dice button shows ADV / DIS while armed.
- **Show**: Everyone, GM only (the roller and the GM), or Blind (the GM only; the roller sees
  that they rolled). It stays until changed.

The controller stamps both onto `roll`, `skill.use` and `concentration.save` intents as they are
sent (`src/ui/rollMode.ts`), so every roll button honours them. The chat shows the rewritten
formula, strikes the dropped die and tags the roll "advantage" / "GM only" / "blind". The GM
can **Reveal** a hidden roll, which makes it an ordinary public roll.

## Privacy of hidden rolls: what it is and is not

Be clear with your table about this. **GM-only and blind rolls are hidden by the interface,
not by cryptography.**

- The game document is one Yjs doc, encrypted on the relays with the game key. Every player
  holds that key (it is in the invite link) and a full copy of the doc. A hidden roll's
  message, result and seed are in that doc. Other clients do not show it, do not animate its
  dice and do not toast it, but anyone who opens the browser's developer tools can read it.
- A player's roll intent travels to the GM encrypted with the same game key, so another player
  who listens to intents on the relay could read the seed of a GM-only roll.
- **Blind rolls** from a player: the GM's client appends its own random seed before rolling
  (`<player seed>.<GM seed>`), so the roller cannot work out the result from the seed they
  sent. The result is still in the shared doc as above.
- Treat it like rolling behind a paper screen at a table of friends: it stops accidental
  glances, not a determined peek.

### Fairness

Public and GM-only rolls keep the existing scheme: the roller's seed is in the roll, and every
client re-derives the same dice from it (`src/dice/fair.ts`). A blind roll trusts the GM: the
GM's half of the seed is chosen after the player's half is seen, which is no worse than the GM
reading a die behind the screen. Once revealed, the full seed is public and anyone can re-derive
the dice and check that the player's seed is its first half.

### What would make it private

Sealing hidden results to the GM's key (NIP-44 to the GM's pubkey) instead of the game key.
That needs ECDH with the user's identity, which NIP-07 browser extensions do not expose
(`src/net/README.md`), and the GM's other devices would need the same key. Left for later.

## Apply-damage cards

- **Skills** that deal or heal damage post one card after their messages, listing each target
  with what was applied (after resistances and temporary points). Buttons switch a target to
  ½, ×2 or Heal, or Undo; a switch first undoes the recorded change, so pressing a button
  twice never applies twice.
- **Plain rolls** with no pass/fail verdict (a damage button, `/r 2d6`) get an "Apply…" button.
  It opens a card for the viewer's selected tokens, with a damage type picker when the pack has
  types; Apply / ½ / ×2 / Heal per token.
- The GM can use every row. A player can use rows for tokens they own (they can already edit
  those sheets). Everyone sees the results.
- The GM reads the amount from the document, never from the click, so a card cannot be
  inflated. Hidden rolls have no card until revealed.

Damage math (`src/rules/damage.ts`) follows the pack's `damage` model: immunity zeroes typed
damage, resistance halves it (rounding down), vulnerability doubles it, temporary points absorb
first. Packs without a model apply plain amounts to their first resource.

## Condition durations

A condition can carry a duration in turns (`Token.effects[conditionId]`): the GM sets one when
switching a condition on in the token's Conditions card, or a skill's `condition` row sets it
with `duration`. While initiative runs, ending a turn ticks the `end` durations counted on that
token and starting the next turn ticks the `start` ones (`on` picks whose turns count, for
"until the end of the caster's next turn"). At zero the condition is removed from the token and
its sheet, with a chat notice. Status displays read `remaining`, `category` and `concentration`
from `conditionChips` (`src/table/tokenHud.ts`).

## Concentration

For packs with a `concentration` rule (D&D 5e). A skill marked `concentration` ends the caster's
previous concentration skill and every condition it added, then marks the caster as
concentrating (`Token.concentrating` and the pack's condition). Damage to a concentrating token,
from a skill or a card, posts a save prompt (DC from the pack's `dc` expression). "Roll save"
(GM or owner, honouring Adv / Dis) rolls the pack's save formula; failing it ends the
concentration. So does dropping to 0, "Drop it" in the prompt or "End" in the character panel.
The GM can "Ignore" a prompt.

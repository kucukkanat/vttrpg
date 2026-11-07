# Game screen UX

How the game screen uses the space on phones, tablets and desktops. The table is the product;
everything else is chrome that must earn its pixels. One React tree (`src/ui/shell/GameShell.tsx`)
renders every layout, so the 3D canvas never remounts when the viewport crosses a breakpoint.

## Table layout

The board fills the screen. Everything else sits on or around it like objects on a real table, and
each thing has exactly one home (research and audit: `research_notes/UI redesign/`).

| Piece | Where | What it holds |
|---|---|---|
| Top rail | wood, along the top | the game's plaque (name, connection, role), the live scene (GM: opens the scene switcher, the list and Go live; settings are Build's), the combat control (GM: Roll initiative; in combat Next turn and End), who is here (opens Players), Invite (GM), the bell, Search (Ctrl/⌘-K), the ⋯ menu |
| Standees | top edge of the board | turn order, only in combat; tap for the tracker card |
| Tool rail | left edge | Eyes, Top (with Q/E turns), grid, ruler, ping, Select (touch), Fog (GM in Play: a pop-out with the Reveal / Hide brush, its size, Reveal all and Hide all; the same build fog tools, Esc puts the brush away), and the Journal book with a "new" ribbon |
| The hand | bottom centre | the selected token (a player's own when nothing is selected): name (opens the character card), find-on-table, HP, saves and skills as cards, End turn; GM adds −/+, Conditions, the skill list and combat join/leave. Hide, Assign and Remove live in the token menu (⋯, right-click, long-press) |
| The scroll | right edge | chat. Rolled up it is a rod with the unread count; `]` or a tap unrolls it. The composer has one seal control for the whisper target and the roll mode (advantage, who sees rolls) and a log filter |
| Dice well | bottom right | dice roll inside the well, never over the board; the result reads out on a paper slip beside it; the brass Roll coin opens the dice pad |
| GM screen | bottom left, GM only | a leather plaque with **Play / Prep / Build** and a live line (sounds playing, the round). **Prep** raises three leaves over the board: Scenes & encounters (Scenes, Prep), Cast (Tokens, Skill editor), Reference (Sound, Players, Journal, Credits). **Build** folds into a tool tray (Library, Tools, Kit, Scene settings) beside a live board: the Library picks a model up (a ghost on the cursor; click stamps, R or the wheel turns, Alt is free, Esc puts it down), Alt-click on a prop is the eyedropper. My models cards have a menu (Rename, Remove from library, confirmed on the card) and show the upload status. A thin budget bar at the tray's foot shows the scene's triangles, draw calls and texture memory against this device's graphics tier, warning-coloured over the low tier; hovering it lists the five heaviest models with Select all of these. Co-GMs in Build see each other's cursor ring and name, a faint ghost of what they hold and a thin outline on what they have selected, in their colour; it clears when they leave Build or idle for 30 s, and players never see it. A first Build visit gets one-time tips (pick up, turn, put down, undo, paste). Credits lists the scene's models that need attribution: a Reference tab for the GM, a card for players. The board's frame takes the mode's colour: brass, green, blue |
| GM drawer | on the plaque, GM in Play | a button beside Play \| Build fans out Sound ("2 playing"), Players ("3 here"), Journal ("1 new"), Tables, NPC, Encounters ("Ambush ready") and Credits; each opens as the one card. NPC places its result near the camera, hidden, selects it, closes and offers Undo. Encounters › Run places the creatures (hidden, or visible by a toggle) and asks "Roll initiative for N creatures?": out of combat it starts combat with them included, in combat their rows join as groups |
| One card | over the board's left side | any other panel (Character, Skills, Initiative, Journal, Players, Sound, Scenes for players): one at a time, Esc or ✕ puts it away |
| Command palette | Ctrl/⌘-K or Search | every action, panel, token and scene, with where it lives and its key |
| The bell | top rail | whispers, handouts and anything else with an action, kept until handled (toasts still flash; `ui/attention.ts`) |

`shell/tableLayout.ts` holds this state (mode, card, scroll, leaf tabs, palette, bell, phone sheet)
and `routePanel(id)` decides where any registry panel opens, so `openPanel(id)` from shortcuts,
toasts and panels needs no knowledge of the layout.

## Breakpoints

| Name | Width | Pointer assumed | Layout |
|---|---|---|---|
| phone | < 700 px | coarse | board full-screen, five-target bottom bar, one bottom sheet |
| tablet | 700–1099 px | coarse | the table layout, narrower card and scroll, smaller well |
| desktop | ≥ 1100 px | fine | the table layout |

Width decides the layout; `@media (pointer: coarse)` decides control sizes independently. A phone
in landscape (812 × 375) is treated as a tablet.

### Phone

```
┌──────────────────────┐  top rail: plaque · combat coin · bell · search · ⋯
│  standees (combat)   │
│        BOARD         │  the dice well appears bottom-right only while dice roll
│ ┌ the hand ────────┐ │  the selected (or own) token's cards
├──────────────────────┤
│ ═══ one sheet ═══    │  the scroll, the card, the dice pad, the GM screen or Tools
├──────────────────────┤
│ Dice Scroll Sheet Screen|Journal Tools │  56 px + safe area
└──────────────────────┘
```

- Five targets: Dice (the pad), Scroll (badge), Sheet (character card), Screen for the GM (Play /
  Prep / Build, then the leaf and tab) or Journal for players (badge), Tools (camera and table
  tools, Search, every other panel).
- One sheet at a time: opening any place closes the others (`open(id, isGm, phone)`).
- Sheets keep the half/full drag, Esc and the keyboard inset as before (`BottomSheet.tsx`).
- Aiming a skill closes the sheet; the table's own aim bar has Cancel.

## Touch targets

- Every tappable control is at least 44 × 44 px on coarse pointers: buttons, list rows, tabs,
  the sheet handle (whole header row is the drag surface), swatches (36 px visual in a 44 px hit).
- Fine pointers keep the compact sizes (32 px buttons, 32 px rows) so desktop density survives.
- No hover-only affordances: the trash icon, camera-mode toggle and section chevrons are always
  visible; hover only tints borders.
- Spacing between adjacent targets ≥ 8 px so mis-taps hit nothing instead of the neighbour.

## Typography scale

| Token | Size | Use |
|---|---|---|
| `--fs-xs` | 11 px (12 px on touch) | tags, tab labels |
| `--fs-sm` | 12 px | panel headers (uppercase), meta ("you", "hidden"), muted hints |
| `--fs-md` | 14 px | body, list rows, chat |
| `--fs-lg` | 16 px | inputs on touch (prevents iOS focus zoom), sheet titles |
| `--fs-xl` | 18 px | character name |

System font stack for body text; line-height 1.35; `-webkit-text-size-adjust: 100%`. Nothing is
smaller than 12 px on coarse pointers. Sizes are `calc(N px * var(--text-scale))`, so the text-size
preset (Players panel: default ×1, large ×1.15, larger ×1.3, `data-text-scale` on `<html>`) scales
every size drawn from these tokens, including the nameplates and labels over the table.

**Display face:** Alegreya Bold (SIL Open Font License 1.1, `src/ui/theme/fonts/OFL.txt`), latin
subset, one 24 kB woff2 bundled with the app (no font server). `--font-display`, with lining,
tabular figures. Used for names, titles and the numbers that matter: panel and sheet titles, the
game name, character and token-bar names, nameplates, roll totals, the round badge and the scene
title. Everything else (labels, controls, chat) keeps the system stack.

## Art direction

A candle-lit miniature diorama under a well-made game-box insert. The table is muted, mid-value
scenery; the tactical layer (grid, reach, templates, rings, selection) owns the saturated colours
and the value extremes. The chrome stays flat and clean: near-black neutrals, one display face,
parchment cream (`#f3ead8`) for in-world text, no ornate frames. Packs may tint it (accent, display
face, frame tint) but never move anything.

Four rules hold everywhere:

1. **One meaning per colour.** A colour on the table or in the HUD means one thing (table below).
2. **Every colour has a shape twin**: a ring style, a glyph, a pattern or a word, so nothing
   depends on telling red from green.
3. **Urgent state lives on the token it concerns** (rings, HP bar, status chips, nameplate).
4. **One icon family**: 24-unit grid, `ICON_STROKE` 1.75, round caps, `currentColor`
   (`src/ui/icons.tsx`). Skill icons, status glyphs (`src/ui/theme/glyphs.ts`) and the CSS-only
   masks (`--icon-die`, `--icon-chevron`, `--icon-warn`) use the same grid and stroke. No emoji or
   text glyphs in the chrome; custom skills may still carry an emoji as user content.

## Colour roles

CSS custom properties in `src/ui/global.css` carry the roles for the DOM; `src/ui/theme/palette.ts`
carries the same values for the 3D table, which imports them instead of writing hex literals.
`src/ui/theme/palette.test.ts` keeps the two in step and checks contrast and colour-vision
separation (below). Scenery materials and lights are not colour roles.

| Role | Token / constant | Dark | Daylight | Backup | Where |
|---|---|---|---|---|---|
| Brand, primary action | `--accent` / `BRAND` | `#e0a458` | `#8f4c00` | filled button, weight 600 | primary buttons, links, focus ring, unread badges |
| Now: whose turn | `--now` / `NOW` | `#ffc53d` | `#7a5600` | pulse, double ring, "YOUR TURN" | turn ring, token bar ring and pill, current disc and row, round badge |
| Selected | `--select` / `SELECT` | `#f3ead8` | `#17150f` | solid ring, nameplate shown, inset edge | token and prop selection, open tab, active chip or row |
| Mine | `--mine` / `MINE` | `#7cc4ff` | `#0b63c4` | "YOU" tag, thicker owner ring | own owner ring fallback, own disc in the turn strip, find-me, pings, players' templates |
| Hostile / targeted | `--hostile` / `HOSTILE` | `#ff7a4d` text, `#ff5a1f` 3D | `#b8360a` | crosshair ticks, sawtooth rim, hatch, "!" | target ring, GM-side templates |
| Help (heal, buff) | `--help` / `HELP` | `#3ee08f` | `#0b6b3d` | "+" pattern and badge | heal and buff templates and target rings |
| Measurement | `--measure` / `MEASURE` | `#e8dcc0` | `#5a5549` | dashed edge, distance label | ruler, range preview, skill range ring, move path, elevation line |
| Roll total | `--total` | `--fg` | `--fg` | size and display face | chat totals, roll toast |
| Crit / fumble | `--ok` / `--bad` | `#8fd18f` / `#f28b82` | `#186b26` / `#b3261e` | star / broken ring glyph | dice faces, chat tag, roll toast |
| HP bands | `--hp-*` / `HP_*` | `#3fbf7f` · `#f2b33d` · `#d8342c` | same | pip count, drop at ≤ 50 %, skull at 0 | token bar, floor bar, character card |
| Whisper | `--whisper` | `#c58af9` | `#7b2fbf` | lock glyph | chat |
| Waiting (GM away) | `WAITING` | `#9a9892` | – | ghosted token | queued move ring |
| Crit / down numbers | `CRIT` / `DOWNED` | `#fff1c9` / `#ff2e4d` | – | "crit!" / "down" tag, size tier | floating numbers (gold stays "now") |
| Declared enemy intent | `HOSTILE` | `#ff5a1f` | `--hostile` | "!" triangle, flag icon | declared-action marks, tracker rows, turn-strip badge |
| Owner | presence colour | – | – | owner shape on the ring and nameplate | owner rings (`ownerShape.ts`) |
| Build layer | `BUILD` | wall `#e8dcc0`, door `#3ee08f`, open door `#7cc4ff`, locked/erase `#ff5a1f`, proposal `#4fd1ff` | – | line style per kind | GM walls, doors and fog brush |
| Press glow | `--select` | cream at 26–34 % | same | same-frame halo | every pressed control |

Neutrals (dark → daylight): `--bg` `#0e0e10` → `#f4f1ea`, `--panel` `#17171b` → `#fbfaf6`,
`--panel-2` `#1f1f25` → `#ece8de`, `--fg` `#e8e6e3` → `#17150f`, `--muted` `#9a9892` → `#5a5549`,
`--border` `#2a2a31` → `#b9b1a1`, plus `--btn`, `--hover`, `--row-on`, `--well` for buttons, hover,
selected rows and inset notes.

**Glass:** one recipe per weight, all with `--glass-blur` (6 px): `--glass` (`rgba(18,18,22,.9)`:
dock, chip, camera pill, callouts), `--glass-strong` (`.95`: menus, dice pad, tips) and `--scrim`
(`rgba(0,0,0,.72)`: toasts, targeting and preview bars, table overlays). Text on glass is
`--on-glass`; buttons on glass `--glass-btn` with a `--glass-edge` border; error banners
`--error-glass` with `--on-error`. Labels drawn over the 3D table (nameplates, distance labels) use
`LABEL_GLASS` and `PARCHMENT` from the palette and stay dark in both themes, because the table does.

**Checks** (`src/ui/theme/contrast.ts`, run by `palette.test.ts`):

- WCAG AA (4.5:1) for `--fg`, `--muted`, `--accent`, `--now`, `--mine`, `--hostile`, `--help`,
  `--ok`, `--bad`, `--danger`, `--whisper` on `--bg`, `--panel` and `--panel-2`, in both themes, and
  for the filled pills (`--accent-fg` on `--accent`, `--now-fg` on `--now`). Lowest dark values:
  muted on panel-2 5.7:1, hostile text 6.9:1; lowest daylight: help on panel-2 5.4:1, now on panel-2 5.4:1.
- Colour-vision simulation (Machado 2009 at full severity, protan / deutan / tritan) with a CIE76
  distance between the simulated colours: rings (select, hostile, mine, now) and templates (mine,
  hostile, help) stay above ΔE 15, HP bands above 25, status categories above 12. The HP green
  moved from `#5fd36b` to `#3fbf7f` and red from `#e0453a` to `#d8342c` to get there (protan
  separation of the old high/mid pair was 17.8); every pair also has its shape backup.
- The hostile red-orange is `#ff5a1f` on the table (fill and rings) and `#ff7a4d` as text, which
  passes AA on the panels.

## Telegraphs

Skill templates (`src/table/TargetingLayer.tsx`, rules in `src/table/telegraph.ts`) are keyed to
who owns the effect and what it does, not to "threat to me":

| Template | Colour | Rim | Fill | Centre badge |
|---|---|---|---|---|
| Players' side, harmful or neutral | blue `MINE` | dashed while aiming, solid once staged | low-alpha solid, darker when staged | none |
| GM side, harmful or neutral | red-orange `HOSTILE` | the same, plus sawtooth teeth outside | diagonal hatch | "!" in a diamond |
| Heal or buff, either side | green `HELP` | dashed / solid | "+" pattern | "+" in a circle |
| Range of the skill | cream `MEASURE` | dashed thin | none | none |
| Ally inside a harmful template | – | – | – | warning triangle over the ally, "Friendly fire: names" on the bar |

- The skill's intent comes from its effects: damage or a save is harmful; heals and added buff
  conditions help; anything else is neutral.
- Tokens inside the template ring in the template colour with four crosshair ticks.
- During combat, a template from a caster whose turn it is not is drawn at 45 % strength.
- The targeting bar states the outcome: "Fireball → Bramble, Rat · 2-cell burst · hits 1 enemy,
  1 ally", live while aiming and fixed once staged. Allies and enemies are relative to the caster
  (player characters on one side, the GM's tokens on the other).

## Status icons

Conditions on tokens, in the token bar's GM toggles and on the character card share one look
(`src/ui/StatusBadge.tsx`, `src/table/statusSprites.ts`, data in `src/table/tokenHud.ts`):

| Category | Border shape | Colour | Examples |
|---|---|---|---|
| buff | circle | `#43d39e` | shield of faith, invisible |
| harm | hexagon | `#e5484d` | blinded, injured |
| control | square | `#ffb347` | stunned, restrained, prone, frightened |
| magic | shield | `#4c8dff` | concentration, drained |
| affliction | diamond | `#c77ddd` | poisoned, exhaustion, hungry |

- A monochrome glyph (`ConditionDef.icon`, drawn from `src/ui/theme/glyphs.ts`) sits on a dark
  fill inside the frame; a pack condition without a known glyph shows its two letters instead, and
  a condition the pack does not define gets a grey frame.
- `ConditionDef.category` sets the kind (`CONDITION_CATEGORIES` in `src/core/pack.ts`, the one scheme
  the loader accepts); without it the id is matched against common names, else harm. Both bundled
  packs set it; `concentrating` is magic.
- The same badge shows in the encounter frame rows. The bloodied and down states use one pair of
  glyphs everywhere: the drop and the skull on the token bar, the tracker (`VitalGlyph`), the
  encounter summary and the table (`CombatBadges`, via `vitalMaterial`).
- Turns left show as a number on the lower right corner from `Token.effects[id].remaining`
  (src/state/effects.ts). Without a duration, no badge. On the last turn the chip pulses
  (reduced motion: a thicker frame).

## Themes

- **Lamplight** (dark) is the default: stained wood and leather neutrals under brass. **Parchment**
  (`daylight`) is the light set for bright rooms. "Match the device" follows
  `prefers-color-scheme`; the Players panel or the palette switches by hand (`vtt.theme`).
- The table's materials do not change with the theme: the wooden rail, the leather GM screen,
  brass fittings and the felt well (`--wood`, `--leather`, `--brass*`, `--felt` in global.css).
  Cards, the scroll, leaves, the tray and the palette are paper in every theme: `.skin-paper`
  re-declares the colour tokens locally, so any panel mounted on paper reads as ink on parchment
  without changes of its own. `palette.test.ts` checks AA contrast for dark, daylight and paper.
- Body text is Alegreya Sans, names and numbers Alegreya (both bundled, SIL OFL).
- **Pack theme hook** (`pack.json` → `"theme"`): `accent` and `accentFg` (`#rrggbb`), `frameTint`,
  `displayFont: { family, src, weight }`. The accent is only used while it keeps AA contrast on the
  current theme's panels. Applied while a game of the pack is open (`usePackTheme`).

## Spacing scale

`--sp-1` 4 px · `--sp-2` 8 px · `--sp-3` 12 px · `--sp-4` 16 px · `--sp-5` 24 px.
Panel padding `--sp-3`; stack gap inside panels `--sp-2`; sheet side padding `--sp-4` on phones
(thumbs), `--sp-3` elsewhere. Radii: `--r-sm` 6, `--r-md` 10, `--r-lg` 16 (sheet corners).

## Safe areas

- `viewport-fit=cover` is set; the top bar adds `env(safe-area-inset-top)`, the bottom bar and
  floating controls add `env(safe-area-inset-bottom)`, side gutters add the left/right insets in
  landscape.
- The table canvas itself ignores the insets (the scene may render edge to edge); HUD elements
  on top of it (chip, toast, targeting bar) respect them.

## What stays visible during play

| Element | phone | tablet / desktop |
|---|---|---|
| board | always (a half sheet leaves ≥ 45 %) | always, edge to edge |
| the selected token | the hand above the bar | the hand, bottom centre |
| turn order | standees (combat only) | standees (combat only) |
| dice | in the well, shown while rolling | in the well, with the read-out slip |
| unread chat | badge on Scroll | badge on the scroll's rod |
| things waiting | the bell's count | the bell's count |
| targeting bar | the table's own bar | the table's own bar |

## GM-only controls

- `PanelDef.scope: 'gm'` panels are filtered out for players everywhere, the palette included.
- The GM screen (plaque, leaves, tray), the combat control and Invite exist only for the GM;
  players only ever have Play. A GM demoted mid-session drops back to Play.
- Inside panels the GM checks `controller.connection.isGm` (unchanged).

## Keyboard shortcuts (desktop, ignored while typing in a field)

`SHORTCUTS` in `shell/useShortcuts.ts` is the list the `?` overlay shows; the main ones:

| Key | Action |
|---|---|
| `Cmd/Ctrl+K` | search everything (the command palette) |
| `[` / `]` | put the card away / unroll or roll up the scroll |
| `/` | write in the scroll (unrolls it) |
| `1`–`9` | open the n-th panel as the card (again to put it away) |
| `Esc` | close a tip, card, menu or the raised screen; cancel aiming; deselect |
| `G` / `F` / `T` / `M` | grid / first person / top-down / ruler (table) |
| `Q` / `E` | turn the top-down view 45° |
| `Enter` | cast the staged aim |
| `Delete` / `Backspace` | remove the selected props (GM, one undo step) |
| `Z` | Zen (with props selected in Build or edit mode it constrains to Z instead) |
| `i` | on a focused skill chip: pin its tooltip |

The shell never binds a key the table uses.

Build keys, with props selected in Build or edit mode (GM; `table/build/transformKeys.ts`):

| Key | Action |
|---|---|
| Shift-click / drag on empty board | add or drop a prop / box select (mouse; Shift adds, Alt-drag orbits) |
| `Tab` | cycle move, turn, scale (the gizmo highlights it) |
| `X` / `Y` / `Z`, a number, `Enter` | move metres, turn degrees or scale along that axis; `Esc` cancels; expressions such as `1.5*2` work |
| `R` / `Shift+R` | turn 15° / 90° about the selection's centre |
| `End` | drop onto the surface below |
| `A` | advanced gizmo (3-axis rings, per-axis scale, local or world axes, numeric inspector in Details) |
| `Cmd/Ctrl+C` / `V` / `D` | copy / paste under the pointer / duplicate one cell over; Alt-drag duplicates |
| `Esc` | let go of the props |

The simple gizmo is a turn ring on the floor (15°, Shift 90°), a height arrow and a uniform scale
cube; dragging a prop moves the selection (half cells, Alt free). Every transform is one
`props.update`, so one undo step. On touch: tap selects, drag moves, two-finger twist and pinch
turn and scale when the first finger is on the selection, and a long-press opens Duplicate, Turn,
Drop to surface, Edit and Delete. Copied props also go to the system clipboard as `vttprops:` text,
which pastes into another scene or game.

Kit keys, while a Kit tool is out (GM; `table/kits/`):

| Key | Action |
|---|---|
| drag | Floor: a rectangle of floor. Wall: walls along the grid lines (corners, tees and crossings join by themselves); Shift or "Room outline" draws the four walls of a room. Roof: a roof over the room. Erase: everything in the rectangle |
| click | Door / Window: put one in the wall under the pointer. Stairs: stairs up to the next level. Pillar: on the grid corner. Pick: take the piece under the pointer in hand |
| `R` / `Shift+R` | turn the piece in hand a quarter |
| `PgUp` / `PgDn` | build one level up or down (also the ▲ ▼ control at the board's top right) |
| `Esc` | put the tool away |

Every tool shows a ghost (blue: what it adds, red: what gives way) and every stroke is one
`tiles.place`, so one undo step. The cutaway (the tray's slider, or ✂ on the board) hides every
level above the cut, props and tokens included; on "auto" it follows the selected token's level,
or the level being built while a Kit tool is out. Kits need a tablet or a desktop.

## Play flows on touch and feedback

Each flow is one short sequence, learned once. Every new motion respects
`prefers-reduced-motion`; every cue with sound or vibration has a toggle in the Players panel.

| Flow | What happens | Where |
|---|---|---|
| Press feedback | Every button glows on `pointerdown`, before the next paint, with a halo wider than a fingertip; touch presses add an 8 ms vibration where `navigator.vibrate` exists (not iOS Safari) | `ui/feedback/press.ts`, `.is-pressed` in global.css |
| Two-tap move | Your token selected, tap a cell: path, distance ("4 cells · 6 m") and a ghost; tap the same cell again or Move to commit; another cell re-aims; Cancel or Esc drops it. Drag still moves at once; mouse clicks unchanged | `table/twoTapMove.ts`, `table/MovePreview.tsx` |
| Area aim on touch | Bursts, cones and lines snap to cell centres; while the finger drags, the aim rides 64 px above the touch point | `table/targeting.ts` (`fingerAimPoint`, `snapAim`) |
| Radial token menu | Long-press a token: Sheet, Attack, Ping, (GM) HP −1 / +1, Hide, Edit, More in a ring around the finger, pulled in from the edges; More opens the list menu | `ui/shell/ContextMenu.tsx` |
| Layered tooltips | Hover or focus a skill chip (or a status badge) to see it; hold it on touch, tap the tip, or press `i` to pin. Glossary terms in a tip open a second level; that level has no links (two deep at most) | `ui/tips/` |
| Skill previews | The skill tip loops a small SVG of the cells its shape covers (dart, bloom, sweep), drawn with the table's own targeting maths | `ui/tips/ShapePreview.tsx` |
| Feedback hierarchy | Ordinary hits: number, flash and a small ground ring. Knock-downs: larger crimson number tagged "down". Crits: largest gold number tagged "crit!", an 85 ms hit-stop and a shake. Nothing else shakes on its own | `table/vfx/numbers.ts`, `hitStop.ts` |
| Turn start | The turn ring flares out once for everyone; the owner hears a chime and, where supported, feels a vibration (Turn chime toggle) | `table/TokenOverlays.tsx`, `ui/feedback/TurnCue.tsx` |
| Dice | The toast's total pops when the dice settle; on phones the dice then shrink into the toast after 1.2 s, and leave at once when the keyboard or a full sheet needs the room | `dice/choreography.ts` |
| Owner shapes | Each player's tokens carry one of six shapes on the owner ring, on the nameplate and in the Players panel, so ownership never depends on colour alone | `table/ownerShape.ts` |

Packs may ship `glossary.json` (`[{ id, term, aliases?, text }]`); conditions and resources are
glossary terms already. Phone and tablet get no shortcut layer; hardware
keyboards still reach the table's own keys.

## Checklist

- [x] global CSS tokens (spacing, type, colour, radii, materials), coarse-pointer 44 px rule, 16 px inputs
- [x] `GameShell` picks the layout from `useBreakpoint`, single tree, canvas does not remount
- [x] Table layout: top rail, standees, tool rail, the hand, the scroll, dice well, GM screen, one card
- [x] Every panel has one home (`routePanel`, tested) and is reachable from the command palette
- [x] Dice roll inside the well only
- [x] GM screen: Play / Prep (three leaves) / Build (tool tray), mode-coloured board frame
- [x] One home each for the roll mode (the scroll's seal), Hide / Assign / Remove (token menu), turn order (standees)
- [x] The bell keeps actionable notices until handled
- [x] Phone: five-target bar, one sheet at a time, the hand above the bar, safe areas, keyboard inset
- [x] Keyboard shortcuts, Ctrl/⌘-K, the `?` overlay lists them all
- [x] `npm run typecheck`, `npx vitest run`, `npm run build:check` green
- [x] Verified in the browser at 390 × 844 and 1440 × 900 as GM and player, with screenshots

Visible controls in idle play, counted in the browser (buttons, fields and tabs on screen, not
covered): GM desktop 19 (76 before), player desktop 22–24 with the own token's hand up (35 before),
GM phone 10 (17 before).

## Layout presets, Zen and Display

The ⋯ menu holds Zen mode and three presets (`src/ui/shell/layoutPresets.ts`), per device:

| Preset | For | What it does |
|---|---|---|
| Standard | everyone | the table layout, fitted to the screen |
| Compact | any | the phone arrangement (bottom bar and sheets) at any width |
| Display | TV or shared screen | the board, the standees and the dice well only; a corner button exits |

Zen (Z, or the menu) hides every bit of chrome over the table for the session; Z, Esc or the
corner "Show UI" button restores it. Both only hide chrome with CSS, so the canvas stays mounted.
Stored column presets from before the table layout ("GM desk", "Player desk") read as Standard.

## Sound and cues

The soundboard has a volume per pad (this device, sent with each play), stop per pad and "Stop
all" (an `audio.stop` intent, so everyone stops hearing it), and a ring on pads that are
playing. Everyone has a master volume in the Players panel settings, next to the optional
"Your turn" and "Effect ended" cues: each can sound, speak or both, is off by default, and
always shows a toast when on so no cue is audio-only.

## Game files and third-party packs

The GM exports the whole game from the ▣ menu as one `.vttgame.json` file: the document as plain
JSON plus the bytes of every asset the device can fetch, each checked against its hash.
New game, "Or import a game file", creates a new game from it with you as GM. The New game
page also loads a pack by address (a folder with `pack.json`, served with CORS) or from a bundle
file `{ "format": "vttrpg-pack", "files": { "pack.json": ..., "sheet.json": ... } }`, validated
with the same loader the game uses before Create is allowed.

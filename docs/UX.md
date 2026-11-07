# Game screen UX

How the game screen uses the space on phones, tablets and desktops. The table is the product;
everything else is chrome that must earn its pixels. One React tree (`src/ui/shell/GameShell.tsx`)
renders all three layouts, so the 3D canvas never remounts when the viewport crosses a breakpoint.

## Breakpoints

| Name | Width | Pointer assumed | Layout |
|---|---|---|---|
| phone | < 700 px | coarse | table full-screen, bottom tab bar, bottom sheet |
| tablet | 700–1099 px | coarse | table full-screen, one right drawer with tabs |
| desktop | ≥ 1100 px | fine | three columns, side columns resizable and collapsible |

Width decides the layout; `@media (pointer: coarse)` decides control sizes independently (a touch
laptop at 1400 px gets desktop columns with 44 px controls; a mouse on a narrow window gets the
sheet with compact controls). Orientation changes on tablets stay inside the tablet range. A phone
in landscape (812 × 375) is treated as a tablet: a 360 px drawer beside the table beats a 55 %
sheet on a 375 px tall screen.

## Layout per breakpoint

### Phone

```
┌──────────────────────┐  top bar 44 px + safe-area top: name · status dot · role · ⋯ menu
│ ● Token name   Sheet ›│  selected-token chip (tap → Character sheet)
│                      │
│        TABLE         │  fills everything between the bars; always interactive
│                      │
│     ╭──── roll ────╮  │  roll toast: "2d6+1 → 9" for 6 s; 3D dice land over everything
├──────────────────────┤
│ ═════ Tokens  [+] ✕  │  bottom sheet: handle, title, panel's own action buttons, close
│  panel content …     │  half = 55 % of the shell height; full = up to the top bar
├──────────────────────┤
│ 🗺  ♟  ✎  👥 📜 ✦ 💬(3)│  tab bar 56 px + safe-area bottom; one tab per panel in `PANELS`
└──────────────────────┘
```

- Tabs come from `PANELS`, in registry order, `scope: 'gm'` entries only for the GM.
- Tap a tab → that panel opens as a half sheet. Tap the active tab → the sheet closes.
- Drag the handle: up past 70 % of the way to full snaps to full, down past 40 % below half closes.
  Swipe left/right on the header switches to the neighbouring tab (wraps at the ends).
- Half sheet: the table above it stays interactive (no backdrop). Full sheet: the table is hidden
  behind content; the top bar stays.
- Chat tab shows a badge with the number of messages appended since the chat sheet was last open.
- The on-screen keyboard: the sheet bottom follows `visualViewport` (the shell writes
  `--kb` = keyboard height), so the chat input stays above the keyboard. While the keyboard is open
  the sheet goes full so the log stays readable.
- `env(safe-area-inset-bottom)` pads the tab bar; the sheet sits above the tab bar, so the home
  indicator never covers content.

### Tablet

```
┌───────────────────────────────┬──────────┐
│ top bar: name · ● · role · invite · ☰    │
├───────────────────────────────┬──────────┤
│ ● chip                        │ tabs ⟷   │  drawer 360 px: horizontally scrolling tab strip,
│                               │──────────│  one panel at a time, panel body scrolls
│            TABLE              │ panel    │
│                               │          │  pinned: docked, table shrinks (grid column)
│                               │ 📌  ✕    │  unpinned: floats over the table's right edge
└───────────────────────────────┴──────────┘
```

- `☰` in the top bar (and a slim edge tab on the right when hidden) toggles the drawer.
- Pin state and the active tab persist in `localStorage` (`vtt.shell.tablet`).
- Left-column panels (`side: 'left'`) are simply the first tabs; there is one tab strip.

### Desktop

```
┌──────────────────────────────────────────────────────┐
│ top bar                                               │
├────────┬─┬───────────────────────────────┬─┬─────────┤
│ ▾Scenes│‖│                               │‖│▾Character│  side columns: 200–480 px, default 260 / 340
│ ▾Tokens│ │           TABLE               │ │▾Skills   │  drag the 8 px handle to resize
│ ▸Edit  │ │                               │ │▾Chat     │  double-click the handle to collapse
│ ▾Players│ │                              │ │  …input  │  collapsed column = 28 px rail with ▸
└────────┴─┴───────────────────────────────┴─┴─────────┘
```

- Panels are collapsible sections; each section's open state, the column widths and collapsed
  state persist in `localStorage` (`vtt.shell.desktop`).
- `.table` keeps `position: relative` with `minmax(0, 1fr)` in the grid; the canvas is
  `display: block; width/height 100%` and can never push the grid wider.
- Chat is the last right-hand section and takes the remaining height (`flex: 1`), its log scrolls.

## Navigation model

One source of truth per breakpoint, all three fed from `PANELS`:

- phone: `activeTab: string | null` + `sheet: 'half' | 'full'`
- tablet: `activeTab: string`, `open: boolean`, `pinned: boolean`
- desktop: `collapsed: Record<panelId, boolean>`, `left/right: { width, open }`

Panels receive only `{ controller }` and know nothing about where they are mounted. The shell
hosts a panel in a `.hosted` wrapper that promotes the panel's own `<h3>` action buttons
(Tokens "+", Skills "Cancel") into the host's header row and hides the duplicate title text, so
the sheet/drawer/section header is the only title.

Opening the Character sheet from the selected-token chip, and the chat tab from the roll toast,
are the two cross-links; both go through the same `openPanel(id)` function.

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
- `ConditionDef.category` sets the kind; without it the id is matched against common names, else
  harm. Both bundled packs set it.
- Turns left show as a number on the lower right corner when the token or sheet carries duration
  data (`{ id, turns }` entries, or a `conditionDurations` / `durations` map; `remaining`, `rounds`
  and `duration` are read too). Without durations, no badge. On the last turn the chip pulses
  (reduced motion: a thicker frame).

## Themes

- **Dark** is the default. **Daylight** is a high-contrast light set for bright rooms and outdoor
  phones. "Match the device" (the default preference) follows `prefers-color-scheme`; the Players
  panel switches by hand (`vtt.theme` in localStorage, `data-theme` on `<html>`). The 3D table and
  the labels over it stay dark in both.
- **Pack theme hook** (`pack.json` → `"theme"`): `accent` and `accentFg` (`#rrggbb`), `frameTint`
  (washed over the top bar, columns, drawer, sheet, tab bar and the glass over the table at
  8–10 %), `displayFont: { family, src, weight }` (a woff2 in the pack folder). The accent is only
  used while it keeps AA contrast on the current theme's panels. Applied while a game of the pack
  is open (`usePackTheme` in `GameShell`).

## Spacing scale

`--sp-1` 4 px · `--sp-2` 8 px · `--sp-3` 12 px · `--sp-4` 16 px · `--sp-5` 24 px.
Panel padding `--sp-3`; stack gap inside panels `--sp-2`; sheet side padding `--sp-4` on phones
(thumbs), `--sp-3` elsewhere. Radii: `--r-sm` 6, `--r-md` 10, `--r-lg` 16 (sheet corners).

## Safe areas

- `viewport-fit=cover` is set; the top bar adds `env(safe-area-inset-top)`, the tab bar and
  floating controls add `env(safe-area-inset-bottom)`, side gutters add the left/right insets in
  landscape.
- The table canvas itself ignores the insets (the scene may render edge to edge); HUD elements
  on top of it (chip, toast, targeting bar) respect them.

## What stays visible during play

| Element | phone | tablet | desktop |
|---|---|---|---|
| table | always (half sheet leaves ≥ 45 %) | always | always |
| selected-token summary | chip on the table | chip on the table | Character section |
| dice results | 3D dice over everything + roll toast | same | same, over the table |
| unread chat | badge on the Chat tab | badge on the Chat tab + ☰ | always visible |
| targeting bar | table's own bar, above the sheet's half line | table | table |

## GM-only controls

- `PanelDef.scope: 'gm'` panels are filtered out for players in every shell.
- Inside panels the GM checks `controller.connection.isGm` (unchanged): add token, scene
  controls, owner select, remove.
- Top bar: "GM" role chip and the invite-copy button for the GM only; on phones both live in
  the ⋯ menu. Players see "Player" and only Leave.

## Keyboard shortcuts (desktop, ignored while typing in a field)

| Key | Action |
|---|---|
| `[` / `]` | toggle left / right column |
| `/` | focus the chat input (opens Chat if collapsed) |
| `1`–`9` | toggle the n-th panel section (registry order) |
| `Esc` | blur the focused field; cancel skill targeting / deselect (table) |
| `G` / `F` / `C` | grid overlay / first person / camera mode (table, existing) |
| `T` / `Q` / `E` | tactical top-down view / turn it 45° left / right (table) |
| `Delete` | remove the selected token (GM, existing) |

The shell never binds a key the table uses. Phone and tablet get no shortcut layer; hardware
keyboards still reach the table's own keys.

## Checklist

- [x] `docs/UX.md` written
- [x] global CSS tokens (spacing, type, colour, radii), coarse-pointer 44 px rule, 16 px inputs, momentum scroll
- [x] `GameShell` picks the layout from `useBreakpoint`, single tree, canvas does not remount
- [x] Phone: top bar, table, tab bar from `PANELS`, GM filter, safe-area padding
- [x] Phone: bottom sheet half/full/closed, drag, swipe down to close, swipe between tabs
- [x] Phone: table interactive behind the half sheet
- [x] Phone: unread chat badge
- [x] Phone: dice overlay above the sheet
- [x] Phone: chat input above the iOS keyboard (`visualViewport`), home indicator respected
      (logic unit-tested; the desktop browser cannot emulate an on-screen keyboard, so this
      still needs a pass on a real iPhone/iPad)
- [x] Tablet: right drawer 360 px with tabs, pin / hide, persisted
- [x] Desktop: resizable columns, drag handle, double-click collapse, persisted
- [x] Desktop: collapsible sections, persisted
- [x] Top bar: name, status dot, role, invite (GM), leave, phone overflow menu
- [x] Selected-token chip and roll toast
- [x] Keyboard shortcuts on desktop
- [x] Panel layout tweaks (touch rows, scroll areas), no behaviour change (CSS only; no panel TSX edited)
- [x] `npm run typecheck`, `npx vitest run`, `npm run build` green
- [x] Colour roles, telegraphs, status icons, display face, text-size preset, daylight theme and pack theme hook (sections above)
- [x] Verified in the browser at 375 × 812, 768 × 1024 and 1400 × 900 with screenshots

Known follow-ups outside this shell's files: `BuildTag` (fixed bottom-right) overlaps the Chat
tab label on phones; it should sit above the tab bar or move into the overflow menu.

## Layout presets, Zen and Display

The top bar's ▣ menu holds Zen mode and a few layout presets (`src/ui/shell/layoutPresets.ts`),
chosen per device, never a free-form editor:

| Preset | For | What it does |
|---|---|---|
| Standard | everyone | Fits the screen size; your own widths and folds (picking it resets them) |
| GM desk | GM, co-GMs | Scenes, tokens, turns and sound open on the left; chat and sheet on the right |
| Player desk | players | Left column folded to its rail; sheet, skills and chat on the right |
| Compact | any | Phone arrangement (tab bar and sheets) at any width |
| Display | TV or shared screen | Table, turn order and roll toasts only; a corner button exits |

Zen (Z, or the menu) hides every bit of chrome over the table for the session; Z, Esc or the
corner "Show UI" button restores it. Both only change grid areas, so the canvas stays mounted.

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

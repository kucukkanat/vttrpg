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
| `--fs-xs` | 11 px | tags, tab labels |
| `--fs-sm` | 12 px | panel headers (uppercase), meta ("you", "hidden"), muted hints |
| `--fs-md` | 14 px | body, list rows, chat |
| `--fs-lg` | 16 px | inputs on touch (prevents iOS focus zoom), sheet titles |
| `--fs-xl` | 18 px | character name |

System font stack; line-height 1.35; `-webkit-text-size-adjust: 100%`.

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
- [x] Verified in the browser at 375 × 812, 768 × 1024 and 1400 × 900 with screenshots

Known follow-ups outside this shell's files: `BuildTag` (fixed bottom-right) overlaps the Chat
tab label on phones; it should sit above the tab bar or move into the overflow menu.

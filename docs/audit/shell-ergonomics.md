# Shell ergonomics audit

Scope: the game-screen shell (`src/ui/shell/*`, `src/ui/global.css`, `docs/UX.md`) as a GM on phone
(375×812, 320×568), landscape phone (812×375), tablet (768×1024, 767×1024 coarse, 1024×768) and
desktop (1400×900). Vite dev build in the built-in browser's device emulation; game = New game →
Mausritter: Tavern start. Screenshots S01–S18 are in `docs/audit/screenshots/shell/` (file names
start with the S number). Nothing in the repo was edited apart from this folder.

## Summary

- **A GM phone shows 11 tabs, not 8, in an `overflow: hidden` bar: at 375 px the Prep tab is 15 px
  wide and the Skill editor tab is off-screen and unreachable by touch. The tablet drawer strip
  (11 × 36 px in 360 px) loses the Editor tab the same way.** Keyboard focus still reaches the
  hidden tabs and scrolls the bar out of alignment for good (S11). This is the one blocker.
- The sheet mechanics are solid: tab tap → sheet in 16 ms, half sheet keeps the table live,
  header-only drag so content scrolling never dismisses, keyboard inset keeps the chat input
  visible, orbit drags hold 75 fps (worst frame 21 ms), muted text passes AA at 6.2:1.
- Polish debt clusters in three places: inline `minHeight`/width overrides that defeat the 44 px
  coarse rule (checkboxes are 13 px wide), horizontal overflow from long titles (Journal rows;
  the New-game pack badge renders at the page top), and raw error strings (a broken scene shows
  a 64-char hash and no action).

## Findings by area

### 1. Navigation model

| # | Where | Finding | Sev. | Evidence | Recommendation |
|---|---|---|---|---|---|
| N1 | Phone tab bar | `PANELS` gives a GM 11 tabs; `.tab{min-width:40px}`, bar `scrollWidth` 440 > 375, `overflow:hidden`. Prep (x 360) and Editor (x 400) cannot be tapped; at 320 only 9 fit. | **Blocker** | S02, S11 | Five slots: Scenes, Tokens, Sheet, Chat, More. "More" opens a sheet listing Edit, Players, Skills, Journal, Sound, Prep, Editor with badges. |
| N2 | Phone tab bar | Tab hit width 40 px (< 44), labels 11 px, "Journal" clips. The `@media (max-width:420px) .tab .lbl{10px}` rule is dead (later `.tab .lbl` rule wins). | Major | measured 40×56 | Follows from N1 (5 tabs → 75 px each). Delete the dead rule. |
| N3 | Tablet drawer tabs | `.drawer-tabs .tab{min-width:36px}` × 11 = 396 px in 359 px, `overflow:hidden` (second rule overrides `overflow:auto`). Editor hidden; Scenes/Players/Journal labels clip at 10 px. | **Major** | S13, S14; last tab right 804 > drawer right 767 | Same More model, or two rows, or `overflow-x:auto` + scroll-snap with an edge fade. |
| N4 | Phone, keyboard | Tabbing to the invisible tabs scrolls the hidden bar 65 px; nothing scrolls it back, so Scenes/Tokens are then half hidden for touch. | Major | S11 | Fixed by N1; otherwise reset `scrollLeft` on blur. |
| N5 | Phone half sheet | 55 % sheet leaves 320 px of table; the tavern's centre sits under the sheet, no camera reframe, so the live table is mostly floor grid. | Minor | S03 | Offset the camera target (or `setViewOffset`) by half the sheet height while open. |
| N6 | Phone sheet | Dismiss only via header drag (> ~156 px), the active tab or ✕; content scroll never closes it (good). Esc does not close; focus is not moved into the `role=dialog` on open. | Minor | `snapSheet` | Esc → close on phone/tablet; focus the sheet title on open. |
| N7 | Tablet drawer | Hidden state leaves only ☰ in the top bar; the doc's "slim edge tab" does not exist. Unpin floats correctly (canvas re-lays out in < 1 s). Pin/open/tab persist (`vtt.shell.tablet` verified). | Minor | S14 | Add the edge tab or fix the doc. |
| N8 | Desktop right column | For a GM the Skill editor section takes 495 px and Chat (`fill`) gets 180 px (~3 lines). Left column scrolls 2,960 px with 34 tokens; sections have no max height. | Major | S16 | Collapse Skill editor and Prep by default; `fill` min-height 40 %; list panels `max-height:40vh; overflow:auto`. |
| N9 | Desktop handle | 10 px wide, invisible until hover (`::after` transparent at rest); `role=separator` not focusable, so no keyboard resize; double-click collapse only hinted by `title`. | Minor | measured | Show a 2 px grip at rest; `tabindex=0` + arrow keys; a ◂/▸ button in the column header. |
| N10 | Top bar (phone) | Title ellipsis works. Status is an 8 px dot only; the word appears only inside ⋯ ("Connected · GM"); menu = status line, Copy invite link, Leave game (44 px rows). | Minor | S09 | Show the word when there is room, or toast on transitions. |
| N11 | HUD | Chip 44 px, ellipsis at 75 % width, good aria name; toast 44 px, 6 s, tap opens Chat. One tap/drag returns to a full table on every breakpoint. | OK | S04, S05 | — |

### 2. Touch ergonomics (phone 375, coarse pointer)

| # | Where | Finding | Sev. | Evidence | Recommendation |
|---|---|---|---|---|---|
| T1 | "Hidden" and Prep checkboxes | `.check input{width:auto}` overrides the 24 px coarse rule → **13×24 px**. | Major | measured | `.check input{width:24px}` on coarse. |
| T2 | "Edit mode: off" | Inline `minHeight:32` → 111×32 px. | Major | measured | Drop the inline override. |
| T3 | Sheet-header "+" (Tokens, Journal) | 34×44 px, drawn as a filled square unlike the adjacent ✕. | Minor | S03 | `min-width:var(--control)`; use `.icon` styling. |
| T4 | `.tiny` buttons | 36 px tall on coarse (Scenes "orbit", "+ dev-room"…, Skill editor "+ New"/"Duplicate to edit", Journal "‹ All notes"). | Minor | measured | 40–44 px on coarse. |
| T5 | Selects, "Add", "Use" in Edit/Tokens | 40 px. | Minor | measured | Raise to 44 on coarse. |
| T6 | Swatches | 40×40, 8 px gaps (doc says 36 visual / 44 hit). | Polish | measured | Pad to 44. |
| T7 | Chat input + keyboard | With `--kb:300px` the sheet goes full, input bottom at 496 px (< 512), tab bar hides. Works as designed; real iOS untested. | OK | S06 | Device pass still needed. |
| T8 | Page scroll | `scrollHeight == innerHeight` (812), `overscroll-behavior:none`; only panels scroll. | OK | measured | — |
| T9 | Text < 14 px | Tab labels 11, drawer labels 10, meta ("you", "hidden", "GM") 11–12, panel hints 12, Soundboard names 13, build tag 10. | Minor | contrast table | Keep 12 px for meta only; hints at 14 px. |
| T10 | Dice on phone | `.dice-layer` covers the viewport; dice settle over the chat log. | Minor | S05 | Confine the phone dice layer to the table area. |

### 3. Visual hierarchy and polish

| # | Where | Finding | Sev. | Evidence | Recommendation |
|---|---|---|---|---|---|
| V1 | New game page | Global `.badge{position:absolute; top:6px; left:calc(50%+6px)}` leaks into `.ng-card .badge`: all three "Mausritter" pills render stacked at (193, 6) at the page top. | Minor | S01 | Scope the pill to `.tab .badge, .drawer-toggle .badge`. |
| V2 | Build tag | Fixed, z-index 5: draws over sheet content on phone ("Vision" label, S04); floats 60 px up the table on tablet with no tab bar; 10 px at 3.56:1. | Minor | S04, S13 | Move into the ⋯ menu / desktop top bar. |
| V3 | Journal list | A long title makes the row 659 px wide in a 375 px panel; the sheet scrolls sideways, "everyone" is off-screen; on desktop clipped at the column edge with no ellipsis. | Major | S08, S16 | `.list li > span{min-width:0; overflow:hidden; text-overflow:ellipsis}` or wrap. |
| V4 | Journal note view | Two back controls ("‹ All notes" in the header, "‹" in the body). | Polish | S09 | Keep one. |
| V5 | Empty states | Character/Skills "Select a token."; Chat blank; Journal "No notes yet. Tap + to write one."; Players "…Share the invite link from the top bar." (on phone it is in ⋯); no-scene table has centred copy + 44 px "Open Scenes" (good). | Polish | S18 | Make copy actionable and breakpoint-aware ("Tap a token on the table"; "⋯ → Copy invite link"; "/r 2d6+1 rolls"). |
| V6 | Loading | New game shows spinner + progress; join shows elapsed-time copy; scene GLB streaming shows nothing (black, then pop). | Minor | observed | Thin progress strip "Loading The Thistle & Thimble…". |
| V7 | Chat | 14 px body, 4 px gaps, 12 px muted author, whisper purple with "GM → GM", rolls accent with italic formula/bold total, system italic muted. No timestamps/grouping. | Polish | S05 | Long-press timestamp; group by author. |
| V8 | Headers/spacing | 44 px uppercase 12 px section headers, correct ▾/▸ chevrons, 16 px sheet titles, spacing scale respected. | OK | S16 | — |

### 4. Error and edge states

| # | Where | Finding | Sev. | Evidence | Recommendation |
|---|---|---|---|---|---|
| E1 | Scene asset fails | A scene whose model 404s shows a red banner with the raw error ("assets: could not resolve 0000…0000 (missing.glb). Tried: http://… hash mismatch… Failed to fetch… HTTP 404"), an empty grid and no action; the Scenes list does not flag it. | **Major** | S10 | Human copy + Retry / Switch scene; warning glyph on the row; details to console. |
| E2 | Bad invite link | Clear message, Join disabled, Back available. | OK | S17 | — |
| E3 | Relay offline | Dot turns red; nothing else. No reconnect action, no word on whether local edits sync later. | Major | `useConnectionStatus`, `TopBar` | Banner under the top bar: "Offline — changes stay on this device until a relay answers" + Retry. |
| E4 | Long token name | Wraps to 3 lines (row 57 px); chip truncates. | OK | S07 | — |
| E5 | 34 tokens | 2.2 k px list in the sheet; no filter, no scroll-to-selected. | Minor | S07 | Filter above 15 rows; scroll selected into view. |
| E6 | 2,000-char note | Renders and scrolls (997 px). | OK | S09 | — |
| E7 | 812×375 | Tablet layout: 360 px drawer, 452 px table, 230 px chat log, 44 px controls. Fine apart from N3. | OK | S12 | — |

### 5. Accessibility

| # | Finding | Sev. | Recommendation |
|---|---|---|---|
| A1 | All 21 phone buttons have names; icon buttons are labelled (More, Expand/Shrink panel, Close panel, Back to notes, Remove *name*, Pin/Unpin, Hide drawer, Show left/right panels). | OK | — |
| A2 | Swatch `aria-label` is the hex code. | Minor | Colour names. |
| A3 | Phone focus order: More → chip → 11 tabs → sheet expand/close → panel; focus is not moved into the sheet on open, so a keyboard user tabs through the remaining tabs first. | Minor | Focus the sheet title on open; return to the tab on close. |
| A4 | Focus ring: 2 px accent outline verified on buttons/inputs. `.list li` rows (tokens, scenes, notes) are click-only `<li>`s — unreachable by keyboard. | Major | Render rows as buttons or `role=option tabindex=0` + Enter/Space. |
| A5 | Phone bar: `nav[aria-label=Panels]` + `aria-pressed` buttons (fine). Drawer: `role=tablist/tab` without `tabpanel` or arrow keys. | Minor | Use the same pressed-button model or complete the tabs pattern. |
| A6 | Colour-only: status dot (word only in the menu). Token dots sit next to names; roll outcome has words. | Minor | See N10. |
| A7 | Reduced motion covers sheet, toast, handle, claim sheet; not the "connecting" pulse, spinners or 3D dice. | Minor | `animation:none` for the pulse; a skip-dice setting. |
| A8 | Desktop shortcuts `[`, `]`, `/`, `1–9`, Esc verified; ignored while typing. Resize handle not keyboard-operable (N9). | OK | — |

### 6. Performance feel

Tab tap → first sheet frame 16 ms. Idle 75 fps (display-limited). Orbit drag on the tavern
(synthetic 125 Hz pointer moves for 2 s): 75 fps, worst frame 21 ms, no frame over 33 ms. Heap
after tavern + 34 tokens + dice: 65–71 MB used of 106 MB (`performance.memory`).

`vite build`: `index-*.js` **3,990 kB (1,338 kB gzip)** as a single chunk; css 18 kB; draco decoder
719 kB js + 192/286 kB wasm; basis transcoder 527 kB wasm; PWA precache 27 entries, 5.87 MiB.
Everything (three, rapier, yjs, nostr, every panel) ships before the home page renders; rapier,
draco and basis are table-only, Prep/Skill editor are GM-only.

### 7. PWA

`manifest.webmanifest`: name/short_name "VTTRPG", `display: standalone`, `orientation: any`,
theme/background `#0e0e10`, `start_url`/`scope` `/vttrpg/`, icons 192 + 512 (`any`) and the **same
512 file as `maskable`**. The d20 reaches ~218 px from centre against a 204 px safe radius, so
circular launchers clip the tips. Install shows "VTTRPG" with the dark d20 tile; standalone hides
browser chrome, so the shell's safe-area work matters.

Service worker: production only (`src/pwa.ts`, `registerType: 'autoUpdate'`, `immediate`),
`devOptions.enabled: false`, so none of this ran in the dev server. Workbox precaches the shell
and packs, excludes `library/scenes/**`, caches `/library/` cache-first for 30 days once used.
Offline: the shell and previously opened scenes open; relays are unreachable, so the dot goes red
with no explanation (E3). `autoUpdate` + `immediate` swaps the SW under a running session with no
"new version, reload" affordance.

## Measurements table

| Measurement | Value | Target | Result |
|---|---|---|---|
| Phone tabs | 40 px × 11 (440 in 375) | ≥ 44, all reachable | Fail |
| Drawer tabs | 36 px × 11 (396 in 359) | ≥ 44, all reachable | Fail |
| Top bar ⋯, sheet ✕/expand, chip, toast, chat input, token rows/🗑 | 44 | 44 | Pass |
| Hosted "+" (Tokens, Journal) | 34×44 | 44 | Fail (width) |
| Swatch | 40×40, 8 px gap | 44 | Marginal |
| Checkbox (Hidden, Prep) | 13×24 | 24×24 | Fail |
| "Edit mode: off" | 111×32 | 44 | Fail |
| `.tiny` buttons | ×36 | 44 | Fail |
| Selects / Add / Use | ×40 | 44 | Marginal |
| Muted `#9a9892` on panel `#17171b` | 6.20:1 | 4.5 | Pass (AAA fail) |
| Muted on bg `#0e0e10` | 6.69:1 | 4.5 | Pass |
| Accent on panel | 8.19:1 | 4.5 | Pass |
| Whisper `#c58af9` on panel | 7.13:1 | 4.5 | Pass |
| Build tag `#6b6a66` on bg | 3.56:1 | 4.5 | Fail |
| Tab → sheet | 16 ms | < 100 ms | Pass |
| Orbit drag | 75 fps, worst 21 ms | 60 fps | Pass |
| Heap after tavern | 65–71 MB | — | Fine |
| Main bundle | 3.99 MB / 1.34 MB gzip | < 500 kB initial | Fail |
| Precache | 5.87 MiB | — | Heavy first install |

## Top 5 improvements

1. **Five-slot phone bar + More sheet; scrollable or two-row drawer strip** (`TabBar.tsx`,
   `Drawer.tsx`, `.tabbar`/`.drawer-tabs`). Fixes N1–N4 in one change.
2. **Human error states for assets and relays**: title + one-line cause + Retry / Switch scene;
   flag the scene row; offline banner with Retry (E1, E3, N10).
3. **Desktop column budgeting**: collapse Skill editor and Prep by default, real minimum for `fill`
   sections, 40 vh cap on list panels (N8); visible, focusable resize handle (N9).
4. **Hit-size hygiene on coarse pointers**: remove inline `minHeight` overrides, fix
   `.check input{width:auto}`, `min-width:var(--control)` on hosted `<h3>` buttons, `.tiny` and
   selects to 44, pad swatches (T1–T6).
5. **Overflow and leakage**: ellipsis on `.list` rows (V3), scope `.badge` (V1), build tag into the
   ⋯ menu (V2), phone dice layer limited to the table (T10), keyboard-reachable rows (A4).

## Open questions

- Which panels does a GM need on a phone at all? Prep and Skill editor are authoring tools and
  could be hidden below 700 px instead of squeezed in.
- Should Scenes and Edit be `scope: 'all'`? Players see both; Edit mode touches room geometry.
- Should the half sheet reframe the camera (N5), or does the chip/toast carry enough state?
- When the status goes offline, are local intents queued and replayed? The UI must say either way.
- Is the identical `any`/`maskable` icon intentional, or should a padded variant be generated?
- The keyboard path was exercised only by setting `--kb`; a pass on a real iPhone and on Android
  Chrome with `interactive-widget=resizes-content` is still needed, as the UX doc notes.
- Should 3D dice be skippable (reduced motion, slow devices) with the toast as fallback?

Method note: the browser's 768 px tablet preset emulates a fine pointer, so coarse tablet
measurements were taken at 767×1024; 1024×768 is a fine-pointer run.

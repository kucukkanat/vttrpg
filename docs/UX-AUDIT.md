# UX audit and improvement plan

Date: 2026-11-06 · Build audited: `ce7eeda` · Method: four independent walkthroughs of the real app
in a browser at phone (320/375), tablet (768) and desktop (1400) widths, as GM and as a player on a
second identity, plus code reading for affordances that could not be reached. Detailed reports with
screenshots live in `docs/audit/`:

- `gm-journey.md` — landing → new game → first ten minutes → leave and return
- `player-journey.md` — invite → claim → play → waiting states → return
- `play-features.md` — combat, dice, scenes and maps, editing, prep, sound, shortcuts, gap list
- `shell-ergonomics.md` — navigation, touch sizes, contrast, errors, accessibility, performance, PWA

## Verdict in three lines

1. The happy path is fast and mostly works: two taps to a lit table, join in under two seconds,
   state round-trips in well under a second, reload and rejoin restore everything.
2. Two defects break the core loop for everyone: **sheet roll buttons fail** (the controller never
   passes the character into the roll) and **a GM phone or tablet cannot reach the Prep and Skill
   editor tabs** (the tab strip is `overflow: hidden`). A mouse click casts a spell with no confirm,
   and nothing destructive can be undone.
3. The app rarely tells people what just happened: no "you are Pip", no "GM removed your token",
   no HP or conditions on the table, pubkey prefixes instead of names, raw hashes in error banners.

## Severity counts

| Severity | Count | Examples |
|---|---|---|
| Blocker | 3 | Sheet rolls fail; GM tabs unreachable on phone and tablet; blank stat inputs |
| Major | 24 | No undo; mouse casts on first click; invite copy fails silently; image floor not rendering; no fog controls; no combat state on tokens; silent player events |
| Minor | 31 | Scene add auto-switches; stale selection across scenes; hit sizes under 44px; whisper target sticks |
| Polish | 22 | Labels, empty-state copy, duplicate controls, dead CSS |

## Plan

Each item names the fix, the evidence, the area and a size (S under 2h, M half a day, L a day or
more). Waves are ordered so that each one is shippable on its own.

### Wave A — stop the bleeding (all S or M, one day)

| # | Fix | Evidence | Area | Size |
|---|---|---|---|---|
| A1 | Pass the character into roll resolution (`resolveContext` in `controller.ts` ignores `intent.character`), label the result with the character name, and unit-test every `kind: 'roll'` field in both packs' `sheet.json`. Widen stat inputs (`min-width: 3.5ch`). | player 3e, play 2b | controller, rules, SheetView | S |
| A2 | Five-slot phone tab bar (Scenes, Tokens, Sheet, Chat, More) with a More sheet for the rest; tablet drawer strip `overflow-x: auto` with scroll-snap and edge fade; delete the dead `max-width: 420px` label rule; reset `scrollLeft` on blur. | gm 3e, shell N1–N4 | shell | M |
| A3 | Stage-then-confirm for mouse targeting (same as touch): "Fireball → Bramble, Nettle · Cast / Cancel"; warn when a target is a player character; skip `vs` saves when a shape has no targets. | gm 4k, player 3i, play 1b | table, rules | M |
| A4 | Undo toast (5 s, "Removed Rat Guard · Undo") for token and prop removal, scene removal and fog reset; drop Backspace as a delete key; keep Delete. Last-20 intent undo on the GM client (`Cmd+Z`) as the general mechanism. | gm 4g, play 4d | state, panels | M |
| A5 | Invite flow: popover with the link in a read-only field, Copy, and "Players open this in any browser, no account needed"; never fall back to `prompt()`; Players empty state becomes a Copy button; join page shows the game name and system decoded from the naddr. | gm 3c, 3d, player 1a | TopBar, Players, JoinGame | S |
| A6 | New game: scope the chat `.badge` rule so pack badges stop stacking at the top of the page; move the build tag into the ⋯ menu and the desktop top bar. | gm 2a, shell V1, V2 | NewGame, shell | S |
| A7 | Image-floor scenes: reproduce and fix the grey plane for a freshly imported PNG (object-URL texture path); show "Loading map…" and a failure state. | play 3b | table | S–M |
| A8 | Names everywhere: resolve self and `meta.gm` to display names in chat; keep last-seen names in the doc; `/w` matches a name prefix, accepts `gm`, reports "no one called X"; `/help`. | player 3f, 3h | chat, controller | S |

### Wave B — tell people what is happening (two days)

| # | Fix | Evidence | Area | Size |
|---|---|---|---|---|
| B1 | System channel + toasts for player events: "You are Pip", "GM removed Pip", "GM gave you Token 5", "New handout · Open", "GM is away"; render `system` messages distinctly; frame the camera on the claimed token. | player 2c, 3j, 4b–4d | shell HUD, controller | M |
| B2 | Combat state on the table: HP pip bar and condition glyphs on the token footprint (GM toggle for players), floating damage and heal numbers reusing the VFX event, skill outcome toast on phone and tablet where the sheet closes to aim. | play 1d, 1a | table, vfx | L |
| B3 | GM-away and offline handling: amber "Connected · GM away" after 15 s; hold a player's drag ghost with "Waiting for the GM…" and either queue intents or reject them with a message; offline banner under the top bar with Retry and "changes stay on this device". | player 4b, shell E3 | net, shell, table | M |
| B4 | Fog controls in Scenes: Reveal all, Hide all, Reset; status line "fog on · 42 cells explored"; decouple fog from `darkness == 0`. | play 3e, 3c | Scenes, table | S |
| B5 | Scene management: "+ scene" adds without switching, per-row Live / Switch, title-case names, clear selection on `scene.activate`, camera-mode icon with tooltip instead of "orbit", warning glyph on rows whose asset failed, human error copy with Retry and Switch scene. | gm 4h, play 3a, shell E1 | Scenes, table | M |
| B6 | "My token" affordances: permanent owner marker on the disc, "Find me" on the HUD chip, Character and Skills default to the first owned token when nothing is selected, don't deselect on sheet close. | player 3a, phone | table, shell | S |
| B7 | Camera modes on screen: HUD pill "Orbit · Follow · Eyes" with key hints on desktop and buttons on touch; grid toggle button. | player 3m, play 3d | shell, table | S |

### Wave C — ergonomics and polish (two days)

| # | Fix | Evidence | Area | Size |
|---|---|---|---|---|
| C1 | Desktop column budgeting: collapse Skill editor, Prep and Journal by default; Chat gets a real minimum (40 % of the column); list panels capped at 40 vh with inner scroll; visible, keyboard-operable resize handle with a collapse button. | gm 3a, shell N8, N9 | shell | M |
| C2 | Hit-size hygiene on coarse pointers: checkboxes 24 px, remove the inline `minHeight: 32` on "Edit mode", `.tiny` and selects to 44, hosted header buttons `min-width: var(--control)`, swatches padded to 44. | shell T1–T6 | global.css, panels | S |
| C3 | Overflow: ellipsis on `.list` rows (Journal titles), token list filter above 15 rows and scroll-to-selected, dice layer confined to the table on phone, dice fade with the toast and smaller on phone, mark dropped dice in `kh/kl` results. | shell V3, E5, T10; gm 4j | panels, dice | S |
| C4 | Props and minis: ship 8–10 small CC0 props and 3 minis in the library; hide `scenes/` from token and prop pickers; auto-scale an unknown GLB to one cell; remove the duplicate size/model controls between Tokens and Edit; on-table "Edit" toggle. | gm 4n, play 4b, 5 | library, panels, table | M |
| C5 | Onboarding: first-visit GM callout ("You're the GM: copy the invite link, players pick a token"); templates no longer assign the GM a player character; "Your name" hint; breakpoint-aware empty-state copy; hide dev links outside dev builds. | gm 1a, 2b, 3a, shell V5 | Home, NewGame, panels | S |
| C6 | Accessibility: list rows as buttons (keyboard reachable), focus moves into the sheet on open and back on close, Esc closes sheets, colour-name swatch labels, reduced-motion for the connecting pulse and an option to skip 3D dice, status word next to the dot when there is room. | shell A2–A7, N6, N10 | shell, panels | M |
| C7 | Journal and editor verbs: Create / Save / Post to chat (one verb set), chat line when a note is created already shared, unread badge on the Journal tab, single back control, "Override pack skill" option in the Skill editor with a post-save hint. | gm 4m, 4o; play 6c; player 3j | Journal, Skill editor | S |

### Wave D — conveniences GMs expect (ranked by value over effort)

| # | Feature | Value | Effort | Note |
|---|---|---|---|---|
| D1 | Initiative tracker | High | M | Order list with Next; reads a sheet field or a roll; visible to players |
| D2 | Measure distance (drag ruler) | Medium | S | Grid maths already in `targeting.ts` |
| D3 | Ping / pointer for players | Medium | S | Ephemeral presence event plus a ring effect on the `vfxBus` |
| D4 | Right-click and long-press context menu on tokens (attack, sheet, hide, remove, assign) | Medium | S | Right-click only selects today |
| D5 | Quick dice buttons above chat (d20, 2d6, d66, repeat last) | Medium | S | Chat already parses `/r` |
| D6 | Multi-select and group move | Medium | M | Store selection is single-id |
| D7 | Scene transition for players and "preview without switching" | Medium | S | Activate is instant and global |
| D8 | Keyboard shortcut overlay (`?`) | Low | S | List exists in `docs/UX.md` |
| D9 | Chat timestamps and author grouping | Low | S | — |

### Wave E — platform

| # | Fix | Evidence | Size |
|---|---|---|---|
| E1 | Code-split the 4 MB main bundle: lazy-load the table (three, rapier, draco, basis) behind the game route and the GM-only panels (Prep, Skill editor) on first open; target under 500 kB for the home and join pages. | shell §6 | M |
| E2 | Padded maskable icon; "new version available, reload" prompt instead of a silent service-worker swap mid-session. | shell §7 | S |
| E3 | Relay health: show how many relays are open before sharing the invite; keep the status honest when only two of five accept. | gm open q. | S |
| E4 | Device pass on a real iPhone and iPad: on-screen keyboard with the chat sheet, pinch and two-finger pan, long-press on tokens and props, WebGL context loss when switching apps. | all four | M |

## Decisions needed from the product owner

1. Which panels does a GM need on a phone? Proposal: Prep and Skill editor live in the More sheet
   on phones rather than being hidden below 700 px.
2. Should "+ scene" from the library stage first (B5) or keep switching immediately?
3. Should the GM own a template player character by default? Proposal: no (C5).
4. Should player intents be queued while the GM is away, or rejected with a message (B3)?
   Proposal: queue moves and chat for up to five minutes, reject rolls and skills.
5. Do starter scenes get an obvious enemy with a sheet (Tavern start has no rat) so the first cast
   has a safe target? Proposal: yes.

## Suggested execution

Wave A as one worker set today (A1, A6, A8 together; A2; A3; A4; A5; A7), each in its own worktree
with the watchdog running. Waves B and C can run in parallel after A since they touch different
files (B: table, net, controller; C: shell, panels, library). Wave D and E follow as capacity allows.

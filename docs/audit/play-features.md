# Play-feature audit (GM, mid-session)

Scope: the depth features a GM touches during play, exercised in the built-in browser against
`npx vite --port 5303`, "New game → Mausritter: Dungeon delve", as the GM. Desktop at 1400 × 900,
the three key flows re-checked at 375 × 812. Code read for affordances that could not be reached
(touch confirm, fog, shortcuts). Screenshots: `docs/audit/screenshots/play-*.jpg`.

Severity: **blocker** = a GM cannot complete a core play action · **major** = completes but with
confusion or lost information · **minor** = friction · **polish** = cosmetic.

## Summary

- The combat loop (select → skill → aim → pick → chat) works and the 3D aiming feedback is good,
  but the sheet's own roll buttons are broken (`STR save` → "roll failed: unknown identifier
  "str""), so the one-tap roll a GM reaches for most often fails. Fix: pass the character scope
  into `rules.roll` for `roll` intents (`resolveContext` in `src/ui/controller.ts` ignores `intent.character`).
- State changes never reach the table: no HP bar, no condition badge, no damage float, no
  initiative. Everything lives in three system chat lines, which on a phone are hidden behind a
  badge the moment the skill fires. A GM running a fight on an iPad is blind.
- Scene/map tooling is deep (library scenes, map images with a grid-preview form, UVTT/Foundry
  import, weather, darkness, props, per-node overrides, gizmo) but has no undo, no fog reset or
  "reveal all", and the model picker only offers whole rooms, so "change a token's model" drops a
  tavern on the dungeon.

## Feature table

| # | Feature | Goal / steps taken | Severity | Findings and recommendation |
|---|---|---|---|---|
| 1a | Attack | Select token (1) → Skills "Attack" (2) → hover rat → click (3). Chat: "N attacks Sewer Rat with Hatchet." / "rolls damage: 1 [1]." / "Sewer Rat takes 1 damage (Hit Protection 0 to 0), Hit Protection depleted." | major | Targeting is good: bar "pick a target within 1 cells", out-of-range tokens dim, in-range target gets an orange ring on hover, Esc / right-click / Cancel all work. But the rats ship without sheets, so the sample fight reports "0 to 0 … depleted" every time; give starter NPCs a sheet or print "no Hit Protection tracked" (the engine already has that branch). Hit VFX (white spark burst, 250 ms) is small and easy to miss on a dark scene; no damage number on the table. No 3D dice for skill rolls (only `/r`), so "did it hit" is text only. |
| 1b | Fireball at a point | "Fireball" (1) → move → click floor (2). Burst disc + range circle preview, projectile + ring + shake VFX. | major | Preview is clear (orange 2-cell disc, white dot, 6-cell range ring). With nobody in the area the engine makes the *caster* roll the DEX save (`engine.ts` `for (const t of tgts.length ? tgts : [src])`), so chat says "Nettle DEX save: 16 vs 4 - failure" for an empty fireball. Skip `vs` rolls when there are no targets. The bar says "aim a 2-cell burst within 6 cells" but never "0 targets" on mouse (only the touch candidate shows a count). |
| 1c | Heal ally | "Heal" (1) → click Bramble (2). "recovers 0 Hit Protection (4 to 4)", 1 WIL spent. | minor | Works; green aura VFX reads well. Spending a resource for a zero heal with no warning is a rules nit; a "already at full" line would help. The Skills panel outcome box (last 3 system lines, 8 s) is the best feedback in the app, but it disappears on a phone because the sheet closes to aim. |
| 1d | HP / conditions visibility | Where did HP change? | major | Only in chat and in the Character panel's Vitals field (below the fold; needed scrolling). Tokens show nothing: `TokenMesh` renders disc, rings, light and elevation only; `token.conditions` exists in the doc but is never rendered or set by the sheet ("Active conditions · Add" is a sheet-only list). Add an HP pip bar and condition glyphs on the token footprint, GM-only by default. |
| 1e | Cancel / confirm on touch | Esc, Cancel button, tap on caster, right-click. Touch path read in `TargetingLayer`/`TargetingBar`. | polish | Mouse: a click fires immediately (no confirm). Touch: lift stages a candidate, bar shows "N targets" + orange Confirm; a tap on the caster cancels. Good design; could not exercise with real touch. The bar sits above the phone tab bar correctly. |
| 2a | `/r 2d6+1`, `/r 4d6kh3` | Type in chat (1), Enter. | minor | Two large physics dice land over the table; toast "GM 2d6+1 10 [3, 6]" top-centre for 6 s; dice cleared ~4 s after settling. Legible on both desktop and phone. `4d6kh3` shows `[6, 1, 3, 3]` with no mark on the dropped die. Rolls are attributed to the connection ("GM"), never to the selected character, so a GM rolling for an NPC cannot say who rolled. On the phone the dice overlap the token chip and toast (play-10). |
| 2b | Sheet roll button | Character → "STR save". | **blocker** | Chat: "GM → GM roll failed: unknown identifier "str"". `sheet.json` formulas use `d20 <= str`; the `roll` intent carries `character` but `controller.ts resolveContext` calls `rules.roll(formula, seed)` with no context. Every save button on every sheet fails. |
| 3a | Library scene / switch | "+ tavern" (1) adds and activates; click row (1) switches. | minor | Fast, ~3 s load. Switching is global and instant for players with no transition or "players see…" hint. Selection persists across scenes: after switching, the Tokens panel shows an empty list with Nettle's properties still open and Character/Skills still showing her. Clear selection on `scene.activate`. The scene row's `orbit`/`token` tiny button is a per-scene global camera mode; nothing says that it changes what players see. |
| 3b | "+ Map image" | File → form with thumbnail, yellow grid overlay, "1024 × 768 px · 64 px per cell · 16 × 12 cells", Name, Columns (1) → "Add scene" (2). | major | The form is excellent (suggested 15 columns, visibly wrong on the thumbnail, corrected to 16 in one edit; the table grid then lined up). But the resulting table showed a flat grey plane with no image at any darkness (play-08); no console error. With a token added the fog reveal shape appeared, so the scene itself is fine. Needs a check of `ImageFloor` with a locally imported PNG (object-URL `TextureLoader` path) before this ships; a visible "image failed / loading" overlay like the GLB "Loading scene…" one would at least tell the GM. |
| 3c | Weather / ambience / darkness | Selects + range slider in Scenes (and Sound). | polish | Rain appears within a second (faint streaks, fine). Darkness slider has no value label and no "players see this" hint; at darkness 0 fog is switched off entirely (`visible: darkness > 0 ? … : null`), which is undocumented and surprising: the slider silently doubles as a fog toggle. |
| 3d | Camera modes | Row button orbit→token; `F` first person; `C` local toggle; `G` grid. | minor | Token mode on a disc token frames the disc so close it fills the screen (play-13 for first person, which works well in the corridor). No on-screen control for `F`/`C`/`G`; the only hint is `docs/UX.md`. A camera menu on the table (orbit / shoulder / first person / grid) would make the modes discoverable on touch too. |
| 3e | Fog (GM) | Added map, token; read `FogOverlay`. | major | GM sees fog revealed through every token's vision; a new map with no token is 100 % fogged and looks "broken". There is a `fog.reset` intent but no UI for it and no "reveal all / hide all / disable fog" control, no brush. For a GM that is the single most-used fog action in Foundry/Owlbear. |
| 4a | Edit tab, token | Select token → Edit panel "Edit mode: off" (scroll needed) → on (1) → gizmo; `R`/`S`/`G` switch; steppers ± (one tap each). | minor | Gizmo is screen-fixed ~110 px, 8 px lines; arrows, rotate arc and scale handle are finger-sized and draw over tokens. Steppers (Size 0.25, Rotation 15°, Elevation 0.25 m) update live; elevation adds a plumb line and shadow disc (good). Edit mode sits in a collapsible section below Tokens on desktop and is tab 3 on phone; nothing on the table hints that edit mode exists. Snap is "on" by default with no visual snap feedback while dragging (values just jump). |
| 4b | Add a prop | "Pick a model…" → dungeon → Add (2). | major | The library has only four *scene* GLBs, so the only props available are whole rooms; adding "dungeon" overlays a second dungeon on the scene (lit differently, so the room suddenly brightens). Props land "where the camera looks", snapped. Moving with the gizmo and the X/Z/Scale steppers works. Ship a handful of real props (door, chest, pillar, crate) or hide scene models from the prop picker. |
| 4c | Scene part (node) | Edit mode → click room → "Scene part floor_strip" → Hidden (1) → Reset (1). | minor | Clicking picks the nearest named node; the panel shows the raw Blender name ("floor_strip") and the gizmo jumps to its origin, but the selected part is not outlined or tinted on the table, so you cannot tell what you picked without toggling Hidden. Reset button is disabled until something changed (good). |
| 4d | Undo | Searched code. | major | None. Every edit (move, hide, scale, remove prop, remove token, delete note) is immediate and permanent; "Remove token" and "Remove prop" have no confirm (notes do). A GM mis-drag of a scene node has no way back except "Reset to the model". An undo stack over intents (even last-10) is the biggest safety net missing. |
| 5 | Token model | Tokens panel → Model select → tavern → Use; also in Edit. "Use disc" restores. | major | Both pickers work and the fallback disc is clean (initials, colour, 0.22-cell-high puck). But with only scene GLBs on offer the result is a tavern the size of the dungeon standing on the token (play-06); no warning, no auto-scale to a cell. Either scale GLB minis to fit one cell by default or filter out `scenes/` from the token picker until minis exist. |
| 6a | Prep: 3 NPCs, reveal | Count=3 (1) → "Generate 3 NPCs (hidden)" (1) → "Reveal all" (1). | polish | Three taps, with stat blocks, inventory, "Select" per NPC. Hidden NPCs appear dimmed only to the GM. Excellent. Only nit: the Prep section is 6th in the left column, below Sound and Players. |
| 6b | Journal handout | + (1) → title (2) → body (3) → Share with: Everyone (4) → Create (5) → Announce (6). | minor | Markdown renders well. Six taps is acceptable; "Share with" defaults to private, so a GM who forgets step 4 posts "GM shared a handout" after a second tap on "Share to everyone" (that button does both). Fine. Image handouts work via upload. |
| 6c | Skill editor: tweak a spell's damage | Fireball "Duplicate to edit" (1) → scroll to effect 3 → Formula (2) → Save (3). | minor | Form is thorough (cost, target, effects as cards with hints, VFX timeline, Test dry-run). The damage formula is a raw expression (`save.success ? floor(rolls.power.total / 2) : rolls.power.total`), fine for prep, scary mid-session. Duplicating creates `fireball-copy` *alongside* the pack Fireball, so players now see two Fireballs; only renaming to the original id overrides it (the delete text hints at this). Offer "Override pack skill" explicitly. |
| 7 | Sound | Soundboard grid (6 built-ins + Audio file), Volume 80 %, Ambience select. | polish | Clear grid of 64 px pads with emoji icons; volume is a local master; ambience duplicates the Scenes select (consistent). The "Tap to enable sound" affordance did not appear in this session (context already unlocked); code shows a fixed pill above the tab bar plus a tiny header button; a pad press calls `unlock()` itself, so the pill is mostly redundant. No per-pad volume, no stop button for a long ambience, no "playing" indicator. |
| 8 | Keyboard shortcuts | Code search, see list below. | minor | Nothing in the UI lists them; the only hints are "Move (G) / Rotate (R) / Scale (S)" in the Edit panel and "Tip: Delete key removes the selected token". A `?` overlay or a tooltip row in the top bar would fix it. |

### Shortcut inventory (desktop; all ignored while typing)

- Shell (`src/ui/shell/useShortcuts.ts`): `[` / `]` toggle left/right column, `/` focus chat, `1`–`9` toggle the n-th panel section, `Esc` blur field.
- Table (`src/table/TableCanvas.tsx`): `G` grid (or translate gizmo in edit mode), `R` rotate, `S` scale, `F` first person, `C` orbit/token local override, `Delete`/`Backspace` remove selected prop (GM), `Esc` cancel targeting then deselect. Right-click selects a token; right-click during targeting cancels.
- Tokens panel (`TokensPanel.tsx`): `Delete`/`Backspace` removes the selected token (GM) with no confirm; this listener is active whenever the panel is mounted, so on desktop a stray Backspace while the focus is on the canvas deletes the token.
- Gizmo (`EditGizmo.tsx`): hold `Alt` to skip snapping.

## Missing conveniences (value / effort; H = high, M = medium, L = low)

| Convenience | Value | Effort | Note |
|---|---|---|---|
| HP bar + condition icons on tokens | H | M | Data already exists (`hp` resource, `token.conditions`); render on the footprint, GM-only toggle. |
| Undo (intent history, last N) | H | M | Yjs doc; keep the inverse patch per intent on the GM client. |
| Fog controls: reveal all / reset / brush | H | L–M | `fog.reset` intent exists; "reveal all" is a `fog.reveal` of every cell. |
| Sheet roll fix + roll attribution to a character | H | L | One-line controller change; show character name in toast/chat. |
| Floating damage/heal numbers on the table | H | L | Reuse the VFX event; text sprite over target. |
| Initiative tracker | H | M | Order list with "next", reads from a sheet field or a roll. |
| Measure distance (drag ruler) | M | L | Grid math exists in `targeting.ts`; show cells on a drag from empty floor. |
| Ping / pointer for players | M | L | Ephemeral presence event + ring VFX; `vfxBus` already in place. |
| Right-click context menu on token (attack, sheet, hide, remove) | M | L | Right-click currently only selects. |
| Quick dice buttons (d20, 2d6, d66, last roll) above chat | M | L | Chat already parses `/r`. |
| Drag-to-select multiple tokens, group move | M | M | Selection is single-id in the store. |
| Scene transition / "players follow" toggle | M | L | Activate is instant and global; a fade and a "preview without switching players" flag. |
| Confirm on destructive actions (remove token/prop) | M | L | Notes already do it. |
| Keyboard shortcut overlay (`?`) | L | L | List exists in `docs/UX.md`. |
| Token status "hidden" eye icon on the table for GM | L | L | Hidden tokens are only dimmed. |

## Top 5 improvements

1. **Fix sheet rolls and attribute rolls to characters** (`controller.ts resolveContext`: pass the character's data as the roll context; include `character` name in the toast and chat). Blocker today.
2. **Put combat state on the table**: HP pip bar, condition glyphs, floating damage numbers, and a one-line toast for skill outcomes on phone/tablet so the result is never only in a closed chat.
3. **Fog GM controls**: Reveal all / Hide all / Reset in the Scenes panel, and a status line ("fog on · 42 cells explored"); decouple fog from `darkness == 0`.
4. **Undo + confirmations**: a last-20 intent undo on the GM client (`Cmd+Z`), confirm dialogs on token/prop removal, and clear selection on scene switch.
5. **Make the model/prop pickers sane**: ship 5–10 small CC0 props and 2–3 minis, hide `scenes/` from token and prop pickers, auto-scale an unknown GLB to one cell, and add an on-table "Edit" toggle so edit mode is discoverable without scrolling the panel.

## Open questions

- Is the map-image floor expected to render for a file imported in the same session (object URL via `assets.resolve`)? The thumbnail rendered, the table stayed grey with no console warning; needs a repro with a real PNG from disk.
- Should a `vs` roll with no targets be skipped, or is "caster rolls the save" intentional for self-targeting packs?
- Should the camera mode on a scene row stay a global, player-visible setting, or become a local view with a separate "lock players to token view" flag?
- Starter rats: give them sheets (HP, armor) so the sample delve demonstrates damage, or keep them sheetless and change the chat line to "(no Hit Protection tracked)"?
- Duplicate-to-edit vs override: is the intended path for tweaking a pack spell mid-session to overwrite the pack id, and should the UI say so?
- Eleven GM tabs at phone width overflow the tab bar (Prep/Editor cut off, `BuildTag` overlaps "Scenes"); is a "More…" tab acceptable, or should Prep/Editor be desktop-only?

# GM journey audit

Walked as a brand-new Game Master in the built-in browser against a local dev build (`ce7eeda`)
at 1400 × 900 (desktop), 375 × 812 (phone) and 768 × 1024 (tablet). Screenshots: `docs/audit/screenshots/gm/`,
referenced by number. Severity: blocker / major / minor / polish. "Taps" = clicks from the previous state.

## Summary

- **The happy path is fast and honest.** Landing → table is 2 taps and ~5 s; every GM action tried (token CRUD, sheet, scenes, weather, dice, spells, NPCs, handouts, props, skill editor) worked first time, and Leave → Rejoin and reload on `#/game` restored every change in ~1 s.
- **The shell breaks where the GM has the most panels.** Phone and tablet give the GM 11 tabs but the strips are `overflow: hidden`, so **Prep and Editor are unreachable on phone, Editor on tablet** (screens 13, 17). On desktop a full character sheet sits above Chat, leaving a 3-line log.
- **Destructive actions are one tap with no undo.** Removing a token or prop, casting Fireball with the mouse, Backspace on the table, "+ dungeon" switching the live scene: none confirm, none reverse.

## Journey table

| # | Step | Expected | Observed | Severity | Recommendation |
|---|---|---|---|---|---|
| 1a | Landing (screen 01, phone 16) | Learn what it is, see one first action | Title, one-line pitch, `New game` (primary) / `Join with a link`, then "Dev stories: table · dice · net". 1 tap to start. Dev links on a production-looking page; "Join with a link" opens a native `prompt()`. | minor | Hide dev stories unless `import.meta.env.DEV`; replace `prompt()` with an inline input. Add one line of value: "Players join from a link, nothing to install." |
| 1b | Build tag | Unobtrusive | `ce7eeda` bottom-left in 10 px grey on every page; on phone it sits on the table above the tab bar (screen 13). | polish | Move into the ⋯ menu / home page only. |
| 2a | Template cards (screen 02) | Pick a start, name things, go | Three Mausritter templates + Empty table with two-line descriptions. Good. **Bug:** the "Mausritter" pack badge is `position: absolute` (global `.badge` rule leaks into `.ng-card .badge`), so all three badges stack at the top-centre of the page (screens 02, 16). | major (visual bug) | Scope the chat-unread `.badge` rule or rename the card class. |
| 2b | "Your name" | Know what it is for | Default "GM"; no hint that players see it in chat/Players, so every GM is called "GM". | minor | Help text: "Shown to players in chat and the Players list." |
| 2c | System select | — | Only for Empty table; templates fix the pack, invisibly. | polish | Pack name on the card (covered once 2a is fixed). |
| 2d | Time to first table | < 10 s | `Create and open table` → `#/game` < 2 s, "Loading scene…", scene visible ~5 s. 2 taps from landing. | ok | — |
| 3a | First look (screen 03) | Know what I'm looking at | Desktop: left Scenes / Tokens / Edit / Sound / Players / Prep, right Character / Skills / Chat / Journal / Skill editor, all open. Sound, Players, Prep below the fold at 900 px; Journal/Skill editor push Chat to ~3 lines. No orientation hint. The template made me own a PC ("Old Barley · you") without asking. | major | Dismissable first-visit callout: "You're the GM. Copy the invite link → players open it → assign tokens in Players." Collapse Sound / Prep / Journal / Skill editor by default; let Chat take the space. Don't auto-assign the GM a PC. |
| 3b | Top bar | Name, status, role, invite, leave | "Audit table · ● Connected · GM · Copy invite link · Leave". Clear. Stayed "Connected" (2 of 5 relays accepted; never "offline"). | ok | — |
| 3c | Copy invite link | Know what was copied, what players see | "Copied" for 1.5 s on success. Here the clipboard call failed, the `window.prompt` fallback threw ("prompt() is not supported") and **nothing visible happened**. The link is never shown; no hint that players need no account. 1 tap. | major | Popover with the link in a read-only input, Copy button, and "Players open this in any browser, no account needed", open until dismissed. Never rely on `prompt()`. |
| 3d | Players panel alone | Know what to do | "Tolga · you · GM · Old Barley" + "Nobody else is here yet. Share the invite link from the top bar." Good, but on phone the invite lives in ⋯. | polish | Make the hint a "Copy invite link" button. |
| 3e | Finding panels | Each panel findable | Desktop: fine. Phone: 11 tabs, `scrollWidth` 440 px in 375 px, `overflow: hidden` → **Prep and Editor unreachable** (screen 13); "Scen…"/"Jour…" truncate. Tablet: strip 396 px in 359 px → **Editor unreachable** (screen 17). Tab buttons have no `aria-label`. | blocker (phone/tablet) | `.tabbar` / `.drawer-tabs` → `overflow-x: auto`, or 5 tabs + "More" sheet holding the GM-only panels. Add `aria-label` from `PanelDef.title`. |
| 4a | Add token | Token appears, inspector opens | "+" → "Token 5" at scene origin (under a table), selected, inline inspector (Name, 7 swatches, Vision, Light, Size, Hidden, Owner, Model, Remove). 1 tap. On phone the inspector is below the half-sheet fold (screen 14). | minor | Place new tokens where the camera looks (as props do); on phone scroll the sheet to the inspector. |
| 4b | Rename + colour | Instant | Name and red swatch update list and disc live. 2 taps. | ok | — |
| 4c | Generate sheet | Sheet appears | "Generate character" → full Mausritter sheet; Skills populate. 1 tap. | ok | Call it "Roll a character" to match Prep. |
| 4d | Move on table | Drag works | Drag moved the token; hidden tokens render dimmed for the GM. | ok | Highlight the target cell on touch. |
| 4e | Hide / reveal | Players can't see it | "Hidden" checkbox; list tag + dimmed disc. 1 tap. Prep uses a "Reveal" button; Tokens has no matching verb. | polish | One verb set: "Hidden from players" + "Reveal". |
| 4f | Assign to player | Pick a player | Owner select lists only "GM" when alone; no hint. | minor | Disabled option "No players yet — share the invite link". |
| 4g | Remove token | Confirm or undo | 🗑, "Remove token", and **Delete or Backspace outside an input** all remove instantly, no confirm, no undo. Same for "Remove prop". | major | 5-second "Removed Rat Guard · Undo" toast, or a two-step button like Journal's "Really delete". Drop Backspace. |
| 4h | Add second scene + switch (screen 08) | Add, then choose when to switch | "+ dungeon" adds **and immediately switches** the live scene; it is named "dungeon" (library id). Active-row tint is barely visible; "orbit" per row is unexplained (camera toggle). Tokens inspector and Edit panel kept showing "Rat Guard" from the old scene (stale selection). | major | Add without switching; "Switch"/"Live" per row; title-case names; clear selection on scene change; camera icon + tooltip instead of "orbit". |
| 4i | Weather / ambience / darkness | Per-scene, instant | Rain rendered, darkness slider works, both per scene and persisted. Ambience appears in both Scenes and Sound. | polish | One home for ambience (Sound), link from Scenes. |
| 4j | `/r 2d6` from chat (screen 07) | Result in chat + tray | "GM 2d6 → 7 [5, 2]" in chat, toast, 3D dice on the table. Placeholder teaches the syntax. Dice are large and **linger past the 6 s toast, over the phone sheet** (screen 15). | minor | Fade dice with the toast; smaller on phone; add a "Roll" button for touch. |
| 4k | Cast Fireball (screens 05, 06) | Pick → aim → confirm | Range ring, bar "aim a 2-cell burst within 6 cells · Cancel", clear hint. With a mouse the **first click casts**; saves and "HP depleted" for three PCs resolved instantly. Only touch gets the confirm step (`TargetingLayer.tsx`). 3 taps. | major | Stage-then-confirm for mouse too, naming the targets in the shape; or "Undo cast" that reverts HP. |
| 4l | Prep → Generate NPC (screen 09) | NPC with a sheet | "Generate NPC (hidden)" → "Clover Quickpaw", hidden, full stat block, Reveal / Remove / Select. 1 tap, excellent. Below the fold on desktop, unreachable on phone (3e). | ok | Fix 3e; move Prep above Sound on desktop. |
| 4m | Journal handout + share (screen 10a) | Write, choose audience, notify | "+" → Title / Markdown / Image / Share with (Only me · Everyone · Chosen players) / Pin. "Create" below the fold on desktop. Then Edit / Pin / Announce / Delete; Announce posts "GM shared a handout: …" to chat. 4 taps. Create / Save / Announce are three verbs for one action. | minor | Pin Create/Cancel to the editor bottom; rename "Announce" to "Post to chat". |
| 4n | Edit: resize token, add prop (screen 10) | Gizmo, bigger token, a prop | "Edit mode: on" → Move (G) / Rotate (R) / Scale (S) / Snap + 3-axis gizmo; Size ± works. "Add a separate prop" offers only scene models: adding "tavern" dropped **a second tavern over the room**. Size/Model controls duplicated between Tokens and Edit. | major | Ship small props (crate, barrel, door, campfire) or label the picker "Scene model as prop"; fit to a cell by default; remove the duplicate controls. |
| 4o | Skill editor: duplicate | Copy to edit | "Duplicate to edit" → "Fireball (copy)", editable id/icon/description/costs, Save → "Saved". 2 taps. Nothing says where custom skills appear. | polish | After save: "Custom skills appear in every sheet's Skills tab." |
| 5a | Leave | Back home | Immediate, no confirm; home shows "Your games: Audit table · GM · Last opened 4 min ago · mausritter · Rejoin / Forget" (screen 11). | minor | Warn when players are connected. |
| 5b | Rejoin | State restored | ~1 s, everything restored (two scenes, rain, hidden NPC, handout, custom skill, chat) (screen 12). | ok | — |
| 5c | Reload on `#/game` | Back at the table | Straight into the table in ~1 s. | ok | — |

## Desktop vs tablet vs phone

- **Navigation.** Desktop shows every panel at once (two scrollable columns). Tablet: one 360 px drawer with a tab strip; phone: bottom tab bar + sheet. Both coarse layouts hide the GM-only tabs past the edge (`overflow: hidden` on `.tabbar` and `.drawer-tabs`, `global.css` 228–230). The bar does auto-scroll when the active tab changes, so swiping the sheet header eventually reaches Prep/Editor, but nobody will discover that.
- **Invite.** Desktop/tablet: top-bar button. Phone: inside ⋯ ("Connected · GM / Copy invite link / Leave game"). Players-panel copy says "top bar" on all three.
- **Chat.** Phone and tablet give chat the whole sheet/drawer and it reads well (screen 17). Desktop squeezes it under a full sheet; the one layout a GM is most likely to use has the worst chat.
- **Table framing.** Phone and tablet portrait leave the top third empty and crop the room at the bottom (screens 13, 18); the camera does not refit to the viewport aspect.
- **Dice.** On phone the 3D dice land over the open sheet and cover the panel title and first row (screen 15).
- **Hover.** Template cards keep the orange hover border on touch, so two cards can look selected (screen 16, Tavern + Forest).
- **Token inspector.** Desktop inline; phone below the fold in the half sheet; the "Token 6 · Sheet ›" chip helps.
- **Touch targets** are 44 px+ on phone/tablet (trash, swatches, tabs); good.

## Top 5 improvements for the first ten minutes

1. **Fix the overflowing tab strips** (`.tabbar`, `.drawer-tabs` → `overflow-x: auto`, or 5 tabs + More). Today a phone GM cannot open Prep or the Skill editor, and a tablet GM cannot open the editor.
2. **Make "invite" a real flow:** popover with the visible link, Copy, and one line on how players join; never fall back to `prompt()`; make the Players empty state a Copy button.
3. **Add undo/confirm to destructive one-taps:** token and prop removal (incl. Delete/Backspace), mouse-click spell casts, and "+ scene" auto-switching. A 5-second Undo toast covers all of them.
4. **Give Chat room on desktop and tame the right column:** collapse Journal and Skill editor by default, cap the Character section height, let Chat `flex: 1` actually get space. Collapse Sound/Prep on the left until players join.
5. **Fix the New-game badge bug and add a first-visit GM callout** ("You're the GM — copy the invite link, players pick a token in Players") so orientation does not depend on reading every panel.

## Open questions

- Should the GM own a template PC by default ("Old Barley · you")? It confuses the GM/player distinction and the Owner select.
- Is immediate scene switching on "+ library scene" intentional (prep in front of players) or should scenes stage first?
- Is the mouse single-click cast intended to differ from touch's stage-and-confirm? The `TargetingLayer.tsx` comment implies "a stray tap never fires a spell".
- What does "orbit" on each scene row do for a player? It is the camera mode; the label suggests something per scene.
- Prop library: are small props planned, or is "Add a separate prop" meant only for GLB uploads?
- How long should 3D dice stay on the table, and should they be suppressed while a phone sheet is open?
- Relay list: three of five public relays refused connections throughout; "Connected" was still shown. Is 2/5 the intended threshold for green, and should the GM see which relays are up before sharing the link?

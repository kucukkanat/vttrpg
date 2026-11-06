# Player journey audit

Walked as `player1` (dev profile) against a GM tab on the same machine, Mausritter *Tavern start*,
desktop 1400×900 first, then the phone preset (375×812). Screenshots: `docs/audit/screenshots/01`–`16`.
Latencies are `Date.now()` stamps around each action. A dev-profile tab shares the IndexedDB copy with the
GM, so join/reload times are a floor, not what a player on another device will see.

## Summary

- The first minute is good: the invite page is plain, the "Who are you playing?" sheet is the best screen in
  the app, and claim → sheet → chat roll → spell all round-trip in under a second (join 1.5 s, claim 0.9 s,
  chat roll 0.9 s, GM roll visible < 1 s, reload back into the game 3.4 s + ~3 s scene load).
- Two bugs sit on the core loop: every **save roll from the sheet fails** (`roll failed: unknown identifier
  "str"`) and the **STR/DEX/WIL boxes render blank** (27 px inputs clip the digit), so a player can neither see
  nor roll their stats. On desktop a **mis-click casts a spell with no confirm**.
- The player is never told anything: no "you are Pip", no notice when the GM removes or gives a token, no
  "GM is away, your move won't stick" (the drag snaps back), chat authors show as a hex prefix (`c0e48d`),
  and a shared handout lands below the fold with no badge.

## Journey table

| # | Step | Expected | Observed | Severity | Recommendation |
|---|---|---|---|---|---|
| 1a | Open invite link (01) | Know which game I'm joining | "Join game", "Dev profile player1: this tab uses its own identity", "Your name" prefilled with the profile name, Join / Back. No game name, GM or ruleset; nothing says the name is what others see. | minor | Decode the naddr early: "You're joining **Audit table** (Mausritter)". Subtitle the field "Shown to the GM and players". |
| 1b | Progress while joining | Feedback | "Joining…" plus staged copy in code ("Connecting to the relays…", "Looking up the game…", "Still looking; public relays can be slow…") with a seconds counter after 5 s. Joined in 1.5 s, so never seen. | polish | Fine. After 45 s add "Try again" and "the GM must be online". |
| 1c | Bad link | Clear error | "This is not a valid invite link. Ask the GM to copy it again from the table." Join disabled, Back works; name field still shown. | polish | Hide the name field; offer a paste box. |
| 2a | Arrival (02) | Know what to do | Table loads behind a small "Loading scene…" pill; the claim sheet appears: "Who are you playing? These characters are free. Tap one to play it; you can change later from the Players panel." Rows with initials, name, "Night fisher — STR 8 · DEX 10 · WIL 6 — HP 3", big **Play as**, plus **Just watch**. | – | Model screen. |
| 2b | "Just watch" | Reversible | Label implies passivity, not that "Pick a character" in Players brings it back. | minor | "Just watch for now" + footnote. |
| 2c | After choosing (03) | Confirmation; camera finds me | Sheet closes silently, token selected, camera static, no chat line. Left column expands into a full token editor (name, swatches, Vision, Light, Size, model picker, **Upload a .glb**, "Tip: Delete key removes the selected token", which does nothing for players). | major | Toast "You are Pip" + frame the camera; system chat line; hide the editor behind "Customise token"; drop the tip. |
| 2d | GM-only hidden? | No GM controls | Sound/Prep/Skill editor absent; no add/remove/owner/hidden controls. The Players panel still names the GM's **hidden** token ("● Old Barley"). | minor | Filter hidden tokens for non-GMs. |
| 2e | Players panel | Who plays whom | "player1 · you · Pip Thistledown / Tolga GM [GM] · Old Barley / Pick a character". Says "Nobody else is here yet." for ~2 s before presence arrives. | polish | "Looking for others…" for the first 10 s. |
| 3a | Find my token | Obvious | Three same-size discs; mine has a ring only while selected. On phone (10) the room is ~55 % of the width and a token ~20 px. | major | Permanent owner marker, "Find me" on the chip, camera framing on claim. |
| 3b | Move, desktop drag | Syncs | Moved; GM saw it in ~1 s. The other two mice vanished when I left their line of sight while the room stayed lit, which reads as a bug. | minor | Dim cells outside vision. |
| 3c | Move, phone drag | Moves | Moved (verified on GM) but ended under the half sheet; camera did not follow. Real multi-touch not injectable here. | minor | Nudge camera after a drop under the sheet. |
| 3d | Edit a sheet field | Persists | Background edit kept after blur and reload. | – | – |
| 3e | Roll a save (04) | "STR save 12 vs 8, fail" | **Stat inputs render empty** (DOM value "8", width 27 px). **STR save** posts "c0e48d → c0e48d roll failed: unknown identifier "str"". Cause: `controller.ts` resolves `roll` with `rules.roll(formula, seed)` and ignores `intent.character`, so `d20 <= str` has no scope. | blocker | Evaluate with the character (`rules.evaluate(formula, character, { seed })`), label the result, `min-width: 3.5ch` on stat inputs, unit-test every `kind: 'roll'` in `sheet.json`. |
| 3f | `/r d20` (06) | Chat + dice | 0.9 s: toast, 3D d20, "c0e48d d20 → 1 [1]". Author is my pubkey prefix (`name()` uses presence, which excludes self); GM sees "player1". | major | Resolve self and `meta.gm` to names; keep last-seen names in the doc. |
| 3g | Whisper, dropdown | GM only | Works ("player1 → GM"); placeholder "Whisper…"; the target stays selected for later messages. | polish | Reset after send or show a "Whispering to ✕" pill. |
| 3h | Whisper, `/w` | Works | `/w Tolga psst` silently does nothing: the first word is matched against "Tolga GM". No `/help`. | major | Prefix/quoted match, accept `/w gm`, inline "No one called Tolga", add `/help`. |
| 3i | Cast at a token (05, 07) | Aim → confirm → result | Range ring + bar "pick a target within 8 cells / Cancel". **First click fires** (confirm exists only on touch). I dropped Bramble, a fellow PC, to 0 HP; no undo. Result text is excellent (WIL spent, power roll, damage, flavour) in Skills and chat. No rat in the Tavern start. | major | Stage the pick for mouse ("Magic Missile → Bramble · Cast / Cancel"); warn on PC targets. |
| 3j | Handout shared (08) | Notice it | Appeared in ~2 s but the Journal is the last section under a `flex: 1` Chat, below the fold; no badge; creating a note already shared skips the "GM shared a handout" chat line. Opened note renders Markdown well. | major | Chat line on create-as-shared; unread dot on Journal; toast "New handout · Open". |
| 3k | GM's rolls (16) | See them | "Tolga GM 2d6+1 → 9 [2, 6]", toast and 3D die on my table < 1 s. | – | – |
| 3l | Edit tab | Useful or absent | Size / Rotation / Elevation steppers plus a second model picker; "Select one of your tokens…" when empty; "That token is gone." after removal. | minor | Fold into the Tokens editor for players. |
| 3m | Camera C / F (15) | Discoverable | C = close orbit on my token, F = first person; both good. No on-screen hint or mode indicator; the promised camera toggle is absent for players. | major | HUD pill "Orbit · Follow · Eyes" showing the key; a button on phone. |
| 3n | Phone orbit gestures | Pinch, two-finger pan | `CameraRig.tsx` maps ONE=rotate, TWO=dolly-pan, pinch in token mode; not exercisable here. | open | Device pass. |
| 3o | Hidden tokens | Invisible | GM hid Old Barley: gone from my list and table at once; still named in Players (2d). | minor | As 2d. |
| 4a | No scene yet | Reassurance | Not exercised; code shows "No active scene. / Waiting for the GM." | minor | Add GM presence and game name. |
| 4b | GM offline | Told; inputs explain | Top bar stays green "Connected" (relay, not GM). Players marks the GM "away" after 35 s. My drag **snapped back with no message** and was lost even after the GM returned 3 s later. Only the claim sheet says "No answer from the GM yet". | major | Amber "Connected · GM away" after ~15 s; hold the drag ghost with "Waiting for the GM…" and queue or reject intents visibly. |
| 4c | My token removed (09) | Told why | Token vanished, Edit says "That token is gone.", the claim sheet reappears as on arrival. No "GM removed Pip". | major | Chat line + sheet lead "Your character was removed. Pick another or wait for the GM." |
| 4d | Second token given | Told | "Token 5 · you" appeared in Tokens/Players; nothing else; removed just as silently. | minor | Toast + chat line; chip switches between my tokens. |
| 5a | Reload | Back in game | `#/game` restored in 3.4 s; black table with a tiny bottom-left "Loading scene…" pill over the build tag for ~3 s; tokens appear on a bare grid before the room. | minor | Centred loading state with room name; move the build tag into ⋯. |
| 5b | Leave → Your games → Rejoin | Same character | "Audit table · Player · Last opened just now"; Rejoin returned me with Nettle in < 1 s. Leave has no confirm. | polish | Confirm Leave on phones. |

Taps to first useful action: desktop Join → Play as → drag = 3 (save roll is +1 and fails); phone Join →
Play as → tap a 20 px token (1–3 tries) → "Sheet ›" chip.

## Desktop vs phone differences

- **Layout.** Desktop shows nine sections at once with the Journal squeezed under Chat; phone has an
  eight-tab bar (47 px each) and a half sheet that keeps the table live. The pane's default 800 px lands in the
  tablet drawer layout.
- **Selection dependency.** Character and Skills show "Select a token." until my token is selected. On the phone
  the disc is tiny, sits under the sheet, and Escape or closing the ⋯ menu deselects it, so the Sheet tab goes
  empty again; the "● Nettle Quickwhisker · Sheet ›" chip only exists while selected.
- **Targeting.** Desktop fires on first click; touch stages a pick with a confirm button. On phone the sheet
  auto-closes when a skill is tapped, which is right.
- **Camera.** Desktop has C/F keys with no affordance; phone has gestures only.
- **Top bar.** Phone's ⋯ menu holds only "Connected · Player" and "Leave game" (11).
- **Loading.** Both show the bottom-left pill; on phone it collides with the `ce7eeda` build tag (10a).
- **Latency** was identical on both (same machine).

## Top 5 improvements for a first session

1. **Fix sheet rolls and the blank stat boxes** (3e): pass the character into roll resolution, widen the inputs,
   label the result. The only blocker, and it is the first thing a new player tries after reading the sheet.
2. **Confirm before casting on desktop and warn on friendly targets** (3i): one mis-click spent WIL and
   dropped a fellow mouse to 0 HP with no undo.
3. **Tell the player what happened to them** (2c, 3j, 4b–4d): a system channel in chat plus a toast for "You
   are Pip", "GM removed Pip", "GM gave you Token 5", "New handout", "GM is away". Display names, not pubkeys.
4. **Make "my token" obvious and keep the sheet available** (3a, phone): permanent owner marker, camera
   framing on claim, "Find me", and default Character/Skills to my first owned token when nothing is selected.
5. **Surface camera modes** (3m) with an on-screen pill that is a key hint on desktop and a control on phone;
   reset the whisper target after sending so later messages do not silently stay private.

## Open questions

- Should `/w` support multi-word names, or be replaced by the dropdown plus `@name` autocomplete?
- Should player intents be queued while the GM is away and replayed on return, or rejected with a message?
  Today they are silently lost.
- Error replies are whispered to the player as if from themselves ("`roll failed: …`"); is a `system` message
  kind planned?
- The GM tab's table went black ("Loading scene…") after rejoining while backgrounded; a synthetic `resize`
  fixed it. Is WebGL context loss handled, and does it hit a player who switches apps on a phone?
- Pinch, two-finger pan and long-press need a real-device pass, especially drag-to-move vs orbit when the
  finger starts on a tiny token.
- With dev profiles the shared registry flipped the GM's "Your games" entry to "Player" after the profile
  tab left; dev-only, or should Leave restore the previous entry too?
- The Tavern start has no rat; should every start include an obvious enemy so the first cast has a safe target?

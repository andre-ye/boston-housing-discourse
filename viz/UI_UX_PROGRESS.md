# UI/UX Progress

## 2026-05-07 — three-part tour rewrite + connections-mode + pulse highlight

The interactive tour is now organized into three distinct parts that
each teach one mode of exploration. Connections (formerly the
Shift-to-show-relations toggle) is now a persistent **view mode**, the
random-five action replaces the old toggle on a new R keybind, and the
shimmer overlay is gone in favor of a clean pulsating highlight that
matches the Continue button.

### Follow-up UI cleanup

- Restored hover telegraphing by anchoring the hover halo to the actual
  canvas screen rect and switching the globe cursor to `pointer` over a
  hittable node.
- Removed the passive cmd-click Reddit-thread tooltip from the globe.
- Changed Connections from the old Shift shortcut to `C`, while keeping
  the bottom chip as the visible mode toggle.
- Made the bottom control dock more compact (`R`, `C`, `clear`) and
  moved the full Reset view affordance out to the lower-left.
- Added a visible `clear` chip for transient clutter: it dismisses random
  cards, connections mode, the selected node/detail card, and other
  temporary overlays.
- **`clearSprouts({ immediate: true })`** plus an extra clear on tour
  **Skip / Continue / Back**: random cards were lingering because teardown
  used a delayed DOM remove that raced async sprout rendering.
- Consolidated **`clear`** and **`Reset`** into one **Reset · esc** chip in a
  **horizontal `#globe-controls-dock`** (R · C · Reset) so buttons do not overlap.
  **Esc** clears random captions during tour (tour Escape handler now calls
  `clearSprouts` before trapping the key).

### Tour structure

- **Part 1 — Bottom-up.** A new beat picks three real points at runtime
  (two in the same cluster, one in a neighboring cluster, all within
  ~3.4° on the sphere) and spotlights them with floating numbered
  markers. The user is asked to click each in turn; the step advances
  only after all three have been pinned. They then meet an interview
  voice (P2) and learn the new R-key/chip random-sample action.
- **Part 2 — Top-down.** The existing Gentrification → Rent
  Stabilization → Shortage & Disincentive drill is preserved. After
  the position narrative, the user pins any of the highlighted dots
  (introducing the detail card) and turns on **Connections mode** to
  see thread arcs from their pin to the rest of the conversation.
- **Part 3 — Search & timeline.** Type `covid` to watch matches paint
  across multiple topics, then open the timeline scrubber to see how
  the conversation changes around 2020.

### Connections is now a persistent VIEW MODE, not a transient toggle

- New API: `App.toggleConnectionsMode()`, `App.connectionsModeActive()`,
  `App.refreshConnections()`. The chip's `is-on` state always mirrors
  `_shiftActive` exactly (synced from a single `_syncShiftHint()`
  helper).
- Pinning a different post **smoothly refreshes** the arcs to the new
  pin; no longer hide-then-show flicker.
- Drilling cluster/sub/position refreshes the visible-pool sampler
  ~600ms after the focus settles.
- Escape / the clear chip now drops connections-mode along with other
  transient clutter. Cards/pins still close first.
- Both the `C` key and the chip click route through the same
  `toggleConnectionsMode()` path, so muscle memory and click
  affordances stay consistent.
- The chip turns green (matching the pulse-glow color) while the mode
  is on, so there's a persistent visual signal of what view you're in.

### Random-five is an action, on R, not a toggle on Space

- Old `#space-hint` chip renamed to `#random-hint`, retitled "5 random
  voices on screen", keycap shows "R". Chip is a real `<button>`.
- `App.sampleFiveRandom()` clears any current spread and spawns a fresh
  five each call, so the user can keep pressing R for new handfuls.
- Space is still wired (legacy alias) but flips between "five fresh
  voices" and "clear" rather than being a true toggle. The chip
  flashes briefly each time the action fires so the keystroke / click
  registers visually.

### Pulse highlight replaces the shimmer overlay

- Removed `@keyframes tour-step-shimmer-sweep` and every `::before`
  pseudo-element that sprayed a diagonal gradient across pulse
  targets. The shimmer's borders never matched the host element's
  silhouette (rounded chips, narrow pin labels, bar segments with
  rotated/clipped backgrounds), so it always read as bleeding outside
  the highlight target.
- New `tour-step-pulse-glow` is a tighter multi-layer green/teal
  box-shadow breathing on a 1.6s cycle — same family of motion as the
  Continue button (which already used the keyframe directly).
- Added `tour-step-outline-pulse` so even at the dimmest part of the
  cycle there's a visible perimeter on the click target.
- Spotlight markers (Part 1's three numbered dots) get a floating
  ::after chip that goes neutral after the user clicks each one, so
  the user can see at a glance which they've already inspected.

## 2026-05-07 — tour cleanup and bottom-dock controls

- Reworked the tour pulse on sidebar bars to use inset rings instead of
  `outline`. The bar stack clips overflow, so outlines on absolutely
  positioned subtopic/position bars looked like missing left/right
  borders. The new `tour-step-bar-pulse` renders all four sides inside
  the colored bar itself.
- Moved the random, connections, and reset controls out of the
  top-right corner into a bottom-center dock inside the globe overlay.
  Pinned-node/detail panels can stay open without covering the controls.
  The dock lifts above the timeline scrubber when the scrubber is open.
- Changed the shift chip from a passive `div` into a real button and
  simplified the label to `connections`.
- Added tour-boundary cleanup. Starting Part 1, moving into Part 2,
  moving into Part 3, and leaving via "go forth and explore" now clear
  random sprouts, connections mode, pinned points, spotlight chips, and
  floating inspector cards. Final exit also closes and clears the
  timeline instead of restoring whatever was left in localStorage.
- Connections are explicitly disabled at tour start and whenever the
  tour calls the cleanup helper. `App.clearConnectionsMode()` now forces
  thread arcs off even if the mode flag itself was already false.
- Switched the search demo from "MBTA Communities Act" to `covid`, which
  is a denser chronological example. The tour now waits until the user
  types `covid`, runs the same post-body search as the nav, spotlights
  the matching set, and rotates the globe to the result centroid before
  allowing Continue.
- Improved the bottom-up point picker. It now samples deterministically
  from the corpus, prefers a readable triangle (same-cluster pair close
  but not overlapping; different-cluster point nearby but separated),
  zooms closer, and uses larger numbered markers.
- Lifted the tour card to the top of the screen during bottom-dock
  control steps (`R`, connections, timeline) so the instruction card no
  longer occludes the controls it is asking the user to click.
- Fixed random-sprout cleanup after the R step by adding a render token.
  `clearSprouts()` now cancels any in-flight async sprout render, so
  clicking Continue cannot clear the cards and then have them reappear
  when detail fetches finish.
- Made tour highlights louder without reintroducing shimmer: stronger
  teal glow, wider outline pulse, faster/brighter bar pulse.
- Reworked the connections tutorial copy and visual emphasis around the
  pinned node. The step now first highlights the detail panel's Thread
  context fisheye, then asks the user to turn on the bottom `connections`
  chip as the globe-level view of that exact pinned post's thread.

## 2026-05-04

- Started UI/UX tweak pass.
- Search now accepts regex terms directly when the query contains regex syntax, e.g. `rent|mortgage`, `\bMBTA\b`, or `sub:afford.*rent`.
- Existing explicit regex forms still work: `/pattern/flags`, `re:pattern`, and field-scoped forms like `text:/(rent|mortgage).*spike/`.
- Invalid regex patterns surface as search errors instead of silently behaving like plain text.

## 2026-05-05

- Scaled globe drag speed by zoom level so close-up panning is substantially slower and more precise.
- Scaled thread/edge tube radius by zoom level so relation lines become thinner near the sphere and no longer dominate close-up views.
- Rebuild edge geometry only when the zoom-derived radius bucket changes, avoiding per-frame geometry churn.
- Follow-up: made the zoom scaling much more aggressive after the first pass looked visually unchanged at common focused zoom levels.
- Changed Shift relations to prefer the selected node: pinned point first, hovered point second, then the old visible-thread overview only when no node is selected.
- Hover/pinned node relations now render all available connections for that thread instead of a capped/random subset.
- Converted Space and Shift from hold interactions into toggled modes; Escape dismisses either mode.
- Centralized selected-node clearing so Escape, reset, voice/interview transitions, and the point detail close button unpin the node and refresh relation mode away from node-only connections.
- Updated Escape order so after selected-node/card state is cleared, Escape clears search input, suggestions, regex paint, and text spotlight before finally resetting the camera view.
- Made manual search clearing use the same cleanup path, including subreddit filters created from search results.
- Extended search clearing to unwind topic/subtopic/position focus filters as well.
- Plain-text search now treats Enter as "search post bodies for what I typed" — runs a spotlight search instead of auto-jumping to the highest-scored suggestion. Use Arrow keys + Enter to pick a specific suggestion. Shift+Enter still paints regex/multi-kind hits.
- Added a thread-context fisheye to the pinned-point detail card: the pinned post sits at the center of a small radial graph, with up to ten thread siblings arranged around it, color-coded by cluster and connected by edges. A clickable list under the graph mirrors the same satellites; hovering a row highlights its disc and vice versa, and clicking either re-pins the globe to that point so the card refocuses without leaving the panel.
- Added local bookmarks: a star toggle in the top-right of the pinned-point detail card saves the current point (with a snapshot of cluster/subreddit/title/permalink) to localStorage. A floating "★ N saved" chip appears under the Reset-view hint when the list is non-empty and opens a bottom-right Saved-points card listing every bookmark with cluster swatch, kind/subreddit/month, snippet, and saved-at age. Each row click re-pins to that node (refreshing the detail card and fisheye); a per-row × removes one entry and a Clear-all button purges the whole list. Escape closes the bookmarks card right after the detail/interview/position cards in the priority chain, before search clearing.
- Tour now ignores Escape — pressing Esc while the tour overlay is up is a no-op, so the only way to exit is the explicit Skip-tour button. The keypress is still swallowed at the window-capture phase to keep underlying handlers (search clear, bookmarks card, camera reset) from firing through the overlay.
- Tour beat "We started by talking to 26 people" now spotlights the interview pins. Entering the beat dims every globe point except the eighteen anchor posts under the P-pins (via `globe.setSpotlight`), tilts the camera to a wider angle, applies a `body.tour-pin-spotlight` class that brightens the pin DOM (white-bordered ID chips, halo dot ring, faster pulse), and starts a slow rotation loop so each pin drifts across the visible hemisphere while the narration card is read. Leaving the beat or closing the tour tears down the spotlight, stops the spin, and clears the body class.
- Tour beat "A sphere of voices" rebuilt as an interactive walkthrough. Beats can now carry a `steps: [...]` array; each step has its own heading, instruction, hint, `setup(ctx)` and `subscribe(ctx, advance)` hooks. The tour engine renders one step at a time in a relocated bottom-center card, applies/tears down per-step state automatically, and listens for the user actually doing the affordance — globe hover for "every dot is a post", a nav focus event for the topic-bar drill-down, a globe `pinclick` for the P-pins step, a Space keypress for the random-five toggle, and `t` / ⏱-click for the time filter. A "Skip this step →" button (and Right-arrow) advances within the beat without requiring success; "Back" steps within the beat first, then rolls into the previous beat. Per-step affordance highlights (`body.tour-step-nav`, `body.tour-step-space`, `body.tour-step-time`) glow the relevant chrome so it's findable, and the chrome-off mask is suppressed on step beats so the user can actually click into the nav, time button, etc.
- Drill-state breadcrumb above the bar columns. The narrow column used to show the focused topic name *sideways* (rotated -90°), which was hard to read; that's now replaced with a horizontal "Exploring · All topics › Gentrification & Rent Control › …" pill row that sits in the nav header above the topics/subtopics/points-of-view columns. Crumbs colour-match the focused topic and are clickable for back-navigation. The whole row is hidden when nothing is focused so it doesn't waste vertical space at the wide-globe level. The narrow-column rotated titles now stay generic ("Topics", "Subtopics", "Points of view").
- Tour drill step now only advances on Gentrification & Rent Control (cl=32). Clicking any other topic drills into that topic but does not falsely affirm "Got it" — the tour stays on the step until the user picks the right one. Hint reads "← Click 'Gentrification & Rent Control'" so it's unambiguous.
- Tightened sidebar visibility during the tour: the chrome-off / step-mode rules now flip `visibility: hidden` after the opacity fade, so #nav (which sits at z-index 5 above the canvas) can no longer ghost through during the transition or sit there as a faint silhouette before the drill-tutorial step introduces it.
- Tour reordered so the tutorial moments interleave with the narrative drill-down. Each tutorial step now poses a *question* and pairs it with the *affordance* that answers it, in this order: ① "What is anyone actually saying?" → hover (manual continue, sidebar hidden, dot clicks suppressed); ② "What does Boston argue about most?" → click "Gentrification & Rent Control" in the nav (which then leads straight into the existing cluster/sub/position drill); ③ "What did real people on the ground say?" → click any P-pin (which then leads into the P2 spotlight beat that used to live at the very end); ④ "When did this peak?" → press t / click ⏱ (placed right after the Heating-Issues position so the seasonal spike is the demo); ⑤ "Want a random sample?" → press Space (deliberately last, since Space conflicts with focused tour-card buttons until the surrounding context is wound down). Outro stays at the end. Every tutorial step is now `manualContinue` so the user can dwell on the result before clicking the glowing "Continue →" button.
- Tour now suppresses dot clicks during step mode that doesn't whitelist `'cards'`. Step 1 ("hover any dot") would otherwise let a stray click open a detail card before the user has been told what a dot is or how to read one — that path is now a no-op until a step explicitly opts in to inspector cards (the P-pin step does, because pinning opens an interview card).
- Space step now blurs whatever button has focus on entry, listens at capture for both `keydown` and `keyup`, and `preventDefault`/`stopPropagation`s both — so the keypress reaches `App.toggleSprouts()` even if the previous "Continue →" click left the button focused.
- Interactive tour fixes after first pass:
  - Steps now opt in to chrome via a `showChrome: ['nav' | 'pins' | 'space' | 'time' | 'cards']` whitelist. Default during step mode is "everything hidden" so step 1 ("hover a dot") shows just the globe — no sidebar, no P-pins, no time button — and step 2 ("drill down") is where the sidebar actually slides in.
  - When the sidebar isn't on for the current step, `#globe-root` slides to `left: 0` so the canvas fills the viewport edge-to-edge instead of leaving the dark 340px strip the user used to see when the nav was hidden. The tour card re-centres against the full viewport, then back into the right-of-nav area when the nav reappears.
  - P-pin step now has `manualContinue: true`. After clicking a pin the hint flips to "✓ Got it" and the "Skip this step" button is promoted to a glowing primary "Continue →"; the tour stays on the step until the user actually clicks Continue. Cleanup on continue closes any inspector card the pin opened (interview / detail / position) so step 4 starts clean.
  - Inspector cards (interview / detail / position) now carry `pointer-events: auto` during a step that whitelists `'cards'`, overriding the broader `body.tour-active *.card { pointer-events: none }` rule. The `×` close buttons actually close again, and clicking a row in the body works.
  - P-pins are non-interactive in step 1 (their layer's pointer-events stays off because step 1 doesn't include `'pins'`), so the user can't accidentally open an interview card before they've been introduced to the affordance.
  - "Five random voices" now actually fires sprouts during the tour. The global Space handler in main.js short-circuits while the tour is active, so the step now calls a new `App.toggleSprouts()` directly when it sees the keypress; cleanup calls `App.clearSprouts()` so the sprouts don't leak into step 5.
  - Step 1's hover detection accepts `hover`, `hovermove`, and `pointclick` events — any pointer interaction with a dot under the cursor advances the step, not just an exact "new index" hover transition.

## 2026-05-05 — second integration pass

- **Sidebar visibility, real fix.** The hover step kept showing the sidebar despite previous attempts because `body.tour-active:not(.tour-at-hero):not(.tour-chrome-off) #nav { opacity: 1 !important }` had higher CSS specificity (3 classes) than the step-mode hide rule (1 class) — so the !important fight was always lost. Excluded `:not(.tour-step-mode)` from the force-visible rule so the per-step hide actually wins. The sidebar is now hidden on the hover step, full stop.
- **Hover affordance respects panels.** Globe hover tooltip, halo, and hover arcs are all suppressed while the cursor is over any floating panel (`.detail-card`, `.interview-card`, `.position-card`, `.focus-card`, `#tour-overlay .tour-card`, `#bookmarks-panel`, `#search-suggestions`, `#nav`, `.timeline`). A document-level pointermove tracker flips a single boolean and tears down hover state the instant the cursor crosses onto a panel, so panels always take priority.
- **Tour-card relocated to a clean bottom strip.** Previously the narration card lived at top-right (`top: 50%; right: 40px`) and visually stacked with the inspector cards, which themselves live at `top: 22; right: 22`. The card is now at the bottom of the screen and centred over the globe area for ALL beats (interstitials, drill-down, pin, step). Inspector cards on the right never overlap. Tour-card lifts to the top during the time-filter step (and any other tour beat where the timeline-scrubber is open) so they don't sit on top of each other.
- **Inspector cards hidden across the entire tour.** `body.tour-active .focus-card / .interview-card / .detail-card / .position-card { opacity: 0; visibility: hidden }`. The narrative is the tour-card; floating cards reappear only during the P-pin step that explicitly opts in (`showChrome: ['cards']`) so the user can read the interview paraphrase. This eliminates the "tour covers the pinned post" stack.
- **Tour redesigned around true integration.** Tutorial moments are no longer separate beats interleaved with the narrative — they are the narrative. The drill into Gentrification & Rent Control now requires the user to click each level themselves: cluster → subtopic ("Rent Stabilization Ideas", gid=131) → point of view ("Shortage & Disincentive", posIdx=2). Each click step has its own narrative card explaining what that level means; only the correct target advances. The P-pin tutorial asks for **P2 specifically** (not "any pin"), spotlights P2's home cluster, and pulses the P2 chip. Stops 2 and 3 (Tenant Rights, Bike Lanes) auto-drill so the rhythm-already-learned pattern doesn't get tedious. Time and Space tutorials slot into the narrative as their own short steps, both now driven by clicking the visible chip rather than a keybind.
- **Click targets now visually pulse.** New per-step `pulseClass` (e.g. `tour-pulse-l1-32`, `tour-pulse-l2-32_4`, `tour-pulse-l3-131_2`, `tour-pulse-pin-P2`) lights up exactly the bar / pin / chip the step asks the user to click. The pulse drops automatically when the step transitions to "Got it" so the affirmation reads as confirmed action, not continued prompting.
- **Time and Space tutorials use buttons, not keybinds.** The `#space-hint` chip in the top-right is now an actual `role="button"` — clicking it toggles the five random voices, exactly like Space does, and lights up when active. The time tutorial instructs the user to click the pulsing ⏱ chip in the bottom-right; the keybind path was removed from the prompt (it still works under the hood for power users who use it organically). Tour-card lifts to the top when the timeline-scrubber opens so it doesn't cover the scrubber.
- **Browser back/forward navigates the user's drill history.** Each user-initiated focus change (cluster, subtopic, position, time range) now writes a `history.pushState` entry; the browser back/forward arrows drive the existing `applyHash()` restorer so they step through what the user actually selected. Tour beats are explicitly excluded from history so back doesn't replay the tour. Uses both `hashchange` and `popstate` listeners so direct address-bar edits and browser navigation both restore.

## 2026-05-05 — third integration pass

- **No more P2 fly-out and fly-back.** The pin narrative beat used to call `nav.focus({ cl: pin.cluster })` on entry, which fired the focus listener and rotated the camera out to the cluster anchor before a 220ms-later `rotateTo` brought it back to the pin. The user just clicked the pin in the previous step and was already framed on it — that round trip read as a swing. Pin beats now rotate directly to the pin's lat/lon and skip the cluster focus entirely. The matching P-pin click step also stopped calling `nav.focus({})` on setup (which was triggering an opposite swing toward (0, 0, 3)).
- **Timeline-scrubber suppressed for the whole tour except the time-tutorial step.** Before, if a previous session left `vizPref.timeline === 'on'` in localStorage, the scrubber popped open on boot — and because `body.tour-active .timeline { pointer-events: none }`, the user couldn't dismiss it (only the `t` keybind worked, since keyboard isn't blocked by pointer-events). The launcher button also overlapped its right edge. Two fixes: the timeline IIFE no longer auto-opens when `body.tour-active` is on at boot (the close hook calls a new `App._timelineRestore` after the tour ends so the user's preference still wins post-tour); plus a CSS rule force-hides `#timeline-scrubber:not(.hidden)` everywhere in the tour and re-shows it only under `tour-step-show-time`. State stays in the DOM, so the scrubber returns intact once the tour closes.
- **Search-bar tutorial inside Tenant Rights.** After the heating-position narrative, a new step pulses the search input ("Type 'boiler', 'leak', or anything you're curious about") and waits for the user to type two characters before advancing. Auto-focuses the input on entry so a single keystroke kicks it off. The follow-up time-tutorial step clears the search on entry so the time-filter demo isn't confounded with text spotlight.
- **P18 click tutorial inside Bike Lanes.** After the cyclist-blame narrative, a new step spotlights P18 (the interview voice that talks about blocked bike lanes), pulses the P18 pin, rotates to it, and waits for the user to click. Reuses the existing P-pin tutorial pattern (chrome `['pins', 'cards']`, `pulseClass: 'tour-pulse-pin-P18'`, `pinclick` advance gate filtered to `id === 'P18'`). A short P18 narrative beat follows with paraphrased quotes, no nav.focus camera move (same swing fix as P2).
- **Space-chip hitbox enlarged.** The `#space-hint` pill had `padding: 6px 10px 6px 8px` and `gap: 8px`, leaving a tiny click target. Raised to `padding: 9px 14px 9px 12px` and `gap: 10px`, plus `#space-hint > * { pointer-events: none }` so the entire pill bounding-box catches the click instead of having to land on text. Added a hover translateX nudge, focus-visible outline, and kept the existing `is-on` state.
- **Timeline-scrubber × actually closes.** The toggle button (`#tl-toggle`) is `display: none` while the scrubber is open, so the only visible "close" affordance was the × inside the scrubber — but its handler only reset the date range, leaving the panel open. Pressing `t` was the sole mouseless escape. The × handler now also flips `.hidden` on the scrubber, drops `.active` on the toggle, syncs `body.has-timeline-open`, and persists `timeline=off` to localStorage. Behaviour now matches both the visual cue and the comment that's been there the whole time.
- **`Take the tour` launcher no longer covers the `⏱` toggle.** The launcher (~100×30, `bottom:14 right:14`) and the timeline toggle (38×38, `bottom:18 right:22`) shared the bottom-right corner and overlapped — the launcher's pill ran straight across the toggle's hit-target. Moved the launcher to `bottom: 64`, leaving an ~8px gap above the toggle, so they stack vertically. When the scrubber is open (`body.has-timeline-open`) the launcher fades to `opacity: 0` since it would otherwise sit on top of the scrubber's controls.

## 2026-05-07 — louder click hints (shimmer + concentric pulse)

- **The interaction highlight was too subtle to find.** Old `tour-step-pulse-glow` was a single `0 0 0 6px rgba(255,209,102,0.32)` box-shadow that swelled by ~6px every 1.6s. Against the dark canvas and through the user's peripheral vision, that's basically a quiet fade. Step hints failed at their one job: telling the user where to click.
- **Concentric pulse is now multi-layered.** Three stacked box-shadows: a tight 4px gold ring, a softer 11px gold ring, and a wide 28px atmospheric glow that breathes from off → bright once per 1.4s. Outline brightened from `rgba(255,209,102,0.55)` to `rgba(255,233,160,0.85–0.95)` so the perimeter is unambiguous even when the glow is at its dimmest. Cycle shortened from 1.6s → 1.4s for a more urgent rhythm.
- **Shimmer streak walks across the target.** New `tour-step-shimmer-sweep` keyframes animate `background-position` of a 250%-wide diagonal gradient (transparent → white → gold → white → transparent at 115°) so a bright glint sweeps left-to-right across the element, then rests off-screen for a beat before repeating. Painted via `::before` overlay on every supported pulse target — the three drill bar segments, the P2 / P18 pin chips, the space chip, the time chip (and the future shift chip). `mix-blend-mode: screen` lightens the chip's surface without obscuring the text or icon, and `border-radius: inherit` keeps the gradient inside the element's rounded silhouette.
- **Pin tutorial got a real anchor.** Previously the pulse selector was `.pin[data-id="P2"]` — but `.pin` itself is `width:0; height:0` (just a coordinate anchor), so the box-shadow rendered out from a single point and the outline wrapped a 4-pixel-offset zero rectangle. The pulse now targets `.pin[data-id="…"] .pin-id` (the visible chip) for the glow + shimmer, and `.pin[data-id="…"] .pin-dot` separately gets the same glow plus a `transform: scale(1.35)` so the dot brightens and inflates beside the chip. Both P2 and P18 share the rules.
- **Search input keeps the glow without shimmer.** `<input>` can't host pseudo-elements, so the search step relies entirely on the loud multi-layer glow + the brighter outline. Strong enough on its own that the eye lands on the search bar without needing a streak too.

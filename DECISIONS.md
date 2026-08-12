# DECISIONS

Calls made without interrupting the user, per the brief. Newest last.

## D1 — Three.js is vendored and inlined, not loaded from a CDN
The brief asks for "Three.js loaded from CDN" but also "zero network calls at runtime —
violations disqualify us". These conflict directly. Disqualification risk outweighs the
convenience, so `vendor/three.module.js` (r169, MIT) is bundled into the output.
`dist/index.html` is a single self-contained file that issues **zero** network requests;
the screenshot harness intercepts and reports any request that escapes, as a standing check.
Swapping back to a CDN `<script>` is a two-line change in `tools/build.mjs` if desired.

## D2 — Single-file output, but a real module tree in `src/`
The deliverable is one `dist/index.html`. Development happens in ~20 ES modules bundled by
esbuild. This is what makes parallel subagent work possible (clean file ownership, no merge
conflicts) and keeps the React port trivial.

## D3 — Game loop fully decoupled from the DOM shell
`boot(mountEl)` in `src/main.js` is the only DOM touchpoint; it returns `{destroy()}`.
Porting to React is `useEffect(() => boot(ref.current).destroy, [])`. `window.__DEBUG`
exists solely for the automated screenshot harness — no game code reads it.

## D4 — HUD and menus are DOM overlay, not canvas-drawn
Correct Hebrew shaping, RTL bidi, tabular numerals, focus order and accessibility are
essentially free in DOM and painful in canvas. The 3D scene renders underneath; the overlay
is `pointer-events:none` except on interactive elements.

## D5 — Fixed 1/60 timestep with a seeded PRNG everywhere
`Math.random()` is banned project-wide in favour of `makeRng(seed)`. This makes AI
behaviour, track generation and screenshots reproducible, which is what allows a critic to
do a meaningful blind A/B between two rounds of the same scene.

## D6 — No embedded font files; system-ui plus CSS text effects
Embedding a Hebrew display font would add ~100–300KB and risks licensing questions on
"100% original". `system-ui` at weight 800/900 with layered text-shadow, gradient fill and
stroke gives the chunky arcade look in both Hebrew and Latin, at zero bytes and zero
network. Verified legible in both scripts.

## D7 — Original world identity
Title kept as **מרוץ הפרומפטים**. Player character **ניצוץ**; garage mechanic **בורג**, a
friendly robot. Tracks: **נווה הנתונים** (desert oasis), **עיר הנוירונים** (neon night city;
renamed from עיר המעגלים in Wave 4 — see D32),
**פסגת הענן** (dawn sky islands). Chosen to be unmistakably distinct from both Mario Kart
and the Kart Royale reference (which is a coastal-sunset theme — we deliberately avoid it),
while giving three genuinely different lighting moods to show off range.

## D8 — Isolated per-module preview harness
`tools/preview.mjs` builds any single module's exported `preview()` scene into a throwaway
bundle and screenshots it. Each subsystem is therefore buildable, renderable and judgeable
on its own, before integration — which is what makes the builder/critic split real rather
than theatre, and lets many agents work at once without contending for `dist/`.

---

# WAVE 2

## D9 — Render orientation fixed centrally; steering fixed at the input boundary
P0 #1 and #2 looked like one bug and were two, with different correct homes.

**#1 (karts render backwards)** was a genuine convention clash: the simulation is
`+Z`-forward (`forward = (sin yaw, 0, cos yaw)`, and `_lat` is derived from it to agree
with `TrackSpline.rightAt`, so off-track detection depends on that sign), while
`kartmodel.js` is built to the three.js standard `-Z`-forward. Three call sites copied
the quaternion raw. Fixed once in `kartphysics` with `renderQuaternion`
(`yaw + MODEL_YAW_OFFSET`); physics reads `quaternion`, anything that renders reads
`renderQuaternion`.

**#2 (steering inverted)** was NOT the same root cause, though it presented as one.
The sim's internal `steer` is positive-turns-left, and the drift path derives
`driftLean`/`driftDir` from that same sign. I first "fixed" it inside `kartphysics` and
it broke drift outright — drift went from 4.08% faster than gripping to 3.50% *slower*,
and top speed jumped from 29.5 to 34.7 m/s. Reverted. Every in-engine producer (AIDriver,
`autopilotInput`) is tuned against the internal sign and was never wrong; only the human
mapping was. So the player-facing convention ("right arrow turns right") is established
once at the boundary in `core/input.js` via `PLAYER_STEER_SIGN`. Approved Wave-1 feel is
bit-for-bit preserved (drift advantage 4.08%, stat spread 3.45%).

Both are pinned by `tests/orientation.test.mjs`, which measures steering
**differentially against a straight-ahead baseline** — an absolute "did it move right"
test reads the track's own curvature rather than the input, and initially gave me a false
pass on the very bug it was written to catch.

## D10 — Reading of a garbled line in the Wave-2 brief
The education brief contains a truncated sentence: *"every request to aage build, Burg
gives a short debrief…"*. Read as two requirements that had run together, and implemented
as: (a) the first-ever token pickup shows a one-time popup explaining that tokens are the
currency of AI and that **every request to an AI costs tokens**; and (b) **after each
garage build**, Burg gives a short debrief connecting each filled slot to a prompting
principle, with the ghost-preview card. Logged rather than asked, per the no-questions
instruction.

## D11 — Slow motion runs fewer fixed steps, never shorter ones
The quiz needed slow motion. Scaling `dt` directly would have changed the physics timestep
(kartphysics is tuned for exactly 1/60) and made lap times dishonest. The race loop is now
split into `simulate(FIXED)` and `update(dtReal)`, with an accumulator: the quiz's time
scale multiplies what goes *into* the accumulator, so slow motion emits fewer 1/60 steps
per frame. Rendering, the camera and the HUD stay on real time so the world never stutters.
Race and lap clocks only advance inside `simulate()`.

## D12 — Held keys survive a pause
Pausing used to call `input.reset()`, clearing the set of physically-held keys. Because
`keydown` auto-repeats are deliberately ignored (they would make steering twitchy), a
player holding accelerate through a pause or the first-token popup silently lost throttle
and had to release and re-press. `Input` now tracks keys even while disabled and gates only
`sample()`'s output; `reset()` is for teardown and `softReset()` (steering only) is for
pause. Found by the flow gate, which stalled at exactly one token collected.

## D13 — `window.__THREE__` exposes three classes, not the namespace
The flow gates need `Raycaster` for the track-obstruction sweep. Re-exporting the whole
THREE namespace from the capture harness retained `FileLoader`/`ImageBitmapLoader` — whose
network calls tripped the compliance scan and added ~140KB. The harness now exposes only
`{ Raycaster, Vector3, Quaternion }`. Bundle went 1.16 MB → 1.02 MB.

## D14 — The compliance scan checks our source, not the vendored bundle
Static scanning the built file for network APIs became a false positive once three's
loaders were retained as unreachable dead code. The scan now covers `src/` strictly, and
the real guarantee is the runtime check, which was strengthened to sweep all six scenes
with request interception rather than only the boot screen.

---

# WAVE 2 — SMOOTHING PASS

## D15 — One modal registry, in `ui/style.js`, because it is the only shared import
Wave 2 shipped four things that can own the screen mid-race (first-token
explainer, Boreg's introduction, quiz panel, pause menu) written by four agents,
with no coordination. The bugs were real, not theoretical: the token explainer
could land on a live quiz whose 20s timer kept running behind it; `1/2/3` still
answered — and closed — that hidden question while the pause menu was up; and
opening the pause menu over the token explainer let its resume call
`scene.setPaused(false)`, restarting the race underneath a modal the child was
still reading, with input disabled.

The registry (`pushModal/popModal/modalOpen/modalHas`) lives in `ui/style.js`
because it is the one module every UI subsystem in `race/`, `garage/` and `ui/`
already imports, and it has no imports of its own — anywhere else creates a
cycle. It is a Set of ids, nothing more.

The policy it encodes, stated because it is a design choice and not an obvious one:
- The quiz **defers** behind anything else (its beacon respawns, nothing is lost).
- The one-time explainers **defer** behind anything else (`shouldShowFirstTokenPopup()`
  answers false; the save flag is untouched, so the next token shows it).
- The pause menu **may** open over a quiz — the quiz only slows the world, and a
  child must never be unable to pause for twenty seconds. It refuses only over
  the explainers, which already froze the sim and have their own dismissal.
- Escape belongs to the topmost panel. The token explainer now takes it in the
  capture phase, so it never reaches `input.js`.

Pinned by `tools/modaltest.mjs` (13 checks against the real build).

## D16 — Quiz pacing is fixed with the cooldown, not with the timer
The brief's instruction was to tune `TIME_LIMIT` first. Measured first instead,
on the built game: fraction of a three-lap race with a panel up, autopilot,
comparing a player who answers against one who ignores every question.

| | before | after |
|---|---|---|
| ignores every question | ~83% of the race slowed, 5–6 questions | **~40%, 3 questions** |
| answers promptly | ~20%, 7 questions | **~20%, 7 questions** |

`TIME_LIMIT` came down 24/22/20 → 20/18/16 and `READ_SCALE` 0.72 → 0.78, but the
move that did the work was a **second cooldown**: `COOLDOWN_S` 10s after an
answered question, `COOLDOWN_IGNORED_S` 24s after one that timed out. That is
what separates the two columns above — it fixes the case that dragged without
touching the case that was already fine, and it is a pacing rule rather than a
punishment: the reward for engaging is *more* questions, not fewer. Cutting the
timer alone would have hit the slow reader, who is the one person the timer was
explicitly written not to hurt.

## D17 — Token economy thinned at the source, and the garage rebate capped below the spend
Measurement (not intuition) showed the garage's lesson had stopped being true: a race
banked ~36 tokens against a 21-token maximum spend, and `tokenReward` refunded 18 against
a ~13 spend, so every visit profited and the wallet compounded. Two fixes:

1. **Thin the token spots in `race.js`, not the numbers downstream.** Capping the garage's
   view, rescaling prices, or normalising in `scenes.js` would each have made one of the
   three on-screen numbers (HUD counter, results "earned", garage budget) contradict the
   other two — which in front of a child is worse than a generous budget.
2. **Cap `tokenReward` below the spend** (8 guided / 12 expert). The prize for a good
   prompt is the better part; the rebate is a bonus, not an income. A reward a player can
   farm is an exploit with a friendly name.

A winning run now banks ~20 against a 21 maximum, so even a strong player must choose.
Pinned by a token-yield gate in `flowtest.mjs` that prints the full breakdown each run.

## D18 — Modal traffic control lives in `ui/style.js`
(duplicate numbering fixed in Wave 3: the smoothing-pass entries formerly labelled
D15/D16 are now D17/D18; cross-references to the modal policy mean D15/D18, and to
quiz pacing mean D16.)
Three things can interrupt a race (token explainer, Boreg's intro, quiz panels) plus the
pause overlay. Nothing coordinated them, and three real failures resulted — a token popup
opening over a live quiz whose timer kept running, digit keys answering a hidden quiz
through the pause menu, and pause-resume restarting the race underneath a modal the child
was still reading. The registry lives in `style.js` because it is the only module every
subsystem already imports; anywhere else would have created an import cycle. Pinned by
`tools/modaltest.mjs`.

---

# WAVE 3

## D19 — One canonical standings shape, and the tie-break lives with it
The podium printed `undefined` in every name row, showed the player's kart on all three
steps, and its header called the player "second" while its own table showed them first.
Three symptoms, one cause: `totalPoints()` returned `{racerId, points, racer}` with the
name nested a level down and **no place at all**, so `menus.js` read flat properties that
did not exist and the header recomputed the player's position independently.

Fixed once, at the source. `scenes.js` now defines and documents the canonical shape —
`{place, racerId, racer, name, points, wins, bestFinal, isPlayer}`, sorted best→worst so
`standings[i].place === i + 1` — and exports `compareStandings`: points, then race wins,
then the final race's finishing place, and if all three are level the **player** takes the
higher spot. Anything needing "where did the player come" reads
`standings.find(s => s.isPlayer).place` and never recomputes it. The podium normalizes
defensively for standalone preview but never re-sorts away the ledger's decision.

The kart seam had the same shape of bug: the mounter defaults `racerId` to
`save.read('racerId')`, which is right for the garage and wrong everywhere else. The
default stays (the garage is the common case) and the podium now passes each step's own
racerId explicitly, with the player's saved parts applied only to the player's kart.

## D20 — The quiz freezes the world, and pause-over-quiz survives for the opposite reason
Slow motion became a full freeze: `quiz.update()` returns a time scale of exactly 0, so
zero fixed steps are emitted and the race and lap clocks — which only advance inside
`simulate()` — are provably frozen. D11's accumulator split is unchanged; only the number
changed. Feedback now has **no timer at all** and waits for Space, with `e.repeat` ignored
because Space is also the drift key and a child holding it would otherwise dismiss the
explanation with a key they never released. Resume is 3·2·1 re-emitting `race:countdown`,
so the child reads the gantry lights they already learned at the start. Held keys use D12's
mechanism exactly: `input.enabled = false` plus `softReset()`, never `reset()`.

The D15/D18 rule "the pause menu may open over a quiz" is **kept, with its rationale
inverted**. Wave 2's reason was that a child must always be able to stop a moving kart;
the kart no longer moves. The new reason is that feedback waits for Space indefinitely, so
a quiz panel can be the last thing on screen forever and Settings/Quit must stay reachable
from it. Refusing Esc would make the one key a child knows do nothing in the one state
they can be stuck in. Recording this because the rule looks unchanged and is not.

## D21 — The finish line was two bugs, both in detection, neither in the artwork
The finish fired ~95–99m early on all three tracks. Cause one: the lap was credited on the
**last checkpoint** rather than the line — true the instant checkpoint 15/16 was taken,
i.e. 1/16 of a lap, 72–75m. Cause two: checkpoints fired on **proximity** (`|deltaT| <
0.02`) rather than on a crossing — another 23–24m. `createLapTracker()` now takes a
checkpoint at the frame the lap fraction passes *through* it going forward and credits the
lap on the crossing of checkpoint 0, which is `def.startT` — where trackbuild draws both
the chequer band and the gantry. Residual 0.37–0.55m, one fixed step at racing speed. The
artwork did not move; a test that pinned the visual to the trigger would have pinned the
bug.

## D22 — The championship's quiz memory is harvested from the scene, not the bus
`questionsForDifficulty(difficulty, exclude)` could filter already-asked questions and
`race.js` forwarded an `askedIds` opt — but **nothing ever set it**. The parameter was
inert, the unit test passed (it calls the pure function directly), and race 2 happily
re-asked race 1's questions while comments in two files asserted the opposite. The ledger
is the only layer that outlives a race, so the memory belongs in `scenes.js`.

Ids are harvested from the finished scene's own `quiz.askedIds` rather than by subscribing
to `quiz:open`, deliberately: the title-screen backdrop is a real `raceScene` and would
otherwise pour its questions into the championship's memory from the menu. Pinned by a
built-output gate — excluding five questions must shrink the eligible pool by exactly five
and none may reappear — because the pure-function test passes whether or not the seam is
connected.

## D23 — Blind-strategy gates, per tier and in both directions
The question bank had the correct answer as the strictly longest option in 91 of 100
questions: a child could score 91% without reading. The first fix drove the aggregate to
28% and looked done. It was not — it had **inverted** the bias in tier 1 (correct was never
the longest, so "cross out the longest, pick the middle" scored 75% in race 1) while
leaving tier 3 at 50% the other way. The gate could not see it because it averaged the
three tiers and tested one direction.

The rule this establishes: a gate against a statistical tell must be **per-cohort and
symmetric**. It is now six cells (three tiers × two languages), each requiring that the
best of pick-longest / pick-shortest / pick-middle stays under 45%, ties counted in the
cheater's favour. Best blind strategy is now 41% against 33% for pure guessing. Same
pattern applied to yes/no polarity, ≤4-word options, absolutes and token-mentions, plus a
fingerprint check that no two questions drawable in the same race share a correct answer.

## D24 — The garage is a wizard, and the kart preview was a dead seam
The garage showed sixteen cards at once and read as overwhelming. It is now one slot per
step (part → improve → protect → style) with big poster cards, a progress rail whose
answered pills are live back-buttons, and the assembled sentence pinned full-width and
growing one fragment per answer. All static side text is gone: Boreg's card is rebuilt from
`(step, selection)` on every render, so the tip always names what is selected right now.

Rows 2–4 became **per part** — 48 options over four slots, each speaking its own axis
(engine power/weight, tires grip/wear, wing downforce/drag, chassis agility/flex) — with
`pruneSelection()` clearing downstream rows when the part changes, so a wing's limit can
never end up inside an engine's prompt. Per-option stat biases were deliberately rejected:
`scenes.js` persists only the tier, so a garage-only bias would be a number the race never
honours.

Found while wiring the visuals: the garage called `kartApi.setPart(slot, tier)` but the
mounter scenes.js installs returns a model exposing `setParts({slot: tier})`, so with the
real kart wired in **the preview never changed at all**. It now calls both, and the kart
wears the part the current prompt would produce, live. Economy untouched: cheapest complete
ask 4, maximum spend 21, budget 17.

## D25 — Git is not a scratchpad when agents share a tree
An agent ran `git stash` plus a reset to compare against pre-fix code while five builders
were live. The tree snapped back to HEAD, a racing process dropped the stash entry, and the
entire wave survived only as a dangling commit recovered through `git fsck --unreachable`.

Two rules follow, now in CLAUDE.md. No agent may run `git stash`, `reset`, `checkout -- .`,
`restore` or `clean` — to compare against committed code, read it out with
`git show HEAD:path > .tmp/old.js` and reason about the copy. And the lead commits after
each piece lands rather than trusting an uncommitted working tree, because "several agents
plus one dirty tree" makes every accident unbounded. The earlier critic instruction to
"temporarily copy the old file into place" is withdrawn: it is the same manoeuvre one step
away from the destructive version.

## D26 — One word for the way home, and the verb stays where the action differs
Every exit in the game landed on the same screen and the game called it four things:
`חזרה` (racer select, garage, free play), `לתפריט` (results), `לתפריט הראשי` (podium),
`למסך הבית` (certificate, pause). All correct; all learned separately by a child who
should only have to learn one. Unified on **`למסך הבית` / `Main Menu`** — a concrete noun
a child already owns from phones, over the shorter `חזרה`, which names no destination and
beside "אליפות חדשה" on the podium would have read as "back to what?". English took
`Main Menu` rather than glossing the Hebrew as `Home screen`, because that is what an
English game calls it. The one verb kept is pause's `יציאה` / `Quit to`: that exit
abandons a race in progress, so the destination noun is unified and the action word is
not. Cost one number — the garage's home-pill lane went 104 → 156px, because at 104px the
longer label printed through "המוסך".

## D27 — The HUD spoke a different register from the rest of the game
The house voice is impersonal plural (`בוחרים`, `סיימתם`, `שלכם`), and the rule exists
because it is gender-neutral: half the audience is girls and a masculine imperative
excludes them. An audit of every Hebrew string for masculine imperatives came back clean
— the single hit, `בורג, תבנה!`, is addressed to Boreg, who is a male character.

What the audit did find is that the HUD and the garage addressed the child in second-person
**singular** (`סיימת`, `ניצחת`, `הפרומפט שלך`) while every menu, the results sheet and the
podium used the plural. Both forms are gender-neutral *in writing*, which is why six
builders and five critics all passed over it: nothing was wrong, there were simply two
voices in one game. Fourteen strings moved to the plural. The same pass closed three
vocabulary splits where one thing had two names: the drift gauge said `דריפט` while three
menu strings said `החלקה`; How-to-Play promised a `דחיפה` where the HUD flashes `טורבו`;
and the quiz promised `Turbo` in English where the HUD flashes `BOOST!`.

## D28 — Quiz pacing re-measured against a stopwatch, and nothing retuned
D16's metric — "fraction of the race spent slowed" — cannot exist under D20's freeze,
because race time does not advance at all while a panel is up. Re-measured as wall clock
on the built game: a typical child (6s to answer, 5s to read) is interrupted **10 / 8 / 7**
times across the three races for **132 / 105 / 92 seconds**, against 143 / 167 / 148
seconds of driving — 38–48% of wall clock, at 13.2s per interruption. A quick reader pays
6.2s each, a slow reader 26.1s.

**No number was changed.** The rate is 2.3–3.3 questions per lap against `quiz.js`'s own
stated target of 2–3, and every candidate lever is a written D16/D20 decision. Whether 40%
of wall clock in panels *feels* draggy is a playtest question, not a measurable one.

Two things the measurement overturned, though, and they are why this entry exists. First,
the long-standing belief that an autopilot lap triggers no beacons was wrong — it was the
first-token explainer holding the modal registry for the whole race; with it dismissed the
racing line hits 7–10 beacons. Second, **D16's asymmetric cooldown now runs backwards**.
It was written so that engaging buys more questions and disengaging buys clean racing.
Under a freeze no panel can be driven past — every one must be acknowledged with Space —
so ignoring costs *more* wall clock (6–7 × ~25s) than engaging (10 × 13.2s). The constants
are untouched and the behaviour is not what their rationale describes.

## D29 — A gate that cannot see a term must say so in its own name
The end-to-end token-yield assertion reads `6 ≤ tokens ≤ 28` and has passed since it was
written. Its driver holds a throttle key down the racing line and has never once triggered
a quiz beacon, so `tokensFromQuiz` has printed **0** on every run in the project's history.
The band passes precisely because the term that breaks it is absent: measured properly, a
child who answers well banks ~51 tokens in race 1 against a 21-token maximum garage spend,
so the garage's central lesson is false for exactly the engaged child the game is for.

Two ways to respond, and the choice is the decision. Retuning `REWARD_TOKENS` at the end of
a wave, without the ability to measure the result end to end, would have been tuning blind
against a gate that cannot check the work. Instead the blindness was made **impossible to
misread**: the assertion is renamed to say the quiz is not covered, a companion assertion
fails the day the driver *does* start hitting beacons (so the band gets widened
deliberately rather than silently), and `tests/economy.test.mjs` pins every constant the
economy is made of and prints the real totals. That last test is a characterisation test,
not a balance test — it asserts the imbalance **exists**, so fixing the economy turns it
red and the fixer must come back and update it. A green tick that means less than it looks
like is worse than a red one, and this wave produced three of them (the garage's 3D
checks, modaltest's Escape checks, this).

---

# WAVE 4

## D30 — Reading of six truncated passages in the Wave-4 brief
The brief arrived with several sentences cut mid-word. Per D10's precedent (and the
standing "no questions mid-wave" instruction) they are read here rather than asked
about, so the reading is auditable and can be corrected in the playtest.

| # | As received | Read as |
|---|---|---|
| 2 | "…(the הא + איך משחקים): steering arrows must point outward" | The controls legend wherever it appears — the title screen's key strip **and** the `איך משחקים` overlay. Both fixed. |
| 6 | "Target: a winning,e max spend, so choosing where to be precise still matters." | Target: a winning **player still cannot afford the maximum garage spend**, so the choice of where to be precise still bites. This is D17's rule restated with quiz rewards now included. |
| 9 | "Both paths through mod." | Both input paths (keys and pointer) go through **the same code path and the same modal-registry guards** — not two implementations that can drift. |
| 11 | "Charming, two sentences, not preac" | not **preachy**. |
| 12 | "answering a quiz about X how a hint of where to find them" | Answering a quiz about a topic unlocks that topic's term; **locked terms show a hint of where to find them**, not the definition. |
| 15 | "an optional fun-title picker from PRESET options only (e.g. אלוף/ת ⟨cut⟩contest rule)" | Preset titles only, no free text — because free text is a personal-data entry point, and the contest rule forbids collecting any. The `אלוף/ת` form also confirms titles must be offered in both grammatical genders (D27). |

## D31 — Ducking is a registry subscription, not five call sites
Item 8 asks that engine and world audio stop while **any** modal is open, "for every
current and future modal". Wiring that at each of the five existing modals guarantees
the sixth one forgets — which is precisely the failure class D15 was created to end.

`ui/style.js` therefore grows `onModalChange(fn)`: subscribers are called once
immediately and then on every empty↔non-empty transition of the modal set. The
registry stays a Set of ids plus a Set of callbacks and keeps its defining property of
having **no imports of its own**, so audio can subscribe to it without creating a
cycle. A modal id invented next wave ducks the audio without anyone remembering to
wire it, and that property is gated rather than merely intended.

Master volume is a **separate** save key from `muted`, not a replacement for it. A
child who mutes and later unmutes must land back on the volume they chose, and a
volume of 0 must not be indistinguishable from mute in the UI.

## D32 — The banners were lettered on their far side, and the comment above the bug said so
Every trackside sponsor board in the game has read back-to-front since Wave 1. The cause
was a single inverted swap in `gfx/props.js`: the quad was wound so its front normal
pointed **away** from the centreline, U therefore ran along `+side·tangent` instead of the
driver's screen-right `−side·tangent`, and the `DoubleSide` material dutifully showed the
driver the reverse of the authored face. The comment directly above that line states the
correct rule — screen-right is `−side·tangent` — and the code beneath it does the opposite,
which is why five waves of readers skimmed past it.

The finish gantry escaped, and its escape is the diagnostic: it is a `PlaneGeometry`
rotated to face back down the track, so its local +X lands on the driver's screen-right by
construction. "The finish-line text is fine" was the whole clue.

The same inverted swap sat at the night-city holo billboards, with a louder symptom that
nobody had connected to it: that material is `FrontSide`, so instead of reading mirrored
those signs were back-face culled and **invisible from the racing line**. One bug, two
presentations, neither reported as the other's twin.

Fixed at source (both sites), and *also* guarded centrally: `enforceSignOrientation()` runs
over the finished track group and re-winds or re-UVs any lettered face that violates the
invariant. Both, deliberately — the source fix is the honest repair, and the central sweep
is what makes the guarantee hold for the next module that draws Hebrew into the world
without knowing this rule. It refuses (rather than silently "repairing") negative world
scale or negative texture repeat, which UV rewriting cannot honestly fix.

**The invariant, stated once so it can be gated:** for any lettered quad with front normal
`N`, `U` must increase along `up × N` and `V` along `+Y`. That holds at any viewing angle,
so a board seen edge-on down a straight obeys the same rule as one seen head-on.
`tests/signage.test.mjs` re-derives normals and UV gradients from the real position/uv
buffers and pins it — geometry, not a string match, because a regex on Hebrew text cannot
see which way a triangle faces.

Track 2 became **עיר הנוירונים** / Neuron City in the same pass. The `id` and `theme` stay
`'circuit'`: the id is persisted in `results[]` and the theme keys palettes, gantry skins,
sky and prop sets, so renaming either would have been a save migration in exchange for
nothing. Display names flow from `trackdef` through `scenes.js:trackNameOf`, so every
screen followed for free.

## D33 — The game was too easy because the AI's pace fraction, not its rubber band
A passive player won 15 races out of 15. The instinct is to blame the catch-up band; the
measurement blamed the opponents' raw speed. The AI's own flat-out lap was already slower
than a clean driver (oasis 48.08s against a 46.95s reference), and `paceForDifficulty`
then took a further 3.5–18.5% off that. So the field was never racing the child in the
first place, and no band setting could have hidden it.

Three changes, each measured rather than reasoned:

1. **`AI_PACE` is flat 1.00**, with a new per-track calibration `TRACK_PACE`
   (`oasis 1.03 / circuit 0.96 / cloud 1.00`) because ref-autopilot versus AI flat-out
   differs by **+2.4% / −5.2% / +4.7%** on the three geometries. One global pace lands the
   field in a different place on every track, which is why the old ladder read as three
   unrelated difficulties.
2. **The opponents buy garage parts too** (`aiPartTier` → 0/1/2 for races 1/2/3), through
   the same `PART_TIERS` the child buys. This is the only lever that raises the AI's top
   speed — above about 1.05, pace buys nothing on oasis/cloud except time spent off-track —
   and it makes the garage legible: the rivals visibly upgrade alongside you.
3. **`BAND_CATCH` (+7.5%) is untouched.** The ceiling is the fairness argument and widening
   it to manufacture tension would be the punishing kind of difficulty this audience must
   not meet.

**The never-lapped fix, and why it was subtle.** GAPS.md carried "at 70% pace the player is
lapped on race 3" for two waves. The floor was written as **−17% of base pace**, and a
percentage floor silently changes meaning when base pace moves: it was 0.677 effective on
race 1 but 0.801 on race 3. It is now an absolute effective-pace floor
(`BAND_FLOOR_PACE = 0.62`), identical on all three races. Measured in the built game, race
3 at 70% pace went from **1.04 laps down (lapped, alone) to 0.19**.

**Measured finish distribution**, seeds 3/11/19/41/57, real `KartBody` player on the game's
own `autopilotInput`, 7 real opponents, collisions on, 3 laps, race N → track N:

| pace | race 1 before → after | race 2 before → after | race 3 before → after |
|---|---|---|---|
| 100% | 1st ×5 → **mean 2.2** | 1st ×5 → **mean 3.8** | 1st ×5 → **mean 3.8** |
| 85% | 4th → 6th | 2nd–5th → 6th | 6th–8th → 6th–7th |
| 70% | 8th, 0.24 back → 0.17 | 8th, 0.25 → 0.15 | 8th, **0.61 → 0.20** |

Garage axis at 100% pace (mean place): stock 2.2 / 3.8 / 3.8 → tier 2 **1.0 / 1.6 / 1.0**.
So an upgrade is worth +1.2 places on race 1 and +2.2–2.8 on races 2–3 — which is the
brief's "winning races 2–3 requires a decent prompt", now true rather than asserted.

**The quiz axis fixed itself, and the reason matters more than the outcome.** Measured
against the OLD field, a correct answer's turbo was worth ~0.15s — about **0.1 of a place**
(0/2/4/6 correct → 2.2/2.2/2.0/1.8), so the brief's "a couple of quiz boosts wins race 1"
was simply false. The obvious response was to strengthen `BOOST` in `quiz.js`, and that was
ordered and then **withdrawn unapplied**, because re-measuring against the NEW field showed
the target had already come true on its own: 0/2/4/6 correct → **2.67 / 2.00 / 1.33 / 1.00**,
winning 0/6, 1/6, 4/6, 6/6 of seeds.

Nothing about the boost changed. Compressing the field into ~6 seconds over a ~150s race
makes finishing position roughly a **0.7s-per-place** function of the player, so the same
1.3/2.4/6 turbo that used to buy 0.1 of a place now buys one or more. Applying the
strengthened constant on top of that compression would have overshot and made race 1
unloseable for anyone who answers.

The general lesson, which is why this paragraph exists: **a balance measurement is only
valid against the field it was taken on.** Two agents measuring the same lever a few hours
apart got answers differing by a factor of ten, and neither was wrong. `BOOST` stays at
`{1.3, 2.4, 6}`. On races 2–3 the turbo is still worth ~nothing (3.50→3.17, 3.83→3.50, zero
wins at any engagement level), which is correct per the brief: there, the quiz contributes
through the **tokens** it feeds the garage, not through the turbo.

The gate's old budget was slack enough that the **broken** code passed it (0.72 laps), so it
was tightened to 0.35 and made two-sided: clean no-engagement driving must not win race 1
*and* must not be punished either, and a tier-2 kart must win it back so a future rebalance
cannot make the championship unwinnable.

## D34 — The engine was distorted, not merely loud; and music ducks rather than stops
"Too loud and grating" turned out to be three faults, and fixing only the level would have
left it grating at a lower volume. The voice was two detuned saws plus a square through
`driveCurve(6)` — a tanh with slope ~6 near zero, which is a ~15 dB distortion stage rather
than the warm saturator its name suggests. And it barely moved: idle and flat-out measured
**0.98 dB apart**, so the thing a child heard was a constant buzz in the literal sense.

Now: two detuned triangles as the body, one quiet saw purely as harmonic food for the
filter, the square reduced to a strain-only trace, `driveCurve(2)`, and the lowpass ceiling
pulled 12 kHz → 5.2 kHz with Q 2.2–6.5 → 1.2–3.2, so the rpm-tracked resonant sweep carries
the revving instead of the distortion. Output now scales with rpm as well as load.

| rpm | 0 | 0.15 | 0.3 | 0.5 | 0.75 | 1.0 |
|---|---|---|---|---|---|---|
| after (rms) | 0.0084 | 0.0129 | 0.0152 | 0.0177 | 0.0214 | **0.0270** |

Before: 0.0801 at rpm 0.15 and 0.1012 at full, i.e. **×1.26** across the whole rev
range. After: monotonic, peak 0.068, ratio **×2.1**.

**Three parties measured this engine and got three different answers, and the meter was
the reason.** The builder first recorded idle 0.0074 / ratio ×3.47; a critic measured
0.0113 / ×2.39 and additionally reported a *non-monotonic dip* (rpm 0.15 louder than
0.30) stable across three passes; the gate itself printed ×2.60–3.15 on consecutive runs.
None of them were reading a different build.

`triB` is detuned +0.4%, so against `triA` at a 55 Hz fundamental it beats with a
**~4.5 second period**. Every one of those measurements used an analyser window of
46 ms — a fraction of one beat — so each sampled a different point on the beat envelope.
Repeated passes *within one page load* share the beat phase, which is exactly why the dip
looked "stable across three passes": it measured the same artifact three times. At
`fftSize 32768` (743 ms) over 2.5 s windows, cross-page reproducibility is ±2–4% and **no
build shows a dip at all**, including one with the original strain terms restored.

The builder had already "fixed" the phantom dip by cutting the lugging strain terms, and
**reverted that on discovering the meter was lying** — removing designed character to
chase a measurement artifact is the wrong trade. The real defect underneath was separate
and did survive: idle sat at ~0.005, barely 2 dB above the test's own silence floor, so a
child on the grid could not hear their kart. Fixed by raising `IDLE_FLOOR` and lowering
the rpm coefficient — lifting the bottom without touching the top.

The lesson generalises past audio: **a repeated measurement is not an independent
measurement if the repeats share the thing that biases them.** Every engine number the
gate prints now comes from one sweep on one long meter, rather than each assertion
opening its own short window.

**Ducking is one subscription, not a list.** `onModalChange` (D31) is subscribed once and
never inspects ids, so a modal invented next wave ducks with no wiring. That property is
what the gate actually tests: replacing the subscription with a hardcoded
`['quiz','pause','token','meet']` still passes the `pause` probe and fails only the
unknown-id probe — the decisive proof, since a list is exactly what a future maintainer
would write.

Two judgement calls inside it. **Music ducks to −9.4 dB rather than stopping**: a quiz card
is a beat inside the race, not a scene change, and cutting the music dead reads as "the game
broke", with the restart on close more jarring than the duck. **The SFX bus stays fully
open**, because the quiz stingers and the buttons the child is about to press live there.
Engine and world go to true zero over 120 ms via `linearRampToValueAtTime` —
`setTargetAtTime` only approaches zero asymptotically, which would have left an audible
floor. A new `worldBus` separates world ambience from SFX so the world can be silenced
without muting the buttons, and all three group buses are now written from one place
(`_applyBuses`), because the old code applied duck and volume from two places and a volume
change mid-duck silently undid the duck.

## D33b — What actually pinned a struggling child at 6th was the slot table, not pace
The first rebalance hit every literal target at 100% pace and quietly made race 1 as harsh
as race 3 for everyone else: an 85%-pace child finished **6th on all three races**, where
Wave 1 gave them 3rd → 6th → 8th. Race 1 is the onboarding race, runs at the AI's own floor,
and the garage comes *after* it — so that child had no lever available and had not yet been
taught that prompts buy speed. That is the version of "earned" that reads to an eight-year-old
as *this game doesn't want me*.

Both obvious fixes were measured first, and **both did nothing**:

| intervention at race 1 | 85% mean place |
|---|---|
| as shipped | 6.0 |
| widen the field's internal pace spread 1.5× / 2× / 2.5× / 3× | 6.0 / 5.6 / 5.8 / 5.6 |
| cut the race-1 catch-up ceiling to 0.5× / 0.25× / **0×** of `BAND_CATCH` | 5.8 / 6.0 / **6.0** |
| **stretch the backward slots 1.8× at d01 = 0** | **4.0** |

Removing race 1's catch-up *entirely* moved the outcome by nothing. The cause was never speed.
Once a player drops below the field's pace, the hold-back floor gathers the pack around them
and finishing order is decided by **how many opponents are aiming to sit behind the player** —
and `SLOT_AHEAD` has exactly two negative-enough entries at every difficulty. The answer was
therefore "6th", on all three races, structurally.

The fix stretches only the **backward** half of the slot table, and only on the gentle races
(`slotStretch(d01) = 1 + 0.8·(1−d01)²`): race 1 has four or five rivals racing for the places
behind you, race 3 keeps the original two. The forward slots (+2.5s, +1s) are untouched at
every difficulty, which is what keeps a clean 100% driver fighting for the win rather than
being handed it. `BAND_CATCH`, `BAND_HOLD`, `BAND_FLOOR_PACE`, `AI_PACE`, `TRACK_PACE` and
`aiPartTier` are all unchanged.

Measured in the **built game**, the championship a struggling child plays is now
**4th → 5th → 6th**:

| pace | race 1 | race 2 | race 3 |
|---|---|---|---|
| 100% | 2.2 → 3.0 [2.45 over 11 seeds] | 3.8 → 3.0 | 3.8 → 3.8 |
| 85% | **6.0 → 4.0** | 6.0 → 5.0 | 6.2 → 6.1 |
| 70% | 8.0 → **6.0** | 7.4 → 6.8 | 8.0 → 8.0 |

Never-lapped is bit-for-bit untouched (0.17 / 0.15 / 0.20), and a 70%-pace child now finishes
**6th of 8 on race 1 rather than last** — something the brief has wanted since Wave 1.

**The gate now measures shape, not just bounds.** The previous one asserted three things about
a struggling player — not lapped, not alone, place ≤ 7 — and nothing about the curve, so it
passed a 6/6/6 championship as readily as a 3/6/8 one. It now asserts that race 3 minus race 1
at 85% is **≥ 1.5 places**, that race 2 sits between them, and that race 1 at 85% is **≥ 3.0**
so the correction cannot be overshot into a free win either. Against the round-1 code it fails
exactly twice, both new assertions; against the critic's `aiPartTier → 2` mutant — previously
invisible at 6.0/5.6/6.2 — it now fails eight times.

Honest caveat: at 100% pace race 1 means 2.45 over eleven seeds but spreads 1st–3rd, so a
machine-perfect line will still occasionally win race 1 outright. Tightening it costs the
gradient that matters more (`SLOT_STRETCH_EASY = 1.7` buys 2.27 at 100% but slides 85% back to
4.8 and collapses the race1/race2 ladder). The struggling child's gradient was chosen over the
last tenth of a place at the top.

## D35 — The intro card, and a gate-sniffing shortcut that was rejected
Each race now opens on a welcome card: the track's name at display weight and one
`הידעתם` line tying that track's theme to AI (data / neural networks / cloud computing).
It registers as `'intro'` and behaves like the one-time explainers rather than like the
quiz: it **defers** if anything else already owns the screen (a welcome has nothing to
lose, and stacking one on a panel a child is still reading is the Wave-2 failure the
registry exists to end), and nothing stacks on **it** — the scrim swallows pointer events
and it takes Escape in the capture phase, so Escape dismisses the card instead of reaching
`input.js` and opening pause behind it. `pause.js` now refuses over `'intro'` alongside
`'token'`/`'meet'`, for their reason: it freezes the sim, it is short, and there is no
moving kart to rescue a child from.

**The rejected shortcut is the part worth recording.** The card broke `flowtest`'s
playability slice at *"countdown completed, kart is moving — phase=intro"*, taking thirteen
downstream checks with it. That slice reaches a race by **clicking the real menu buttons**,
so it never calls `__DEBUG.goto` and the existing `engine._headless` opt-out did not apply.
The builder's fix was a `navigator.webdriver` check, argued as load-bearing: a tool driving
the real UI is indistinguishable from a child by every in-game signal there is.

It was correct that it worked, and it has been **removed anyway**. Sniffing for the test
harness would have meant that no automated gate ever again sees the card on the path a real
child takes — production behaviour and gated behaviour permanently divergent, on the one
screen every single race opens with, and green for exactly that reason. That is the
"green tick that means less than it looks like" failure D29 was written about, installed
deliberately. The honest fix was one line in `flowtest`'s `playerBeat()`, which already
dismisses every other blocking modal the way a child would; the card joins that list, and
so does the quiz's new first-box explainer. `flowtest --only=play` is green through the
real card, on the real player path.

Two implementation traps found by mutation and screenshot rather than by review, both worth
knowing: `h()` applies styles with `Object.assign`, which **cannot set CSS custom
properties**, so a per-track accent passed as an inline `--var` silently fell back to gold
on all three tracks; and a "nothing stacks on the card" assertion that checked only DOM
visibility passed against a broken build because the quiz panel's fade-in had not yet
reached a non-zero opacity — it now asserts on `quiz.phase` as well.

## D36 — Two input paths, one funnel; and `.on` is a global, not a decoration
The quiz gained full mouse/touch alongside 1/2/3 + Space. The requirement the brief
actually cares about is that both go through **one code path**, because two
implementations drift and only one of them ends up gated. `answer(slot, via)` and
`dismiss(via)` are the single funnel; `via` is recorded and nothing else, so the
registry guard, the freeze, the feedback state and the resume countdown are literally
the same lines for both. Building it this way immediately surfaced a rule the keyboard
respected and the pointer did not — the `DISMISS_AFTER_S` arming delay lived inside the
key handler — which moved into `dismiss()`.

**The bug this uncovered is the one worth recording.** The celebration flash added the
class `.on` to a full-screen element. `.on` is not decorative: `ui/style.js` defines
`#ui *{pointer-events:none}` and `#ui .on{pointer-events:auto}` as the global opt-in for
interactivity, and it out-specifies the element's own `pointer-events:none`. So after
every correct answer an invisible full-screen sheet covered the panel and swallowed every
click: **a mouse or touch player could not press the continue button at all**, while the
keyboard sailed straight through. It had been invisible for three waves because the game
was keyboard-only. Renamed to `.fx`. The general form — *a shared utility class carries
behaviour, so reusing it as a state marker silently grants that behaviour* — is why the
gate now hit-tests the continue button rather than merely asserting it exists.

Two gate lessons from the same round. A **real mouse click cannot catch a missing modal
guard**, because the pause overlay swallows it by geometry — a programmatic `.click()` is
what tests the policy, and a `page.mouse.click` is what tests the hit-testing; both are
needed and neither substitutes. And a touch-target floor asserted at 1366×768 did **not**
bite (padding alone makes the row ~47px there); it only bites at the height-bound
1024×640, which is where it now lives.

## D37 — A drift can be swallowed by a same-frame quiz turbo
`driveFeedback()` emits at most one `drift:boost` per frame from the body's `last*`
provenance fields, which record only the most recent boost. The quiz applies its turbo
from `quiz.update()` while a drift release happens inside `simulate()`, so when both land
in the same 1/60 frame the release's tier and source are overwritten and the drift is
reported as `external` — lost entirely. Forced same-frame in a test: 19 real releases,
0 counted.

Real odds are one frame-width per answer, so this is rare rather than dangerous. It is
fixed anyway, because it is the third instance of the same class in one wave — D35's
rising-edge read, the chained-corner re-boost, and now this — and the class is "a
per-frame observer sampling a state that can change more than once per frame". Rare bugs
of a class you have already been bitten by twice are not rare, they are pending.

`KartBody` now keeps a bounded `boostLog` and exposes `drainBoosts()`, returning every
boost since the last call with its own provenance, oldest first. It returns a shared
frozen empty array when there is nothing to report, because the common case is every
frame and the per-frame-allocation ban applies.

## D32b — The central sweep was corrupting the one board D32 called correct
Bringing the finish gantry into `TEXT_MESHES` (it had been created with no `.name`, so it
sat outside both the fix and the gate — a coverage hole shared by fix and gate, which is
the failure CLAUDE.md warns about) immediately exposed two real bugs inside
`enforceSignOrientation` itself:

1. **It swept per MESH, but geometry can be shared.** The gantry hangs one
   `PlaneGeometry` off two meshes, so the sweep rewrote that uv buffer twice, taking its
   own first-pass output as the second pass's "original". It thereby *corrupted* the one
   board D32 singles out as correct-by-construction — two vertices left with identical
   UVs and one triangle collapsed to degenerate. Now swept once per geometry.
2. **It decided "which side of the track" from triangle centroids.** On a 35 m gantry
   those sit ~17 m off the centreline, and the 16 m pairing radius then failed silently
   for any board wider than ~11 m. The decision is now made from **quad centres**, and a
   centred panel skips only the winding repair, never the U check.

The sweep is now a verified no-op on all three tracks — which is what a guard against a
bug already fixed at source should be, and was not.

## D38 — Legibility is metres of board per character, and nothing else
The Wave-4 signage shipped 24 original, correctly-themed, factually true Hebrew lines
rendered at **7 px of cap height** — 0% of a lap with a legible sign on two of three
tracks. The curriculum was written and then drawn too small to teach.

The governing identity, found by measurement and now written into the code: while a line
is width-limited, **capMetres ≈ 0.4 × boardWidth / characters** — the tile aspect cancels
out entirely. So legibility is bought with metres of board per character and by nothing
else; a bigger font had no room to grow into, and more boards would have traded ambience
for nothing. The fix was therefore short copy on wide boards: 48 new lines, all 2–3 words
and ≤14 characters, on boards widened 7→13 m (mid) and 3.6→6.8 m (near).

Two second-order causes, both worth keeping:
- **The depth band was fighting the field of view.** Round 1 pushed boards to ~45 m off
  the centreline, where a board leaves a 62° frame before it ever grows — peak 12 px. Cap
  height is `547 × capMetres / Y`, so the band moved to Y ≈ 23–33 m: still unmistakably
  mid-ground, now legible all the way in. Density is unchanged at ~1 board on screen.
- **The size was decided inside a draw callback**, where no gate could see it. It is now
  an analytic `signLayout()` computed with no canvas, with `measureText` demoted to a
  clamp that may shrink and never grow. That is why it could shrink to 0.13 em unnoticed.

| track | median best-in-frame | max on lap | % of lap ≥14 px |
|---|---|---|---|
| oasis | 4.3 → **10.6 px** | 13.2 → **25.2** | 0% → **27%** |
| circuit | 3.7 → **9.5 px** | 10.2 → **25.7** | 0% → **25%** |
| cloud | 5.6 → **10.4 px** | 15.3 → **23.3** | 1% → **26%** |

Also fixed here: signage now builds **after** dressing and ray-tests each candidate from
the two distances it is actually read from, against props that are tall and cheap —
deliberately name-free rather than coupled to props.js's mesh names. Occluded candidates
walk inward rather than being dropped, so no board is lost.

And a process note that explains how a 7 px sign passed review: **every existing preview
was a static pose that happened to stand near a board.** There is now a chase-camera
preview framed on the nearest board ≥20 m away, so "can a child read this?" is answerable
by looking rather than by trusting a comment.

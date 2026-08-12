# GAPS

Known remaining gaps, logged per the brief when a piece hits its critic-round cap or
when something is deliberately accepted. Updated as waves complete.

## Wave 1 — accepted tradeoffs

### AI: a very weak player still finishes last (accepted, by design)
The brief asked that a weak player "still finish mid-pack rather than 8th by a lap". A
hard bound on the rubber band and that outcome are mathematically incompatible, and the
AI builder chose the bound. Measured: the band stays within **0.830–1.075** across 27
races, and catch-up is capped so a trailing opponent can never lap faster than its own
clean flat-out.

What a struggling player actually gets:
- at **85%** pace → finishes ~6th of 8, within 6–8s of the winner, karts visible ahead
  and behind for the whole race (this is the common case)
- at **70%** pace → a 30% deficit — finishes 8th, but **still on the lead lap**
  (+35–41s against 53–57s laps). Never lapped, never alone on track.

This is the right call: an unbounded band is the thing kids actually notice and resent.
Revisit only if playtesting shows 8-year-olds landing nearer 70% than 85%.

**Re-measured during the Wave-1 smoothing pass**, per race rather than in aggregate —
real built game, autopilot on the oasis, player top speed and accel scaled to `pace`,
two seeds each, finishing place out of 8 and laps behind the winner:

| pace | race 1 (diff 1) | race 2 (diff 2) | race 3 (diff 3) |
|------|-----------------|-----------------|-----------------|
| 100% | 1st             | 1st             | 1st             |
| 85%  | **3rd–4th**     | 6th             | 8th (0.25–0.32) |
| 70%  | 8th (0.24)      | 8th (0.62)      | 8th (**1.04 — lapped**) |

Two things this changes:

1. **Race 1 is genuinely gentle.** `scenes.js` maps race N → difficulty N, and
   `difficulty01(1)` is 0.0 — the AI's own floor, the gentlest setting it has. At 85%
   pace a child finishes 3rd–4th on race 1, not 6th; the 6th figure above was measured
   at a harder setting than race 1 actually uses. The championship curve a struggling
   player experiences is 3rd → 6th → 8th, which is a legible escalation rather than a
   wall. Nothing in the difficulty wiring needs changing.

2. **"Never lapped" is not true on race 3.** At 70% pace the player finishes 1.04 laps
   down on `cloud` — over the line into being lapped, and alone on track, which is the
   exact outcome the bound was chosen to prevent. Races 1 and 2 hold (0.24 / 0.62).
   Fixing it lives in `ai.js` (band floor at d01 = 1.0), outside the smoothing pass's
   scope. Wave 2.

### AI: positions 7–8 can drop out of sight on the tightest track
On `circuit`, 7th–8th finish ~18s adrift. Those are the two stat-handicapped racers
sitting at their band floor. Will worsen if the roster's stat spread is ever widened.

### Kart physics: wide roads make running wide nearly free
On `oasis` a player can understeer ~6m off line and pay almost nothing, because the road
is ~20m wide. A track-geometry property, not fixable from the physics side. Candidate for
Wave 2 once the track meshes are final.

### Kart physics: braking is 1.7g against 1.0g of lateral grip
Deliberately inconsistent as a friction circle, so kids can always scrub off a mistake.

### Drift: blue tier is nearly imperceptible (0.05s over a 230m run)
Deliberate — it is the participation reward. If playtesting says blue feels dead, raise
its impulse rather than its strength.

### Audio: `drift.sustain` is the weakest sound
Still fundamentally white noise through moving filters. Real tyre scrub is granular — a
rapid train of stick-slip events. Doing it properly needs a scheduled burst train whose
density tracks charge, which conflicts with the per-frame-allocation ban. Wave 2.

### Track: the mid-ground depth rung is missing (highest-value visual fix left)
Between roughly 60m and the cliffs, the reference has a band full of readable objects —
trees with real silhouettes, buildings, boats, marshal posts — each with its own value
separation. Ours is sand, scattered shrubs and palms, so the eye jumps from the barrier
straight to the mesas and the depth ladder loses a rung. **Adding a proper mid-ground prop
set (marshal posts, tyre stacks, distant tents/pit buildings) is the single highest-value
visual move available.** Secondary: the distant mesas are flat-shaded 7-sided prisms that
read as paper cutouts in the aerial view (fine in fog).

### Kart: the tall goalpost wing is a compromise
It is the only place a rear upgrade is visible from the chase camera, but in the
three-quarter hero shot it reads more dragster than kart and slightly fights the toy
proportions. The engine slot also remains the least legible upgrade in play, since the
number plate and wing pylons sit in front of it.

### Kart: mid-frequency detail is ~20 features against the reference's ~40
Radiator fins, suspension arms, seat piping, bumper trim, lamp eyes and hub caps were
added, but the reference still carries roughly twice the small-feature density that makes
a model read as expensive at three-quarter view.

### Overhead bunting casts heavy hard-edged shadows across the racing surface
Physically correct for a 15–25° golden-hour key, but the triangular pennants strung over
the track throw large dark blobs onto the asphalt that read as smudges rather than as
shadows, and they sweep across the player's kart constantly while driving. Options for
Wave 2, cheapest first: exclude the bunting from `castShadow`; soften with a larger PCF
radius; or raise the strings so their shadows fall outside the drivable width. Worth a
playtest opinion first — in motion this may read as pleasant dappling rather than noise.

### Garage has a large empty band in the lower-middle of the screen
With one slot row revealed at a time, rows 2–4 sit collapsed as thin stubs and roughly the
lower third of the frame is empty backdrop. The progressive reveal was the right call (it
took the on-screen card count from 16 to 4), but the layout has not been rebalanced around
it. Candidates: centre the active row vertically, or bring the stat panel and tip card
inboard to fill the space.

### No bloom pass
Tier-3 "hero" parts use emissive materials, but without a bloom pass emissive reads as
lighter-coloured plastic rather than as glow. The hero tier compensates with geometry
(chrome swan-necks) instead. A bloom pass is a renderer-level change for Wave 2.

### Cloud Peak physically cannot carry a mid-ground depth rung (Wave 4 finding)
Probed in Wave 4 while placing signage: the plateau is solid to only ~16–17 m past the
barrier and then falls away 20 m. So the mid-ground prop band that works on oasis and
circuit has **no ground to stand on** here — this is a fact about the track, not an
oversight, and anyone planning to "fix the depth rung on all three tracks" should read it
first. What Wave 4 did instead: pushed the outward cap 12 → 17 m with a ground-searched
walk (depth spread 1.4 → 8.8 m), raised the boards to 4.2 m at the plateau edge, and
inverted their skin to dark-on-light so they read as a shape against a white plateau under
a pale sky. That gives the frame an anchor; it does not solve the entry below.

### Cloud Peak does not read as "above the clouds" from the driver's seat
The championship finale's whole concept — floating stone islands over a cloud sea — lands
in the aerial view and on the wide corners, but not from the seated chase camera, because
the plateau's own edge sits behind the barrier and crowd. Wave 2 improved the value
structure (fog density 0.0038 → 0.0019 so distant silhouettes stop collapsing into the
sky, and a cooler/darker plateau stone `0xf0dcc8` → `0x9fa8c4` to give the frame an
anchor), which helped but did not solve it. The real fix is structural: drop or lower the
barrier on the outside of the two widest corners so the drop-off is visible from a seated
camera, or bring an island into the near band on the player's side. Track 3 is the
finale — it should be the most spectacular of the three and is currently the least.

### Token economy — fixed, but worth watching in playtest
Wave 2 measurement found the garage's central lesson ("precision costs, so choose where
it is worth spending") had quietly stopped being true. Two independent causes:
- One race banked ~36–45 tokens against a max garage spend of 21 and a budget of 17, so
  the budget never bound for anyone who raced competently.
- `tokenReward` refunded **more than the spend** (score 84 → 18 tokens back on a ~13
  spend), so every garage visit turned a profit and the wallet compounded.

Now: token spots thinned at the source (a winning run banks ~20), and the rebate capped
below the spend (8 guided / 12 expert). Pinned by a token-yield assertion in
`tools/flowtest.mjs` that prints the pickups/quiz/finish breakdown every run. The band is
6–28; if playtesting shows children finishing races unable to afford a specific prompt,
raise the floor rather than the ceiling.

### Quiz pacing when questions are ignored
A player who ignores every quiz panel still spends ~40% of a race in slow motion (down
from ~83%). Fixed with an asymmetric cooldown — 10s after an answered question, 24s after
a timeout — rather than by shortening the timer, which would have punished slow readers,
the people the generous timer exists for. Watch whether 40% still feels draggy.

## Fixed during integration (recorded because each would have shipped silently)
- **Garage upgrades never reached the physics.** Three subsystems named the same four
  slots differently (`tires`/`wing`/`chassis` vs `tyres`/`frame`/`turbo`), so every
  upgrade resolved to `undefined` → tier 0. The garage looked like it worked. Now has an
  explicit translation layer and `tests/parts.test.mjs`.
- **The garage was skippable.** The results screen's secondary CTA routed straight to the
  next race, letting a player bypass the entire educational core.
- **`curvatureAt`'s documented sign was inverted** (positive is a RIGHT turn, not left).
  Verified numerically; comment corrected and pinned by `tests/curvature.test.mjs`. The
  behaviour was left untouched — trackbuild and the AI are built against it.
- **`--lang en` was broken for every module**: the capture harness wrote the language to
  save and flipped direction but never called `setLang`, so strings stayed Hebrew.

## Deferred to Wave 2 by design
- Tracks 2 (עיר הנוירונים, then named עיר המעגלים) and 3 (פסגת הענן) meshing and dressing. Their spline layouts,
  themes and lighting rigs already exist and are validated; only geometry + scenery remain.
- Item/pickup variety beyond tokens.
- Expert-mode free-text scoring refinement and its larger token rewards.
- Juice pass: richer particles, screen-shake tuning, crowd animation.
- Performance pass on the `low` tier against real mid-range hardware.
- Final cross-game smoothing of difficulty curve and copy tone.

## Wave 2 — found by the smoothing pass, left for the owning file

### The token economy is ~2–3× too generous, and the fix is in `race/race.js`
Measured on the built game, autopilot, oasis, answering quizzes: **45 tokens
banked from one race** (31 collected on track — pickups plus quiz rewards — plus
a 14-token win bonus). A player who finishes 8th banks ~14. The garage's most
expensive possible prompt costs **21**, against an authored budget of 17.

So the central trade-off ("you cannot buy precision in all four rows") survives
only for a child who is losing. A child who is winning can buy everything, every
visit, and the leftover carries forward — visit 3 opens with well over 60.

The single-point fix is the pickup value in `race.js`:
`S.tokens += 1 + Math.floor(S.combo / 3)` over ~28 pickups a lap, plus
`FINISH_TOKENS = [14,12,11,10,9,8,7,6]`. Roughly a third of both lands the
budget in the intended 15–25 band. It was not done here because `race.js` was
outside this pass's scope, and because every workaround available inside the
scope (capping the garage's view of the wallet, rescaling prices, normalising in
`scenes.js`) makes one of the three on-screen numbers — HUD counter, results
"tokens earned", garage budget — contradict the other two, which is worse in
front of a child than a generous budget.

**What was fixed here instead: the two places the screen asserted the scarcity as
fact.** `garage.budget.note` ("לא מספיק לכול") now only shows while the budget is
genuinely below `MAX_COST`, and the `budget.tradeoff` tip card is gated on the
same condition. A teaching screen that says something a child can see is false
stops being believed about anything else on it.

### `race.js` does not expose its quiz system on the scene API
`scene.player`, `.field`, `.hud`, `.input`, `.chase` are all exposed for the
harness; `quiz` is not, so no gate can open or inspect a question directly.
`tools/modaltest.mjs` works around it by driving an autopilot lap until a beacon
fires, which costs ~40s per check. One line in `race.js`'s returned object.

### The menu backdrop leaves a second `.quiz-root` in the DOM
The title screen's backdrop is a real `raceScene`, so it builds a full quiz
system (correctly disabled). Its overlay element is mounted into `engine.ui` and
is only removed when the backdrop disposes. Harmless — it is always hidden and never
armed — but any test that does `document.querySelector('.quiz-root')` silently
inspects the wrong node. Test for `.show`, or query all of them.

### CSS transitions do not settle under the screenshot harness
`advance()` steps the sim without presenting frames, so a property mid-transition
(`.quiz-root`'s `visibility`) reads as its old value indefinitely under
`getComputedStyle`. A first pass at the pacing measurement above reported 93%
slowed because of this. Measure class membership, not computed style.

## Wave 3 — accepted, deferred, and found-but-not-owned

### The audio test was flaky in two places; one is fixed, one is still open
**Fixed — the engine assertion.** "engine produces output" failed a full-gate run at
`rms 0.0000` and passed on retry. Cause was in the test, not the game: it emitted
`kart:engine` every 30ms while `setEngineState` throttles writes to one per 33ms, so the
test's period aliased against the throttle and an unlucky phase dropped the early writes
while the rpm ramp was still near-silent. It now emits at 60Hz from an idle rpm of 0.3,
which is what `race.js` actually does. Three consecutive runs: 0.0761 / 0.0757 / 0.0740,
against 0.0000–0.0815 before.

**Also fixed — the idle-bus assertion, and it was not a threshold problem.** "idle bus is
quiet" failed intermittently (`rms 0.04910`, later `0.02604`) against a 0.004 floor.
Cause: the test measured silence while sitting on the **title screen, whose backdrop is a
real `raceScene`** — that is the point of it, you can see the game running behind the logo
— so it emits `kart:engine` every frame and re-enables the engine voice on the frame after
`__hush()` disables it. Whether the bus was quiet depended on whether an rAF landed inside
the measurement window. The test now moves to racer select first (karts, no simulation).
Three consecutive runs at exactly 0.00000. Worth remembering as a class: **a "silence"
measurement taken on a screen that is secretly running the game is not measuring silence.**

### `engine.resize()` was window-only; now element-observed, but scenes were never audited
`engine.width`/`height` and the renderer's backing store sat at their boot values for as
long as no window `resize` event was delivered — measured at `engine.width === 800` on a
1920px page under headless Chrome, which is how a stale three-column layout reached a
gate. Fixed with a `ResizeObserver` on `engine.el` plus `engine.teardown()`. What was NOT
done: auditing whether any scene had quietly compensated for the stale size, or whether
any layout now reflows where it previously did not. Racer select is proven; the rest are
merely no longer wrong in principle.

### Racer select is height-bound at 1024x640
The kart windows are 83px tall there, so the karts are as large as they can be without
clipping on the turntable. They read fine but are small. Buying more would mean a
shallower `SELECT_PITCH` (less hero) or a taller `.mn-view`, which the short-viewport
budget cannot afford.

### The garage's route home is wired from outside the garage
`attachHomeControl()` is mounted by `scenes.js`, and `menus.js` injects a
`.grg-top{padding-inline-start:104px}` rule to make room for it. That is a cross-module
coupling that belongs in `garage.js`'s own top bar, which the navigation pass did not own.
If the garage header is ever restyled, move the button into `topBar()` and delete the rule.

### Four different words for "go home"
`חזרה` (racer select, garage, free play), `לתפריט` (results), `לתפריט הראשי` (podium),
`למסך הבית` (certificate, pause). All correct, all reachable, all learned separately by a
child who should only have to learn one. A copy pass should unify them.

### The certificate's buttons are smaller than every other screen's
36px tall against 46–52px elsewhere. Above the 24px floor the layout gate enforces, so it
passes, but small for a young child on the screen that is meant to feel like an award.

### `tools/selecttest.mjs` has no retry
It crashed once with a puppeteer `page.reload` navigation timeout at `bootSelect` and
passed on the three runs after. Transient, but a gate that flakes teaches people to re-run
gates until they are green, which is the habit that lets a real failure through.

### Quiz pacing must be re-measured against a stopwatch, not race time
D16's numbers (10s answered / 24s ignored cooldown, ~40% of a race slowed) were measured
against *slow motion*. With the D20 full freeze, "fraction of the race slowed" no longer
means anything — race time does not advance at all while a panel is up. The real cost is
now wall-clock interruption count (~7 answered / ~3 ignored per race, unchanged). Whether
that *feels* right is a playtest question, and the metric that used to answer it is gone.

### ~~A quiz open at the finish line loses its explanation~~ — no longer reachable
Logged as an accepted tradeoff when the freeze shipped, then disproved by measurement: a
critic forced a question open 12m before the line and advanced 20s, getting
`move 0.000m, raceTime +0.000s`. The flag cannot fall while a panel is up, because the
sim is frozen and `quiz.update()` runs before `simulate()`, so a beacon can never be taken
on the same frame the line is crossed. The full freeze fixed this as a side effect.
Kept here struck through rather than deleted, because a documented hazard that no longer
exists is worse than no note — someone will otherwise "fix" it again.

### Space is both "dismiss feedback" and the drift key
A player who taps Space to dismiss adds it to the held-key set, so a hop can fire on resume
if they hold it through all three countdown beats. The 2.16s countdown absorbs the
realistic case. Fixing it properly needs a "consume this key" concept in `input.js`.

### The tie-break's fourth rule is unreachable in practice
"If still tied, the player wins" is implemented and documented, but `bestFinal` is unique
per racer whenever both ran the last race, so rules 1–3 always decide first. Kept as a
safety net; only rules 1–3 are gated.

### Real-vs-sandbox garage keys off `championshipRace > 0`
So between choosing a racer and finishing race 1, the home-menu garage is still the
sandbox. Defensible (nothing is yet at stake) but not what the words say.

### Two gate holes found by the Wave 3 critics, fixed in round 2 — recorded as patterns
Both are worth remembering because the gates looked thorough and were not.

**A gate can watch the wrong layer.** `tools/garagetest.mjs` bundles the garage
standalone, so its kart preview falls through to an in-file placeholder whose `setPart()`
is an empty function. Every 3D assertion in its 68 checks was a regex on a DOM caption —
deleting `applyKartPreview()` entirely still passed all 68. A gate that renders nothing
cannot see a rendering bug.

**A gate can exercise a path no player can take.** `tools/modaltest.mjs` dispatched
`new KeyboardEvent()` on `window`. A real keydown lands on `document.activeElement` and
bubbles, so a capture-phase `stopPropagation()` genuinely blocks `input.js`; dispatched on
`window` there is no capture phase to stop, so `input.js` fires regardless. Removing the
`isTopOverlay` guard — the one whose comment records that a single Escape used to collapse
the whole overlay stack — still reported "all modal checks passed". Synthetic events must
be dispatched where the real ones arrive.

**And a gate can pass vacuously.** modaltest's "pause never stacks on a live quiz" printed
`0 quiz samples` on every run: its loop broke on the token explainer, seconds before any
beacon could fire. An assertion over an empty sample set is not an assertion. Where a
check depends on reaching a state, assert that the state was reached.

### The quiz's "time scale is exactly 0" assertion is decorative
A mutant that returns a time scale of 0 and *also* runs one `simulate(FIXED)` per frame
while frozen passes it. Only the snapshot-delta assertions — comparing `raceTime`,
`lapTime` and position across the freeze — catch that. Do not let anyone simplify the slow
`simSnap` checks away on the grounds that the scale is already checked.


## Wave 4 — accepted, deferred, and found-but-not-owned

### The wallet can reach 22 against a 21-token maximum ask, at garage visit 2
D39 landed a winning engaged race at 12–18 tokens against a 21 max ask. But the wallet
CARRIES between visits, so the richest measured race (18) plus the largest guided rebate
(4) reaches 22 at visit 2 — one token over. Closing it at source needs a race that pays
less than a complete ask; the only other lever is capping the garage's view of the wallet,
which D17 rejected because it makes the HUD counter, the results screen and the garage
budget contradict each other in front of a child. The flow gate prints the number every
run. **Watch in playtest**; if it bites, cut the rebate before the race payout.

### `prompt-80` is the first badge that would go unreachable after an economy retune
It needs a wallet of exactly 17 to afford the score-84 ask that clears it (13 buys 51,
16 buys 75). Races now bank 12–18, so it lands at garage visit 2–3 on carried-over
tokens. Deliberate (D40), but it means **after any future economy change, check
`prompt-80` before checking the token badges** — it goes first.

### 85% pace still finishes ~6th on race 3
D33b restored race 1 to 4th and race 2 to 5th for a struggling child, giving a legible
4→5→6 championship. Race 3 is unchanged at 6th, which is correct as the finale but means
the gentlest and harshest races now differ by 2 places rather than the 5 they did in
Wave 1. If playtest says the finale feels like a wall, the lever is `slotStretch`'s
falloff, not the band.

### The quiz stinger is the loudest thing in the game
Measured during the Wave-4 audio pass: quiz stinger peak **0.52**, against race music
0.44, wall hit 0.40, token pickup 0.19, and the redesigned engine at 0.068. It fires 7–10
times a race (D28) over music that never rests. The engine was the reported complaint and
is now four times quieter; the critic's judgement is that what would actually wear on a
parent in the room after twenty minutes is the stinger. **Measure that before touching the
engine again.**

### Cloud Peak signage helps the frame but not the concept
See the Cloud Peak entries above: the plateau physically cannot carry a mid-ground rung,
so Wave 4 gave it a dark anchor at the plateau edge instead. The "doesn't read as above
the clouds from the driver's seat" gap is unchanged and still wants the structural barrier
change.

### The lead's periodic commits swept in agents' mid-flight work
Three separate agents reported that a `git add -A` commit picked up files they were still
editing, so some Wave-4 commits contain states that were not gate-green at that instant
(each was verified green shortly after). The commits are what makes an accident
recoverable — D25's whole lesson — so the practice stays, but a future lead should either
commit per-agent-report or accept that intermediate commits are snapshots, not releases.
Also fixed this wave: `.tmp/` was being tracked, 2021 files and 1.0GB.

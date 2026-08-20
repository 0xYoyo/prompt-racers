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

## Wave 5.1 — what this wave did not close

### ~~Starting a championship still freezes on the FIRST visit to each track~~ — masked in Wave 6, not eliminated
**Closed as a player-facing freeze; the cost itself is unchanged.** Wave 6 raises the pre-race
intro card BEFORE the world is built rather than after it (D62), so on the player path the
curtain is up 2–6 ms into the transition with 0 ms of main-thread block in front of it and the
whole 1.9–5.7 s build happens behind a card the child was going to read anyway. The BUILD still
costs exactly what it cost — the entry below is left in full because it is still true of every
harness, autopilot and screenshot path, and because anyone who later measures a cold transition
and finds seconds in it should know that is expected and masked, not a regression. The player
path is now gated separately in `tools/transitiontest.mjs`.

### (original entry) Starting a championship still freezes on the FIRST visit to each track
Every later visit is now free (warm transitions went 1673–3529 ms → 207–912 ms), but the
first entry to a track a session has not seen yet still blocks about **6–7 seconds headless**,
up to 15 s on a loaded machine, which we estimate at roughly **1.5–2 seconds on a real
mid-range laptop**. It is the one-time cost of baking that track's twelve large textures, its
sky, and its signage occlusion layout. Of the four freezes the player reported, this is the
only one still present, and only the first time each track is seen. Closing it means baking a
track ahead of time on idle frames — a new system rather than a cache, so it was deliberately
left. The gate holds it under a cold ceiling so a regression there still fails.

### Kart contact shadow on oasis at נמוך — area closed, contrast not
The נמוך blob is now raked along the sun's ground projection, driven by each theme's real
elevation (oasis 15° → 2.61 m smear, cloud 13° → 3.03 m, the night circuit's 38° moon → 0.90 m,
correctly almost symmetric). Masked ground A/B on oasis went **25,305 px → 68,910 px** against
the real cast shadow's 64,158, so the 2.5× area deficit that made the kart read as pasted is
closed and marginally overshot. Direction and shape now match the real גבוה shadow in the same
frame (`shots/w51r4-oasis-zoom-raked.png` vs `shots/w51r4-oasis-zoom-real.png`).

**What is still open is depth, and it is deliberately unclosed.** The raked blob darkens its
footprint by 37.9% of local road brightness where the real shadow at גבוה reaches 51.7%. The
only lever left is alpha, and oasis' asphalt is near-black (base sum-RGB 75 against cloud's
163) — which is precisely the surface the retired pre-Wave-1 card misjudged in the other
direction (D55). Trading a measured area win for a contrast gamble is the wrong trade. Cloud is
unambiguously solved; oasis reads acceptable at chase distance and is the weakest of the three.

Two smaller residuals ride along, neither observed in play nor gated: the smear now extends
~2.6–3.0 m, so on a strongly crowned or banked stretch its far end could sink into the road and
be depth-clipped; and two karts running side by side overlap their smears, doubling alpha in the
overlap (visible as peak Δ rising 136 → 167 on oasis with per-card alpha unchanged).
`BLOB_SKEW_MAX = 4.0 m` never binds today — cloud's 3.03 m is the longest rake in the game.
All numbers reproduce with `.tmp/gt/ab3.mjs`.

### ~~Race 3's target is only half met — an upgrade alone wins the finale~~ — CLOSED in Wave 6
Closed by D58's conditional finale scaling: race 3's field now runs a tier above the player's
engine/turbo, so tier-2 ×0 went from **1.10 mean / 36 wins in 40** to 2.10 / 8, while stock
race 3 is bit-identical over 240 races. The original entry is kept below because its measured
lever ("put the finale's opponents on tier-3 parts") is the one D44 named and Wave 6 did NOT
take — a flat tier-3 field costs the approved stock number; only the conditional form does not.

### (original entry) Race 3's target is only half met — an upgrade alone wins the finale
Measured over 40 seeds: a clean, unengaged, stock driver finishes **3.90** (0 wins in 40, 15
podiums, +2.2s), and the same driver answering all eight questions finishes **3.40**. That half
is on target. But **a tier-2 kart with zero questions answered finishes 1.10 and wins 36 of
40**, and tier-3 wins 40 of 40 — so "winning realistically requires a decent upgrade **plus**
engagement" is really just "requires a decent upgrade". The cause is that `aiPartTier` caps the
finale's opponents at tier-2, so a child arriving on tier-2 meets an equally-equipped field on
the geometry with the least room to defend. This is the same fault as the upgraded-kart
inversion already logged, not a second one. It was **flagged rather than retuned** because
Wave 5's brief froze race 3. The one measured lever is putting the finale's opponents on tier-3
parts.

### Race 2 cannot be won by quiz engagement alone — now a MEASURED DEAD END, do not re-open
Wave 6 was briefed to close this as a player-made design decision and could not, and the search
is now exhaustive enough to be worth more than the outcome. On a stock kart a fully engaged
child gains **0.22–0.37 of a finishing place** on race 2 across five disjoint 40-seed sets
(against 0.99 on race 1), finishing 3.30–3.67 with **zero wins in 200 seeds**. Eight correct
answers make the player 0.77% quicker over a 166 s race; the field's own pace spread is ±4%,
and with the band on the winner gains 1.20 s of the player's 1.28 s — 94% cancellation, which
is not a tunable: a rival's steady gap is `slot + τ·atanh(δ/holdMax)` and a player gain `Δδ`
moves it by `τ·Δδ/holdMax`, so the ratio is `Δδ/δ`, independent of `BAND_TAU`, `holdMax` and
the slot table alike. Levers swept and null, all race-2-only so races 1 and 3 stay
bit-identical: `SLOT_FWD_R2` → 0 (3.45, 0 wins); `bandCatchMax` 0.60 / 0.40 (3.63 / 3.60, 0
wins — and it helps a *tier-3* kart, not the engaged stock one); `racerPace` spread
×0.6/0.35/0.15; `BAND_TAU` ×1.5/2.5/4.0; and the `quiz.js` BOOST constant, which round 1 had
named as the untried lever — **1.80× / 5.0 s / impulse 12 with twelve answers reads mean 2.75
and 0 wins in 40**, roughly a 3× buff far past anything shippable, buying 0.9 of the 2.7 places
needed (and as a global constant it reads race 1 = 1.00 with 40/40 wins). Configurations that
compress the field enough to make a boost worth places make the finishing order
noise-dominated, at which point clean driving starts winning race 2 too, which the same design
decision forbids. Recorded in `tests/ai.test.mjs` under "MEASURED DEAD END". **Race 2's win is
gated on the garage, by arithmetic.** The original entry follows.

### (original entry) Race 2 cannot be won by quiz engagement alone
Race 2 hits its "clean driving lands 3rd–4th" target exactly (3.73 mean, 0 wins in 40), and an
upgrade wins it (tier-2 2.17, tier-3 1.63). But the other half of the target — "winning wants an
upgrade **or** solid quiz engagement" — is unmet: a fully engaged child with a stock kart never
wins race 2 on any of 40 seeds, and still does not at any plausible boost buff. Race 2's win is
gated on the garage, full stop. Closing it means either a race-2-only boost or loosening the
pace, and loosening breaks the 3rd–4th target the playtest asked for. Left as a deliberate open
question for the next playtest rather than resolved by measurement alone.

### The idle soak is compressed, and one half of idle cost is still unmeasured
`tools/idletest.mjs` now burns 25 real seconds on the real rAF loop and bounds timer callbacks
and DOM mutations, which is what catches per-second and per-present regressions. But the bulk of
its soak is still simulated time via `__DEBUG.advance`, which passes zero wall time and performs
zero presents. KB-per-present is reported rather than asserted, because SwiftShader gives only
~30 real presents in 25 s and the figure swung 0.3 → 10.5 KB across identical runs. A per-present
allocation smaller than the noise floor would still hide.

### `preview.mjs` screenshots are not reproducible, and never were
Established while auditing this wave's pixel evidence: `tools/shot.mjs` is byte-exact
(0 of 1,440,000 pixels differ across two runs) because `__DEBUG.goto` parks the engine headless,
so only whole `advance()` steps pass. `tools/preview.mjs` never sets `_headless` — the real loop
keeps stepping on wall-clock dt — so it differs from itself at **~80% of pixels at title and 43%
at podium**, before-vs-before. Any pixel-count claim in this repo's history that rests on
`preview.mjs` is weaker than it reads. Use `shot.mjs` for pixel evidence.

## Wave 6 — the final wave: what is left, honestly

### Pickup moments are all in the first ~35 seconds of a ~140-second race
Wave 6 took the lap from one pickup row to three and held the income by retiring a whole row
for the race (D59). That delivers the brief's "dopamine spread through the lap" and does not
deliver it spread through the RACE. Measured on the built game, winning and fully engaged,
seed 3, `token:pickup` per lap: **oasis 4/0/0, circuit 4/1/0, cloud 4/0/0.** The row reads
well on lap 1 (`shots/w6c-drv2-t3_6.png`) and the same stretch is bare tarmac on lap 2
(`shots/w6c-drv2-t50_2.png`). Nothing is snatched from in front of the child — the 1.2 s row
clear was verified by eye and never fires in view — but there is no mark saying "you collected
this", so laps 2–3 read as an emptier track rather than a cleared one.

Both ways out were **built and measured, not argued**, and both fail:
- **2 rows, 55 s respawn** → 5/6/5 pickups. One token more everywhere, which puts circuit
  exactly ON the derived pickup ceiling; **lap 2 is still dead** (laps run 45–56 s, so the row
  returns after the kart has already passed it); and the lap drops below the three visible
  clusters the brief asked for.
- **3 rows, 55 s respawn** → 7/13/8 pickups and a **25-token race** against a 21-token top ask.
  That is D39/D51's failure returning.

The ~4 row-passes a race that the top ask leaves can be spent as three rows once or two rows
twice; no arrangement reaches all three laps. **Closing it needs an income lever that does not
exist yet** — the obvious one is a respawned row that pays a sparkle and no token, i.e.
decoupling the pickup moment from the currency. That is a new mechanic, so it was not built in
the final wave. The full table is in `tests/economy.test.mjs` so nobody re-litigates it blind.

### `quizboxtest`'s 22-question floor has one question of headroom, and BEACON PLACEMENT sets it
`tools/quizboxtest.mjs` asserts at least 22 questions asked per seed. The shipped layout
measures **23** on its worst seed; HEAD measured exactly **22**; Wave 6 round 1's beacon
re-spacing measured **21** and went red. Beacon positions set the whole lap's question cadence,
so *any* placement change can tip it — as can `tools/modaltest.mjs`'s 6-second floor between
two in-race teaching cards, which round 1 took from 10.0 s to 5.08 s by moving beacons and
nothing else. **Neither gate is a quiz-code gate, and neither is run by someone who thinks they
are only moving geometry.** A warning to that effect sits above `BEACON_KEEPOUT_M` in
`src/race/quiz.js`. Re-run both after touching `planBeacons`.

### Race 2's "cruising alone" is invisible to every instrument we have
Wave 6 built pack-feel metrics to chase the playtest verdict, corrected them (15-second settle
skip; passes counted only within 1.0 s of a rival), and on five disjoint 40-seed sets race 2 is
**at or inside the exemplar race 3** on % of race led, nearest-rival distance, mean and median
gap, visible passes, and distance to the winner. It trails on exactly one axis — *rival ahead
within 1.5 s*, 91.1% against 96.8%. Compressing `SLOT_FWD_R2` further (0.55 / 0.50 / 0.40, all
measured) buys 2–4 points of that by pulling the winner from 2.06 s to 1.71 s, i.e. it spends
the "race 2 is still a race to win" guard on a difference no child perceives, and was rejected.
**If race 2 still reads as cruising alone at the next playtest, the cause is not a band or a
pace constant.** It is something these six numbers do not measure — camera, on-screen field
spacing, audio, or how distinguishable the karts around the player are — and it needs a
different kind of observation rather than another tuning round.

### Tyres and frame buy nothing on the finale, and that is a `kartphysics` fact
Autopilot lap time on `cloud`, one kart, no traffic, tier 0 → 3: **engine 48.07 → 45.50 s,
turbo 48.07 → 46.33 s, frame 48.07 → 47.98 s (flat), tyres 48.07 → 48.84 s (SLOWER).** Present
at every AI tier and on Wave 5.1 too, so it is a `kartphysics` / `autopilotInput` interaction
rather than an AI one — extra grip appears not to be exploitable by a controller whose speed
target is not built from it. A child who spends both garage visits on tyres and frame therefore
buys nothing for race 3. Wave 6 works around it (the finale's field scales on engine and turbo
only, so such a purchase at least does not COST a place, and `tests/ai.test.mjs` bounds the
residual at 0.65 places) but the underlying flatness is unfixed and lives in `kartphysics.js`.
It also means the garage's four slots are not four equal choices, which the garage's copy
implies they are.

### The `tokens-200` badge clears by two tokens
`TOKEN_STEPS.high` is 80 and the modelled plausible child banks **82** by the end of the second
championship. It was calibrated to land right AT the two-championship mark, so it has no
headroom by design and any income change in either direction moves it: Wave 6's pickup retune
alone took it to 75 (red), and re-measuring the stale question cadence in the same sum put it
back to 82. If it goes red again, re-measure **both** terms on the built game before touching
either constant, and do not touch `TOKEN_STEPS` — the badge board is player-approved, so the
economy has to carry the rung.

### The wallet at the second garage now measures 22–24 against a 21-token top ask
Wave 4 logged 22; it has drifted. Pickups went DOWN this wave, so the driver is the rebate plus
a strong race-2 payout carrying over, not the pickup change. The garage's lesson survives —
a child cannot buy everything in one visit — but the carry means visit 2 can afford the most
expensive single ask. D17's standing objection to capping the garage's view of the wallet still
holds (it makes the HUD counter, the results screen and the garage budget contradict each other
in front of a child). Watch in playtest; if it bites, cut the rebate before the race payout.

### A pass on the last corner still never toasts
`race:position` is suppressed once `S.finished` is set. HEAD had the same guard, so Wave 6's
0.6 s hysteresis hold only widens the window from 0 s to 0.6 s — but the most exciting pass in
a kids' racer is the one on the line. Announcing a change after the flag risks contradicting the
results screen, so it is deliberately left.

### Four position toasts in the first five seconds of a race
On oasis seed 3 a child is told about four real, held, decisive position changes at 1.78 /
3.25 / 4.05 / 4.78 s — the field genuinely sorting itself out of the grid. Each is true, and
since Wave 6 each replaces the last rather than stacking, so the HUD never contradicts itself.
But four notes in five seconds is a lot of text at the moment a child is learning the controls.
The lever is a settling window after the lights (suppress until ~6 s), which is a pacing
decision rather than a HUD bug. Watch in playtest.

### No harness screenshots a DRIVEN moment
`tools/shot.mjs` renders deterministically but never applies input, so the kart sits on the grid
— every `shot.mjs` race frame in this repo is a stationary kart at speed 0. That is why the
"do three token rows read as spread through the lap" question could not be answered from the
existing tools; the Wave-6 critic had to write its own autopilot driver and call
`__DEBUG.renderOnce()` per mark. An `--autopilot` flag on `shot.mjs` would let a future visual
critic judge anything that only exists mid-lap. Not built in the final wave.

### The shared-tree restore trap fired twice more, on the same line
D45 documented a `.tmp/` backup restored by an EXIT trap silently reverting a later edit. In
Wave 6 the same trap destroyed the same one-line change in `src/race/race.js` **twice**, by two
different agents, hours apart — and nothing went red either time, because the feature that line
enables is exercised by a test that constructs its own subject (D63). It is now gated in
`tools/flowtest.mjs`. The general form is worth carrying into any future wave: **do not
snapshot whole files you are not editing**, and if a gate must run against pre-change code,
build a mutant into `.tmp/` and point the gate's `--html`/`--dist` flag at it rather than
mutating the shared tree at all.

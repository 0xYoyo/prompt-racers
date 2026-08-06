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
- Tracks 2 (עיר המעגלים) and 3 (פסגת הענן) meshing and dressing. Their spline layouts,
  themes and lighting rigs already exist and are validated; only geometry + scenery remain.
- Item/pickup variety beyond tokens.
- Expert-mode free-text scoring refinement and its larger token rewards.
- Juice pass: richer particles, screen-shake tuning, crowd animation.
- Performance pass on the `low` tier against real mid-range hardware.
- Final cross-game smoothing of difficulty curve and copy tone.

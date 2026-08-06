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
friendly robot. Tracks: **נווה הנתונים** (desert oasis), **עיר המעגלים** (neon night city),
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

## D15 — Token economy thinned at the source, and the garage rebate capped below the spend
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

## D16 — Modal traffic control lives in `ui/style.js`
Three things can interrupt a race (token explainer, Boreg's intro, quiz panels) plus the
pause overlay. Nothing coordinated them, and three real failures resulted — a token popup
opening over a live quiz whose timer kept running, digit keys answering a hidden quiz
through the pause menu, and pause-resume restarting the race underneath a modal the child
was still reading. The registry lives in `style.js` because it is the only module every
subsystem already imports; anywhere else would have created an import cycle. Pinned by
`tools/modaltest.mjs`.

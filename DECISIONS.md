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

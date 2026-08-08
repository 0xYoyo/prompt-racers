# מרוץ הפרומפטים — project instructions

Hebrew-first 3D kart racer teaching kids (8–15) AI and prompting. Contest entry.
Read DECISIONS.md, GAPS.md, README.md and skim progress.html before touching anything.

## WORKING METHOD (this is how Waves 1–3 were built; follow it exactly)

- You are the lead agent. Decompose the work into the smallest pieces that can be
  built and judged independently. Use the existing per-module preview harness
  (tools/preview.mjs) — it exists precisely for this.
- For each significant piece, fan out a builder subagent and a SEPARATE critic
  subagent with fresh context. The critic never sees the builder's reasoning: it
  inspects real rendered output (screenshots via the harness) and real behavior
  (tools/flowtest.mjs, tools/modaltest.mjs) against the spec and the reference/
  folder, names the single biggest remaining gap, and sends it back. Max 5 rounds
  per piece, then move on and log the remainder in GAPS.md.
- Every bug fix ships with a gate: extend flowtest/modaltest/unit tests so the
  bug class cannot silently return. This project's entire history says the
  dangerous bugs are silent seams between modules — gates on built output are
  the only thing that has ever caught them.
- Maintain progress.html as you go. Log judgment calls in DECISIONS.md. Do not
  ask the user questions mid-wave. One smoothing agent at the end for
  copy/difficulty/art consistency, then STOP for the user's playtest.

## GIT SAFETY — absolute, for every agent including critics

Wave 3 lost several hours of work to this: an agent ran `git stash` (plus a
reset) to compare against HEAD while five builders were live. The tree snapped
back to HEAD, the stash entry was then dropped by a racing process, and the work
survived only as a dangling commit found via `git fsck --unreachable`.

- NEVER run `git stash`, `git reset`, `git checkout -- .`, `git restore`,
  `git clean`, or anything else that discards or rewinds the working tree.
  Multiple agents share this one tree; a rewind destroys other agents' work.
- To compare against committed code, READ it without touching the tree:
  `git show HEAD:src/foo.js > .tmp/old-foo.js`, then diff or reason about the
  copy. Never move it into place.
- If a gate genuinely must run against pre-fix code, copy the current file to
  `.tmp/` first, and restore from that copy — never from git.
- The lead commits to a branch periodically so an accident is recoverable.
  If you believe the tree is in a bad state, STOP and report it; do not repair
  it with git.

## Constraints — absolute, contest-disqualifying if violated

Zero network, zero personal data, all-original content, single self-contained
dist/index.html, Hebrew-first RTL with English toggle, 60fps mid-range with
quality toggle.

## Build & gates

```bash
npm run build        # → dist/index.html (add -- --dev for readable output)
npm run gate         # build + tests + compliance + playability — run before shipping
npm test             # unit tests
npm run verify       # compliance: zero network, no assets, no personal data
npm run flow         # end-to-end synthetic-input drive of the real build
npm run layout       # every screen at 6 resolutions; fails on clipped controls
npm run progress     # regenerate progress.html
node tools/preview.mjs --mod src/<mod>.js --fn preview --out shots/x.png
node tools/shot.mjs --scene race --track 0 --t 25 --out shots/race.png
node tools/modaltest.mjs # modal-registry policy checks
```

## Code rules

- No `Math.random` — seeded `makeRng(seed)` only (screenshots and AI must be
  reproducible).
- Subsystems talk over `core/bus.js`, never by importing each other; cross-module
  wiring (e.g. the kart-preview mounter) lives in scenes.js, which is LEAD-OWNED.
- Every module exports a `preview()` scene so it renders/judges in isolation.
- All UI from `ui/style.js` tokens + CSS logical properties (RTL mirrors free).
- The modal registry (pushModal/popModal in ui/style.js) coordinates anything
  that can own the screen mid-race — see D15–D18.
- HUD/menus are DOM overlay, not canvas (D4). Fixed 1/60 timestep (D5, D11).
- Held keys must survive pauses/modals (D12) — gate on it.

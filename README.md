# מרוץ הפרומפטים · Prompt Racers

A 3D kart racing game for Israeli kids aged 8–15 that teaches prompt engineering
through play. Hebrew-first with full RTL, English toggle. Runs entirely in the
browser from a single self-contained file.

## Run it

Open `dist/index.html`. That is the whole game — one file, no server, no install,
no network. Double-clicking it works.

## Build

```bash
npm install
npm run build        # → dist/index.html   (minified, self-contained)
npm run build -- --dev
```

## Quality gates

```bash
npm run gate         # build + tests + compliance + playability. Run before shipping.

npm test             # spline maths, garage→physics wiring, driving-feel telemetry,
                     # and a clean-bundle check across every module
npm run verify       # contest compliance: zero network, no assets, no personal data
npm run flow         # drives the real build end to end with synthetic input
npm run layout       # every screen at 6 resolutions; fails on clipped controls
npm run progress     # regenerate progress.html
```

Per-module visual iteration — any subsystem renders and screenshots on its own:

```bash
node tools/preview.mjs --mod src/track/trackbuild.js --fn preview --t 2 --out shots/x.png
node tools/shot.mjs --scene race --track 0 --t 25 --out shots/race.png
```

## Contest constraints, and how each is enforced

| Constraint | Enforcement |
|---|---|
| Zero network calls at runtime | Three.js is vendored and inlined; `verify` intercepts every request and fails on any that escapes |
| No personal data | One namespaced `localStorage` key, no name entry, no login, no cookies — asserted in `verify` |
| 100% original art/names/music | Everything generated in code; `verify` also sweeps for IP keywords |
| Everything procedural | No asset files anywhere; `verify` fails on any image/audio/model/font in `src/`, and on large base64 blobs |
| 60fps on a mid-range laptop | Three quality tiers; all prop/particle/texture budgets read `engine.q.*` |
| Hebrew RTL by default | Asserted in `verify`; `layout` checks every screen at 6 resolutions including 1366×768 |

## Porting into React

The game loop is fully decoupled from the DOM shell. `boot(mountEl)` is the only
touchpoint and it returns a teardown:

```jsx
import { boot } from './src/main.js';

function PromptRacers() {
  const ref = useRef(null);
  useEffect(() => {
    const game = boot(ref.current);
    return () => game.destroy();
  }, []);
  return <div ref={ref} style={{ position: 'relative', inset: 0 }} />;
}
```

`window.__DEBUG` exists only for the automated screenshot harness — no game code
reads it, so it can be stripped.

## Architecture

```
src/
  core/     engine (renderer, quality tiers, fixed 1/60 loop), bus, seeded rng,
            save, input, capture harness
  gfx/      procedural textures, sky/lighting/atmosphere per theme, scenery props
  track/    trackdef (spline maths + 3 layouts — shared by meshing, AI, minimap),
            trackbuild (road, kerbs, barriers, dressing)
  kart/     kartphysics (arcade sim + drift/mini-boost), camera, kartmodel,
            roster, ai (7 opponents through the same physics)
  race/     race (orchestration + state machine), hud, minimap
  garage/   prompts, scoring, tips, garage — the educational core
  audio/    fully synthesised engine, SFX and music
  scenes.js main.js                     ← flow + DOM shell
```

Rules that keep it coherent: no `Math.random` (seeded rng only, so screenshots and
AI are reproducible); subsystems talk over the `bus`, never by importing each
other; every module exports a `preview()` scene so it can be rendered and judged
in isolation; all UI is built from the `ui/style.js` tokens with CSS logical
properties so RTL mirrors for free.

## Where things stand

- `progress.html` — live status board with screenshots over time
- `DECISIONS.md` — calls made and why
- `GAPS.md` — known remaining gaps and accepted tradeoffs
- `docs/CONTRACT.md` — the spec every contributor builds against

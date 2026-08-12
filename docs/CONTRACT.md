# CONTRACT — read this fully before writing any code

Project: **מרוץ הפרומפטים** (Prompt Racers) — a 3D kart racing game for Israeli kids
aged 8–15 that teaches prompt engineering through play. Hebrew-first, RTL, English toggle.

You are one of several agents working **in parallel** on this repo. Stay strictly inside
the files you were assigned. Never edit `src/scenes.js`, `src/main.js`, `src/core/*`, or
`src/ui/style.js` unless your brief explicitly says so — the lead agent owns those.

---

## 1. Hard constraints (violating any of these disqualifies the project)

1. **Zero network calls at runtime.** No CDN, no fonts, no analytics, no `fetch`, no
   `new Image().src = http…`. Three.js is vendored and bundled. The screenshot harness
   fails the build if any request escapes.
2. **No personal data.** No name entry, no login, no telemetry. Progress lives in
   `localStorage` via `src/core/save.js` only.
3. **100% original art, names, music.** Nothing that resembles Mario Kart or any other
   existing IP — not characters, not item designs, not track dress, not sound motifs.
   Do not name-check any real brand, franchise, or person.
4. **Everything procedural, in code.** Every texture, mesh, animation and sound is
   generated at runtime. No image files, no audio files, no model files, no base64 blobs.
   Textures are drawn with `CanvasRenderingContext2D` or generated as data arrays.
5. **60fps on a mid-range school laptop.** Read `engine.q.*` for budgets; never hardcode
   counts. The `low` tier must be genuinely cheap.
6. **Hebrew by default, correct RTL.** English is a toggle, not the source language.

---

## 2. Architecture

```
src/
  core/    engine.js bus.js rng.js save.js harness.js     ← LEAD-OWNED, do not edit
  ui/      style.js (LEAD-OWNED)  i18n.js (mechanism; register your own strings)
  gfx/     textures.js sky.js props.js particles.js
  track/   trackdef.js trackbuild.js
  kart/    kartmodel.js kartphysics.js ai.js roster.js
  race/    race.js hud.js minimap.js
  garage/  garage.js prompts.js scoring.js tips.js
  audio/   audio.js
  scenes.js  main.js                                       ← LEAD-OWNED
```

### Scene contract
Any scene is a factory `(engine, opts) => sceneObject`:

```js
{
  scene,            // THREE.Scene
  camera,           // THREE.Camera
  update(dt),       // dt is ALWAYS 1/60 — fixed timestep
  render?(),        // optional; default is renderer.render(scene, camera)
  resize?(w, h),
  enter?(), exit?(),
  dispose(),        // MUST free geometries, materials, textures and remove DOM
}
```

### Rules every module follows
- **Determinism.** Never call `Math.random()`. Use `makeRng(seed)` from `core/rng.js`.
  Screenshots must be reproducible frame-for-frame.
- **Quality tiers.** Scale prop counts, particle counts and texture sizes by
  `engine.q.propDensity / crowdDensity / particles / texSize / drawDistance`.
- **Events.** Cross-subsystem communication goes through `bus` (`core/bus.js`), never
  direct imports of another subsystem's internals.
- **Strings.** Call `registerStrings({he:{…}, en:{…}})` from your own module with your
  own key prefix (e.g. `hud.lap`, `garage.slot.part`). Never edit another module's keys.
- **DOM UI.** Build with `h()` from `ui/style.js` and the existing token classes
  (`.panel`, `.display`, `.btn`, `.label`, `.num`, `.hud-tl` …). Use CSS **logical**
  properties (`inset-inline-start`, `margin-inline-end`) so RTL flips for free.
  Wrap every numeral in `num()` or `.num` or RTL will reorder it.
- **Dispose properly.** Leaking GPU memory across 3 races is a real failure mode.

---

## 3. Art bible — the quality bar

`reference/*.png` are screenshots of a competing browser kart game. We must **match or
beat** them. What makes them read as expensive — replicate the *technique*, never the
*content*:

- **Golden-hour key light.** Low warm sun (~15–25° elevation), long soft shadows, strong
  warm/cool split: warm key `#ffd9a0`-ish, cool sky fill `#5a6b9a`-ish.
- **Layered depth.** Near detail → mid barriers/vegetation → far silhouettes → sky.
  Distance is desaturated and lifted toward the sky colour via fog. This single trick is
  most of the perceived production value. Use `FogExp2` or linear fog tuned per track.
- **Sky is a gradient with structure**, not a flat colour: multi-stop vertical gradient,
  soft banded clouds, a bloom-y sun disc, subtle horizon haze.
- **Surface texture everywhere.** Asphalt has visible speckle/aggregate grain and subtle
  patch variation. Nothing is a flat untextured colour. Generate with canvas noise.
- **Track furniture reads instantly:** white edge lines, red/white striped curbs on
  corners, low stone/concrete barriers, catch fencing, banners, bunting, sponsor-style
  boards (with *our own* invented in-world brands, in Hebrew).
- **Crowds are cheap and effective:** hundreds of tiny stylised capsule figures in varied
  bright colours, instanced, with a gentle idle bob. Never model faces.
- **Chunky, confident HUD:** dark rounded panels, soft drop shadows, gold accents,
  tabular numerals, high contrast. See `ui/style.js` tokens.
- **Silhouette charm on karts:** exaggerated fat rear tyres, small front tyres, visible
  driver with a helmet, rounded friendly forms. Charm beats polygon count.

### Our art direction (locked — do not redesign)
Warm golden arcade. Gold `#ffc247` is the single UI accent. Rounded, friendly, readable.
Original world: the game is set inside a playful "AI machine world" with an Israeli
landscape flavour.

**Tracks** (escalating):
1. `oasis` — **נווה הנתונים** (Data Oasis). Desert canyon at golden hour: red/ochre
   sandstone cliffs, palm clusters, turquoise spring pools, sand dunes, striped fabric
   shade canopies over the crowd. Warm, inviting, easy layout.
2. `circuit` — **עיר הנוירונים** (Circuit City). Night neon tech-city, rain-slick
   reflective asphalt, holographic Hebrew billboards, cool blue/magenta. Medium.
3. `cloud` — **פסגת הענן** (Cloud Peak). Dawn above the clouds, floating stone-and-light
   islands, waterfalls of light, long jumps. Hard.

**Characters** (locked): the player is **ניצוץ** (Nitzotz, "Spark"). The garage mechanic
NPC is **בורג** (Boreg, "Bolt") — a friendly, slightly goofy robot. Both original designs:
rounded helper-robot creatures, no human/plumber/animal-mascot resemblance to any IP.

---

## 4. Tooling

```bash
npm run build                  # → dist/index.html (self-contained, minified)
npm run build -- --dev         # unminified, for debugging

# Screenshot ONE module in isolation (this is how you check your own work):
node tools/preview.mjs --mod src/gfx/sky.js --fn preview --t 2 --out shots/sky.png
  # optional: --w 1600 --h 900 --lang he|en --quality low|medium|high

# Screenshot the integrated game (only once your scene is registered by the lead):
node tools/shot.mjs --scene race --track 0 --t 12 --out shots/race.png
```

**Every module you build must export a `preview(engine)` scene factory** that shows the
module off in a good light — a representative camera angle, decent lighting, and any
variants side by side. Critics screenshot this. If there is no preview, your work cannot
be judged and will be sent back.

Screenshots go in `shots/`. Use a `shots/<subsystem>-<round>.png` naming scheme.

Verify your own output before reporting done: run the preview, **look at the PNG with the
Read tool**, and iterate until it clears the art bible above. Reporting "done" on
something you have not visually inspected is the single worst failure mode here.

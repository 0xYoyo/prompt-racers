// ─────────────────────────────────────────────────────────────────────────────
// KART GROUND-SHADOW GATE (Wave 5.1)
//
// Wave 5.1 made נמוך a tier children actually get: auto-detect now tops out at
// בינוני and can land on נמוך. At נמוך the renderer casts no shadows at all
// (TIERS.low.shadows === false) — and a rival kart casts none at ANY tier,
// because createKartLOD builds it with shadows off. On the two daylight tracks
// those karts read as pasted onto the road, so every kart that casts no real
// shadow now carries a fake one: a single alpha-mapped plane lying on the road.
//
// The bugs this file exists to stop, all of which this project has already had:
//
//   1. THE SHADOW BELOW THE PERCEPTUAL FLOOR — the bug that actually happened,
//      and NOT the one round 1 of this fix wrote down. The retired card was a
//      canvas createRadialGradient + CanvasTexture, and round 1 recorded it as
//      uploading fully transparent under ANGLE/SwiftShader, never drawing a
//      pixel. Measured on the real build, that is false: toggling the old card's
//      `visible` and diffing framebuffers moves 20,715 px (1.44% of frame) on
//      oasis at נמוך, 26,911 px on cloud. It drew every frame since Wave 1. It
//      was just far too faint — peak alpha 0.55 x opacity 0.85 = 0.47 of black
//      over near-black asphalt, ~2.5/channel mean. An authoring bug.
//      So: this file does NOT ban canvas gradients (they render fine — see
//      gfx/props.js glowTexture()). It asserts the thing that would have caught
//      it: a RENDERED-FRAME A/B on the built dist. Structural checks cannot see
//      this class of bug — the old card passed every one of them.
//      Corollary, learned the hard way: forcing the card opaque is not a valid
//      visibility probe unless you also clear renderOrder:-1 and
//      depthWrite:false, or it draws before the road and the road covers it.
//   2. TWO SHADOWS. The fake one must not be built for a kart that also casts a
//      real one — the old card was built unconditionally at every tier.
//   3. A SHADOW THAT LEANS. It hangs off the root group, never off bodyPivot:
//      bodyPivot rolls into corners and a card under it would tip onto its edge.
//   4. A HARD BLACK DISC, or a card sunk into the road (z-fighting), or one
//      floating so high it reads as a beer mat.
//   5. A CARD THE WELD SWALLOWED. weldFrame bakes world transforms into
//      vertices; a welded card joins the chassis frame and starts leaning.
//   6. PER-KART TEXTURES / PER-FRAME ALLOCATION. Eight karts, one texture.
//
//   node tests/kartshadow.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { TIERS } from '../src/core/engine.js';

// Enough of a 2D canvas for the number-plate texture to rasterise headlessly.
if (typeof document === 'undefined') {
  const imgData = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const ctx2d = () => ({
    createImageData: imgData, getImageData: (x, y, w, h) => imgData(w, h), putImageData() {},
    fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    moveTo() {}, lineTo() {}, closePath() {}, drawImage() {}, fillText() {},
    arcTo() {}, strokeText() {}, strokeRect() {}, rect() {},
    measureText: () => ({ width: 8 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  });
  globalThis.document = {
    createElement(tag) {
      const el = { tagName: String(tag).toUpperCase(), style: {}, width: 0, height: 0,
        appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {} };
      if (tag === 'canvas') el.getContext = ctx2d;
      return el;
    },
    addEventListener() {}, removeEventListener() {}, hidden: false,
  };
}

const KM = await import('../src/kart/kartmodel.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(root, 'src/kart/kartmodel.js'), 'utf8');

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(64)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};

const eng = t => ({ q: TIERS[t] });
const P2 = { engine: 2, tires: 2, wing: 2, chassis: 2, exhaust: 2 };

// A ground-shadow CARD, found structurally rather than by name, so the gate sees
// the retired unconditional plane exactly as it sees the new blob: a flat
// four-vertex quad hanging off the kart's ROOT group, facing up.
const N = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), NM = new THREE.Matrix3();
function cards(kart) {
  kart.group.updateMatrixWorld(true);
  const out = [];
  kart.group.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const p = o.geometry?.attributes?.position;
    if (!p || p.count !== 4) return;
    const na = o.geometry.attributes.normal;
    if (!na) return;
    NM.getNormalMatrix(o.matrixWorld);
    N.fromBufferAttribute(na, 0).applyMatrix3(NM).normalize();
    if (Math.abs(N.dot(UP)) < 0.9) return;          // number plates are vertical
    out.push(o);
  });
  return out;
}
const upness = card => {
  card.updateMatrixWorld(true);
  NM.getNormalMatrix(card.matrixWorld);
  return N.fromBufferAttribute(card.geometry.attributes.normal, 0).applyMatrix3(NM).normalize().dot(UP);
};

console.log('\n  \x1b[1mfake contact shadow — when it exists\x1b[0m');

ok('the tier table still says נמוך casts no shadows (the premise)', TIERS.low.shadows === false);

const low = KM.createKart({ racer: undefined, engine: eng('low'), parts: P2 });
const med = KM.createKart({ racer: undefined, engine: eng('medium'), parts: P2 });
const high = KM.createKart({ racer: undefined, engine: eng('high'), parts: P2 });
const lowCards = cards(low);

ok('a kart at a shadows:false tier has a ground-shadow card', lowCards.length >= 1,
  `${lowCards.length} cards`);
ok('…exactly one of them (one mesh, one draw call)', lowCards.length === 1,
  `${lowCards.length} cards`);
// The bug the whole fix started from: the card used to be built at EVERY tier,
// so at גבוה a kart would carry a blob AND its shadow-map shadow.
ok('a kart at בינוני has NO card (no double shadow)', cards(med).length === 0,
  `${cards(med).length} cards`);
ok('a kart at גבוה has NO card (no double shadow)', cards(high).length === 0,
  `${cards(high).length} cards`);
ok('a rival built by createKartLOD always has one (it never casts a real shadow)',
  cards(KM.createKartLOD({ engine: eng('high'), lod: 1, parts: P2 })).length === 1);

console.log('\n  \x1b[1m…and what it looks like\x1b[0m');

const card = lowCards[0];
const tex = card.material.map;
const data = tex?.image?.data;
// Readable texel data is required so the shape assertions below can run at all —
// and because one DataTexture is shared by eight karts and rasterises identically
// on every machine (screenshots stay byte-stable). It is NOT a claim that a
// canvas gradient would fail to render: it renders fine. The gate that catches
// "present but invisible" is the rendered A/B at the bottom of this file.
ok('the falloff is readable texel data (shared, deterministic)',
  !!data && data.length >= 4 * 32 * 32, data ? `${data.length / 4} texels` : 'no .image.data');
ok('no Math.random anywhere in the module', !/Math\.random\s*\(/.test(src));

// NOT behind `if (data)`: assertions that silently vanish are not a gate. If the
// texture stops being readable texel data the assertion above fails AND these
// fail loudly rather than disappearing from the count.
{
  const S = tex?.image?.width || 0;
  const px = data || new Uint8Array(0);      // no data => every assertion below fails, none skips
  const alpha = (i, j) => px[(j * S + i) * 4 + 3] || 0;
  let maxA = 0, rimMax = 0, opaqueRgb = 0;
  const distinct = new Set();
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const a = alpha(i, j);
    maxA = Math.max(maxA, a);
    distinct.add(a);
    const o = (j * S + i) * 4;
    if (px[o] > 8 || px[o + 1] > 8 || px[o + 2] > 8) opaqueRgb++;
    if (i === 0 || j === 0 || i === S - 1 || j === S - 1) rimMax = Math.max(rimMax, a);
  }
  // biggest jump between neighbouring texels — a hard disc steps 255 in one texel
  let step = 0;
  for (let j = 0; j < S; j++) for (let i = 1; i < S; i++) step = Math.max(step, Math.abs(alpha(i, j) - alpha(i - 1, j)));
  for (let i = 0; i < S; i++) for (let j = 1; j < S; j++) step = Math.max(step, Math.abs(alpha(i, j) - alpha(i, j - 1)));

  ok('the shadow is actually dark somewhere', maxA >= 200, `peak alpha ${maxA}`);
  ok('it fades to nothing at the rim (no visible card edge)', rimMax === 0, `rim alpha ${rimMax}`);
  ok('the falloff is soft, not a hard disc', distinct.size >= 24 && step <= 64,
    `${distinct.size} alpha levels, max step ${step}`);
  // `!!data` is load-bearing: with no texel data the loop above never runs and
  // opaqueRgb === 0 would pass vacuously — the exact silent-skip this block fixes.
  ok('the shadow is black (it darkens the road, never tints it)', !!data && opaqueRgb === 0);
  ok('it is filtered, not a 64-px staircase',
    tex?.minFilter === THREE.LinearFilter && tex?.magFilter === THREE.LinearFilter);
}

// Eight karts on track: one texture between them. (The MATERIAL is per-kart on
// purpose — perf.test.mjs requires dispose() to free every material the kart
// draws with, which a process-wide shared material could never satisfy.)
const second = cards(KM.createKart({ engine: eng('low'), parts: P2 }))[0];
ok('every kart shares ONE shadow texture', !!second && card.material.map === second.material.map);
ok('…but owns its own material (per-kart fade, and dispose() can free it)',
  !!second && card.material !== second.material);

console.log('\n  \x1b[1m…and where it sits\x1b[0m');

// Just above the road: sunk in it z-fights, floating reads as a beer mat.
const y0 = card.getWorldPosition(new THREE.Vector3()).y;
ok('the card sits above the road, not in it', y0 > 0, `y = ${y0.toFixed(4)}`);
ok('…and close enough to it to read as contact', y0 <= 0.06, `y = ${y0.toFixed(4)}`);
ok('it does not fight the road for depth (depthWrite off)', card.material.depthWrite === false);
ok('it casts and receives nothing', card.castShadow === false && card.receiveShadow === false);

// THE lean test. Drive it into a hard drifting corner: the body must really roll
// (guard, or the assertion below is vacuous) and the card must stay flat.
const flat0 = upness(card);
for (let i = 0; i < 90; i++) {
  low.update(1 / 60, { steer: 1, speed01: 1, drifting: true, driftCharge01: 1, driftDir: 1, airborne: false, boosting: true });
}
low.group.updateMatrixWorld(true);
const rolled = Math.abs(low.bodyPivot.rotation.z) + Math.abs(low.bodyPivot.rotation.x);
ok('(guard) the kart really is leaning', rolled > 0.05, `|roll|+|pitch| = ${rolled.toFixed(3)}`);
ok('the shadow stays flat on the ground while the kart leans',
  upness(card) > 0.999 && flat0 > 0.999, `up·n = ${upness(card).toFixed(5)}`);
ok('…and stays at the same height above the road',
  Math.abs(card.getWorldPosition(new THREE.Vector3()).y - y0) < 1e-6);

// It follows the kart's position and heading, because it is a child of the root
// group — which race.js drives with the body's position and renderQuaternion.
low.group.position.set(12, 3, -7);
low.group.rotation.y = 1.1;
low.group.updateMatrixWorld(true);
const wp = card.getWorldPosition(new THREE.Vector3());
ok('it follows the kart across the track',
  Math.abs(wp.x - 12) < 1e-6 && Math.abs(wp.z + 7) < 1e-6 && Math.abs(wp.y - (3 + y0)) < 1e-6,
  `(${wp.x.toFixed(2)}, ${wp.y.toFixed(2)}, ${wp.z.toFixed(2)})`);
low.group.position.set(0, 0, 0); low.group.rotation.y = 0; low.group.updateMatrixWorld(true);

console.log('\n  \x1b[1m…airborne, and per-frame cost\x1b[0m');

const ground = { steer: 0, speed01: 0.8, drifting: false, driftCharge01: 0, airborne: false, boosting: false };
const air = Object.assign({}, ground, { airborne: true });
for (let i = 0; i < 60; i++) low.update(1 / 60, ground);
const opGround = card.material.opacity, scGround = card.scale.x;
for (let i = 0; i < 60; i++) low.update(1 / 60, air);
ok('the shadow fades when the kart leaves the ground', card.material.opacity < opGround * 0.5,
  `${opGround.toFixed(2)} → ${card.material.opacity.toFixed(2)}`);
ok('…and shrinks (a shadow that only fades reads as the light going out)',
  card.scale.x < scGround - 0.05, `${scGround.toFixed(2)} → ${card.scale.x.toFixed(2)}`);
for (let i = 0; i < 60; i++) low.update(1 / 60, ground);
ok('…and comes back when it lands', Math.abs(card.material.opacity - opGround) < 0.02);

const gid = card.geometry, mid = card.material, tid = card.material.map;
for (let i = 0; i < 240; i++) low.update(1 / 60, ground);
ok('update() allocates no geometry, material or texture per frame',
  card.geometry === gid && card.material === mid && card.material.map === tid);

console.log('\n  \x1b[1m…and the weld cannot swallow it\x1b[0m');

// A welded card would be baked into the chassis bucket: it would lose its
// identity as a root child, gain the name 'weld', and start leaning with the body.
const ai = KM.createKartLOD({ engine: eng('low'), lod: 1, parts: P2 });
const aiCards = cards(ai);
ok('the welded rival still has exactly one card', aiCards.length === 1, `${aiCards.length}`);
if (aiCards.length === 1) {
  const c = aiCards[0];
  ok('…it survived as itself, not as part of a weld', c.name !== 'weld' && c.parent === ai.group);
  ok('…it is still a 4-vertex quad', c.geometry.attributes.position.count === 4);
  for (let i = 0; i < 90; i++) {
    ai.update(1 / 60, { steer: -1, speed01: 1, drifting: true, driftCharge01: 1, driftDir: -1, airborne: false, boosting: false });
  }
  ai.group.updateMatrixWorld(true);
  ok('…and it is still flat while the welded body leans', upness(c) > 0.999,
    `up·n = ${upness(c).toFixed(5)}`);
  // setParts rebuilds the welded half from scratch — the card must not be
  // rebuilt, re-parented or duplicated by that path.
  ai.setParts({ wing: 3, exhaust: 0 });
  ok('…and setParts on a welded kart neither duplicates nor drops it',
    cards(ai).length === 1 && cards(ai)[0] === c);
}

// dispose() has to free the per-kart material (perf.test.mjs pins the same rule
// for the welded rival's materials); the shared texture outlives every kart.
const dk = KM.createKartLOD({ engine: eng('low'), lod: 1, parts: P2 });
const dcard = cards(dk)[0];
let freed = false;
const orig = dcard.material.dispose.bind(dcard.material);
dcard.material.dispose = () => { freed = true; orig(); };
dk.dispose();
ok('dispose() frees the card material (it is kart-owned, not shared)', freed);

/* ───────────────────────────────────────────────────────────────────────────
   THE RAKE (round 3).

   Round 2's blob darkened its own footprint by ~31% of the road's brightness on
   BOTH daylight tracks — and cloud read solved while oasis did not. So depth was
   never the difference: AREA AND SHAPE was. Oasis' key light sits at 15° of
   elevation and rakes a real cast shadow into a long offset smear covering 2.5x
   the blob's pixels, while the blob was a symmetric rectangle centred under the
   kart, where the bodywork hides most of it from the chase camera.

   So the card is now sheared and slid along the sun's ground projection, at
   UNCHANGED alpha. The bugs that buys, and which this section exists to stop:

   a. THE RAKE THAT IGNORES THE SUN — one hardcoded direction or length for all
      three themes. The night circuit is lit by a moon at 38°; oasis by a sun at
      15°. A low light must smear much further than a high one, or the cue lies.
   b. THE RAKE BAKED IN KART SPACE — the seam that would look right in exactly
      one screenshot. The direction is fixed in WORLD space while the card's
      parent yaws with the kart, so it has to be re-expressed every frame. Get
      that wrong and the shadow spins with the kart through every corner.
   c. THE RAKE THAT LEAKS INTO THE MENUS. No sunDir => the old symmetric blob,
      byte for byte, so the garage, racer select, the podium and every preview
      are untouched.
   d. A HAND-BUILT MATRIX THAT LOSES FLATNESS. The shear cannot be expressed as
      position/quaternion/scale, so the card composes its own local matrix — and
      a mistake there tips it onto its edge, which is failure mode 3 all over
      again. Re-run the lean test with a rake in force.
   e. THE WIRING NEVER MADE. kartmodel is a leaf and must not import gfx/sky.js,
      so race.js — which owns both the lighting rig and the karts — passes
      rig.sunDir in. If that call site loses the option, every CPU assertion here
      still passes and the game silently goes back to symmetric blobs.
   ─────────────────────────────────────────────────────────────────────────── */

console.log('\n  \x1b[1m…and the rake follows the sun\x1b[0m');

const DEG = Math.PI / 180;
// Same construction as gfx/sky.js sunDirection(); the themes' real numbers.
const sunAt = (elev, az) => new THREE.Vector3(
  Math.sin(az * DEG) * Math.cos(elev * DEG), Math.sin(elev * DEG), Math.cos(az * DEG) * Math.cos(elev * DEG));
const OASIS_SUN = sunAt(15, 215);   // low desert sun  → long smear
const NIGHT_SUN = sunAt(38, 42);    // high circuit moon → nearly symmetric

const rLow = KM.blobRake(OASIS_SUN), rHigh = KM.blobRake(NIGHT_SUN);
ok('a low sun rakes further than a high one', rLow.len > rHigh.len && rHigh.len > 0.2,
  `15° → ${rLow.len.toFixed(2)} m, 38° → ${rHigh.len.toFixed(2)} m`);
ok('…and it points AWAY from the light, not at it',
  rLow.x * OASIS_SUN.x + rLow.z * OASIS_SUN.z < -0.7 && rHigh.x * NIGHT_SUN.x + rHigh.z * NIGHT_SUN.z < -0.7);
ok('no sun direction at all => no rake (menus/garage/previews unchanged)',
  KM.blobRake(null).len === 0 && KM.blobRake({ x: 0, y: 1, z: 0 }).len === 0);

// The card's REAL world footprint, not the option it was handed: extent along a
// ground direction, and how far its centre has slid from the kart's own origin.
const _fv = new THREE.Vector3();
function footprint(kart, dx, dz) {
  kart.group.updateMatrixWorld(true);
  const c = cards(kart)[0];
  const pa = c.geometry.attributes.position;
  let lo = Infinity, hi = -Infinity, cx = 0, cz = 0;
  for (let i = 0; i < pa.count; i++) {
    _fv.fromBufferAttribute(pa, i).applyMatrix4(c.matrixWorld);
    const t = _fv.x * dx + _fv.z * dz;
    lo = Math.min(lo, t); hi = Math.max(hi, t);
    cx += _fv.x / pa.count; cz += _fv.z / pa.count;
  }
  const g = kart.group.getWorldPosition(new THREE.Vector3());
  return { len: hi - lo, ox: cx - g.x, oz: cz - g.z };
}

const kDef = KM.createKart({ engine: eng('low'), parts: P2 });
const kLow = KM.createKart({ engine: eng('low'), parts: P2, sunDir: OASIS_SUN });
const kHigh = KM.createKart({ engine: eng('low'), parts: P2, sunDir: NIGHT_SUN });

ok('a kart built with a sun direction reports its rake', !!kLow.blobRake && kLow.blobRake.len > 0.2);
ok('…and one built without reports none', kDef.blobRake === null);

const fDef = footprint(kDef, rLow.x, rLow.z);
const fLow = footprint(kLow, rLow.x, rLow.z);
const fHighOwn = footprint(kHigh, rHigh.x, rHigh.z);
const fDefHigh = footprint(kDef, rHigh.x, rHigh.z);

ok('the default card is symmetric: centred on the kart', Math.hypot(fDef.ox, fDef.oz) < 1e-6,
  `offset ${Math.hypot(fDef.ox, fDef.oz).toFixed(6)} m`);
ok('a raked card is LONGER along the sun line', fLow.len > fDef.len + 1.5,
  `${fDef.len.toFixed(2)} → ${fLow.len.toFixed(2)} m`);
ok('…and OFFSET, so the smear leaves the kart instead of hiding under it',
  fLow.ox * rLow.x + fLow.oz * rLow.z > 0.8,
  `${(fLow.ox * rLow.x + fLow.oz * rLow.z).toFixed(2)} m down-sun`);
// The whole point of driving it from the real elevation: 38° must not smear like 15°.
ok('a high moon smears far less than a low sun (elevation really drives it)',
  fHighOwn.len - fDefHigh.len > 0.2 && (fHighOwn.len - fDefHigh.len) < (fLow.len - fDef.len) * 0.6,
  `+${(fHighOwn.len - fDefHigh.len).toFixed(2)} m vs +${(fLow.len - fDef.len).toFixed(2)} m`);

// (b) The rake is a WORLD direction. Yaw the kart hard and the smear must keep
// pointing the same way across the track — not rotate with the bodywork.
const gr = { steer: 0, speed01: 0.8, drifting: false, driftCharge01: 0, airborne: false, boosting: false };
kLow.group.position.set(-9, 0, 4);
kLow.group.rotation.y = 2.3;
kLow.update(1 / 60, gr);
const fYaw = footprint(kLow, rLow.x, rLow.z);
const oLen = Math.hypot(fYaw.ox, fYaw.oz) || 1;
ok('the smear keeps its world direction when the kart turns',
  (fYaw.ox * rLow.x + fYaw.oz * rLow.z) / oLen > 0.99,
  `cos = ${((fYaw.ox * rLow.x + fYaw.oz * rLow.z) / oLen).toFixed(4)}`);
// The raw extent along a fixed world line changes with yaw for ANY rectangle, so
// the invariant is the extent the rake ADDS over an unraked card at the same yaw:
// that must stay the rake's length however the kart is pointing.
kDef.group.position.copy(kLow.group.position);
kDef.group.rotation.y = kLow.group.rotation.y;
const addedYaw = fYaw.len - footprint(kDef, rLow.x, rLow.z).len;
ok('…and adds the same length however the kart is pointing',
  Math.abs(addedYaw - rLow.len) < 0.15 && Math.abs((fLow.len - fDef.len) - rLow.len) < 0.15,
  `+${(fLow.len - fDef.len).toFixed(2)} m at 0°, +${addedYaw.toFixed(2)} m at 132°, rake ${rLow.len.toFixed(2)} m`);
ok('…and slides by half that length, so the contact patch stays put',
  Math.abs(oLen - rLow.len / 2) < 0.1, `${oLen.toFixed(2)} m vs ${(rLow.len / 2).toFixed(2)} m`);
kDef.group.position.set(0, 0, 0); kDef.group.rotation.y = 0; kDef.group.updateMatrixWorld(true);

// (d) Failure mode 3, re-run with the hand-built matrix in force.
const rakedCard = cards(kLow)[0];
for (let i = 0; i < 90; i++) {
  kLow.update(1 / 60, { steer: 1, speed01: 1, drifting: true, driftCharge01: 1, driftDir: 1, airborne: false, boosting: true });
}
kLow.group.updateMatrixWorld(true);
ok('a RAKED card is still perfectly flat while the kart leans', upness(rakedCard) > 0.999,
  `up·n = ${upness(rakedCard).toFixed(5)}`);
ok('…and still sits just above the road', Math.abs(rakedCard.getWorldPosition(new THREE.Vector3()).y) <= 0.06);
// airborne shrink still reaches the raked matrix
const airLen = (() => {
  for (let i = 0; i < 60; i++) kLow.update(1 / 60, Object.assign({}, gr, { airborne: true }));
  return footprint(kLow, rLow.x, rLow.z).len;
})();
ok('the raked card shrinks airborne too (the shrink reaches the matrix)', airLen < fLow.len - 0.3,
  `${fLow.len.toFixed(2)} → ${airLen.toFixed(2)} m`);
const rgid = rakedCard.geometry, rmid = rakedCard.material;
for (let i = 0; i < 240; i++) kLow.update(1 / 60, gr);
ok('raking allocates no geometry or material per frame',
  rakedCard.geometry === rgid && rakedCard.material === rmid);

// (e) THE SEAM. kartmodel cannot import gfx/sky.js, so the rake only exists if
// race.js hands it in — at BOTH kart call sites (the player and the rivals).
const raceSrc = readFileSync(resolve(root, 'src/race/race.js'), 'utf8');
const callSite = fn => {
  const i = raceSrc.indexOf(fn + '({');
  return i < 0 ? '' : raceSrc.slice(i, raceSrc.indexOf('})', i));
};
ok('race.js passes the rig\'s sun direction to the player kart',
  /sunDir\s*:\s*rig\.sunDir/.test(callSite('createKart')), 'createKart call site');
ok('…and to every rival kart (one shadow vocabulary for all eight)',
  /sunDir\s*:\s*rig\.sunDir/.test(callSite('createKartLOD')), 'createKartLOD call site');
ok('kartmodel.js still does not import the sky (it is a leaf)',
  !/from\s+['"][^'"]*gfx\/sky/.test(src));

/* ═══════════════════════════════════════════════════════════════════════════
   THE RENDERED-FRAME A/B — the gate that would actually have caught the bug.

   Everything above is CPU-side: it proves a card exists, is flat, is dark IN THE
   TEXTURE, sits at the right height. The retired card passed all of that and was
   still invisible on screen. So: drive the REAL built dist into a race at נמוך,
   render a frame, hide every ground-shadow card in the live scene, render again,
   and diff the two framebuffers. A shadow that does not move pixels is not a
   shadow, whatever the scene graph says.

   Cards are found structurally in the live scene (flat 4-vertex up-facing quad
   under a `kart:*` group), not by name — so a rename cannot slip past, and the
   same finder measures the retired card, which is how the thresholds below were
   calibrated against it.

   THRESHOLDS, measured (1600x900, seed 12345, t=25, quality low; delta is
   sum-over-RGB, byte-identical across runs and across two independent agents):

                       px changed      mean delta      peak delta
     oasis  retired      20,715            7.4             36
     oasis  current      25,648           25.0            136
     night  retired      16,326            5.7             46
     night  current      23,019           18.4            143
     cloud  retired      26,911           13.8             74
     cloud  current      29,175           51.3            244

   Note what that table says: PIXEL COUNT DOES NOT DISCRIMINATE (the retired card
   covered nearly the same area — it was faint, not absent). So the pixel floor
   is only a sanity check that the blobs are on screen at all, and the real
   discriminators are the two darkness numbers.

     MIN_PX   = 12,000  — 43% below the weakest current reading (21,152 at t=40
                          on night). Catches "the blob left the frame entirely".
     MIN_MEAN = 14      — above every retired reading (max 13.8) and 24% below
                          the weakest current one (17.3). This is the perceptual
                          floor the retired card sat under.
     MIN_PEAK = 100     — the cleanest separator, 35% clear of the retired
                          maximum (74) and 24% below the weakest current one
                          (132). The core of a contact shadow has to be dark.

   All three must hold, per track. Against HEAD's kartmodel.js rebuilt into a
   scratch tree, MIN_PEAK and MIN_MEAN both fail on all three tracks.

   ROUND 3 adds the one number the rake is FOR, and it is an area number because
   the rake adds no alpha at all. Same A/B, same frames, after the shear:

                       px changed      mean delta      peak delta
     oasis  symmetric    25,648           25.0            136
     oasis  raked        69,337           28.5            167
     night  symmetric    23,019           18.4            143
     night  raked        44,866           17.9            189
     cloud  symmetric    29,175           51.3            244
     cloud  raked        95,015           64.2            292

   MIN_RAKE_PX = 38,000 — 15% below the weakest raked reading (44,866, the night
     circuit, whose 38° moon is deliberately the shallowest rake) and comfortably
     above BOTH the symmetric blob (max 29,175) and the retired card (max
     26,911). Unlike MIN_PX this one really discriminates: it is the only
     assertion in the file that fails if the shear silently stops happening —
     which is exactly what the race.js call site losing `sunDir` would cause.
     The mean/peak floors are unchanged, because the rake is at UNCHANGED alpha
     and must never be allowed to "pass" by getting darker instead of longer.
   ═══════════════════════════════════════════════════════════════════════════ */

console.log('\n  \x1b[1m…and it actually darkens the screen (rendered A/B on dist)\x1b[0m');

const MIN_PX = 12000, MIN_MEAN = 14, MIN_PEAK = 100, MIN_RAKE_PX = 38000;
const TRACKS = [[0, 'oasis'], [1, 'night'], [2, 'cloud']];
const DIST = resolve(root, 'dist/index.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Runs in the page. Renders, hides every ground-shadow card, renders again, diffs.
function abInPage() {
  const D = window.__DEBUG, cv = document.querySelector('canvas');
  const scene = D.engine.active.scene;
  const grab = () => {
    D.renderOnce();
    const c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    c.getContext('2d').drawImage(cv, 0, 0);
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  };
  scene.updateMatrixWorld(true);
  const found = [];
  scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || !o.visible) return;
    const pa = o.geometry?.attributes?.position, na = o.geometry?.attributes?.normal;
    if (!pa || pa.count !== 4 || !na) return;
    const m = o.matrixWorld.elements;
    const nx = na.getX(0), ny = na.getY(0), nz = na.getZ(0);
    const wy = m[1] * nx + m[5] * ny + m[9] * nz;
    const wx = m[0] * nx + m[4] * ny + m[8] * nz, wz = m[2] * nx + m[6] * ny + m[10] * nz;
    if (Math.abs(wy / (Math.hypot(wx, wy, wz) || 1)) < 0.9) return;   // plates are vertical
    let a = o.parent, inKart = false;
    while (a) { if (typeof a.name === 'string' && a.name.startsWith('kart:')) { inKart = true; break; } a = a.parent; }
    if (inKart) found.push(o);
  });
  const A = grab();
  for (const o of found) o.visible = false;
  const B = grab();
  for (const o of found) o.visible = true;
  let px = 0, sum = 0, peak = 0;
  for (let i = 0; i < A.length; i += 4) {
    const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
    if (d > 2) { px++; sum += d; if (d > peak) peak = d; }
  }
  return { cards: found.length, px, pct: px / (cv.width * cv.height) * 100, mean: px ? sum / px : 0, peak };
}

if (!existsSync(DIST)) {
  ok('dist/index.html exists (run `npm run build` first)', false);
} else {
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--disable-lcd-text', '--force-device-scale-factor=1',
      '--hide-scrollbars', '--mute-audio'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await page.goto('file://' + DIST, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__DEBUG && window.__DEBUG.ready === true', { timeout: 60000 });
    for (const [id, name] of TRACKS) {
      await page.evaluate(t => window.__DEBUG.goto('race', { track: t, quality: 'low', seed: 12345, lang: 'he' }), id);
      await page.evaluate(() => window.__DEBUG.advance(25));
      const r = await page.evaluate(abInPage);
      const d = `${r.px} px (${r.pct.toFixed(2)}%), mean ${r.mean.toFixed(1)}, peak ${r.peak}`;
      ok(`${name} @נמוך: every kart on screen carries a card`, r.cards >= 8, `${r.cards} cards`);
      ok(`${name} @נמוך: hiding the blobs changes >= ${MIN_PX} px`, r.px >= MIN_PX, d);
      ok(`${name} @נמוך: …by a mean of >= ${MIN_MEAN} (the perceptual floor)`, r.mean >= MIN_MEAN, d);
      ok(`${name} @נמוך: …and its core is dark, peak >= ${MIN_PEAK}`, r.peak >= MIN_PEAK, d);
      ok(`${name} @נמוך: …and the sun rakes it wide, >= ${MIN_RAKE_PX} px`, r.px >= MIN_RAKE_PX, d);
    }
  } finally {
    await browser.close();
  }
}

console.log(failed ? `\n  \x1b[31m${failed} failed\x1b[0m\n` : '\n  \x1b[32mall green\x1b[0m\n');
process.exit(failed ? 1 : 0);

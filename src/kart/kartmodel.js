// KART MODEL — procedural, per-racer, animated, upgradeable.
//
// Everything here is built from primitives at runtime: no models, no image files.
// The look we are chasing (reference/image4, image5): exaggerated cartoon kart —
// fat rear tyres, small front tyres, a low chunky tub, a visible engine block,
// a steering wheel and a driver whose helmet and shoulders read clearly from
// behind at gameplay distance. Charm beats polygon count.
//
// CONVENTIONS
//   forward = -Z, right = +X, up = +Y, wheels touch y = 0.
//   Overall footprint ~1.55 wide x 2.7 long. One unit = one metre.
//
// USAGE
//   const kart = createKart({ racer: ROSTER[0], parts: { engine: 2 }, engine });
//   scene.add(kart.group);
//   kart.update(dt, { steer, speed01, drifting, driftCharge01, airborne, boosting });
//   kart.setParts({ wing: 3 });
//   kart.dispose();
//
// The whole visual is driven off the racer's two colours plus a body-variant key,
// so all eight are distinguishable from behind by silhouette AND colour.
import * as THREE from 'three';
import { ROSTER, racerNumber } from './roster.js';

/* ------------------------------------------------------------------ */
/* geometry helpers                                                     */
/* ------------------------------------------------------------------ */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _down = new THREE.Vector3(0, -1, 0);
const lerp = (a, b, t) => a + (b - a) * t;
// frame-rate independent smoothing
const approach = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

function roundedRectShape(w, h, r) {
  const x = -w / 2, y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// A box with rounded edges on every axis — the single most important helper in
// this file. Raw BoxGeometry reads as "programmer art"; a 4cm bevel reads as toy.
export function roundedBox(w, h, d, r = 0.06, seg = 3) {
  r = Math.max(0.004, Math.min(r, w / 2 - 0.003, h / 2 - 0.003));
  const b = Math.max(0.003, Math.min(r, d / 2 - 0.003));
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
    depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b,
    bevelOffset: 0, bevelSegments: seg, curveSegments: seg + 1, steps: 1,
  });
  geo.translate(0, 0, -(d - 2 * b) / 2);
  geo.computeVertexNormals();
  return geo;
}

// A tiny procedural sky/ground equirect, prefiltered into an environment map.
// This is what gives painted bodywork a specular roll across the fender crests —
// without it MeshStandardMaterial reads as unpainted matte resin. No files: the
// gradient is written into a DataTexture and prefiltered by PMREMGenerator.
export function makeKartEnvironment(renderer) {
  const W = 64, H = 32;
  const data = new Uint8Array(W * H * 4);
  const stops = [
    [0.00, 0x6f, 0x8e, 0xd8],   // zenith, cool
    [0.42, 0xa9, 0xbd, 0xe8],
    [0.50, 0xff, 0xd9, 0xa0],   // warm horizon band (the golden-hour key)
    [0.58, 0xc7, 0x9d, 0x72],
    [1.00, 0x4a, 0x3b, 0x2e],   // ground bounce
  ];
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    let i = 0; while (i < stops.length - 2 && v > stops[i + 1][0]) i++;
    const a = stops[i], b = stops[i + 1];
    const t = clamp((v - a[0]) / (b[0] - a[0] || 1), 0, 1);
    for (let x = 0; x < W; x++) {
      // a soft warm sun blob so highlights have somewhere bright to come from
      const u = x / W;
      const sun = Math.max(0, 1 - Math.hypot((u - 0.72) * 3.6, (v - 0.36) * 8)) ** 2;
      const o = (y * W + x) * 4;
      data[o] = clamp(lerp(a[1], b[1], t) + sun * 255, 0, 255);
      data[o + 1] = clamp(lerp(a[2], b[2], t) + sun * 230, 0, 255);
      data[o + 2] = clamp(lerp(a[3], b[3], t) + sun * 190, 0, 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  tex.dispose();
  return { texture: rt.texture, dispose: () => rt.dispose() };
}

// Soft round-ended blob, used for driver limbs and squishy body parts.
function capsule(r, len, seg = 8) {
  return new THREE.CapsuleGeometry(r, Math.max(0.001, len), 2, seg);
}

/* ------------------------------------------------------------------ */
/* procedural livery texture (tiny, self-contained, no gfx/ import)     */
/* ------------------------------------------------------------------ */

function numberPlateTexture(n, colorHex, accentHex) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const col = '#' + colorHex.toString(16).padStart(6, '0');
  const acc = '#' + accentHex.toString(16).padStart(6, '0');

  g.clearRect(0, 0, S, S);
  // plate
  g.fillStyle = acc;
  roundRectPath(g, 6, 6, S - 12, S - 12, 22); g.fill();
  g.fillStyle = '#f6efe0';
  roundRectPath(g, 14, 14, S - 28, S - 28, 16); g.fill();
  // corner sparks — a little machine-world flavour
  g.fillStyle = col;
  for (const [x, y] of [[26, 26], [S - 26, 26], [26, S - 26], [S - 26, S - 26]]) {
    g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
  }
  // numeral
  g.fillStyle = '#20232b';
  g.font = 'bold 78px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), S / 2, S / 2 + 4);
  g.strokeStyle = col; g.lineWidth = 3;
  g.strokeText(String(n), S / 2, S / 2 + 4);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function contactShadowTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/* dimensions                                                           */
/* ------------------------------------------------------------------ */

const RW = 0.40, RWW = 0.46;     // rear wheel radius / width — deliberately fat
const FW = 0.27, FWW = 0.25;     // front wheel radius / width — deliberately small
const REAR_Z = 0.66, FRONT_Z = -0.82;
const REAR_X = 0.72, FRONT_X = 0.58;   // track kept wide so daylight shows between
                                       // tyre and pod in the rear elevation

export const PART_SLOTS = ['engine', 'tires', 'wing', 'chassis', 'exhaust'];
export const PART_TIERS = 4;     // 0 = junk, 3 = glowing hero part

/* ------------------------------------------------------------------ */
/* level of detail                                                      */
/* ------------------------------------------------------------------ */

// THE bug this normaliser exists for: race.js asks for a cheap opponent with
// `lod: 1` — a NUMBER — and every test inside createKart is a STRING compare
// (`lod === 'low'`). `1 === 'low'` is false, so the "cheap" AI kart was built at
// MID detail: 235 meshes against the player's own 144 at the low tier. The LOD
// path was wired, called, and reduced nothing at all.
//
// Numbers are the renderer's usual LOD vocabulary (0 = nearest), so accept them:
// 0 means "no override, use the tier", anything >= 1 means the cheap build.
export const LOD_LEVELS = ['low', 'mid', 'high'];
export function normalizeLod(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 1 ? 'low' : null;
  return LOD_LEVELS.includes(v) ? v : null;
}

/* ------------------------------------------------------------------ */
/* createKart                                                           */
/* ------------------------------------------------------------------ */

export function createKart(opts = {}) {
  const racer = opts.racer || ROSTER[0];
  const eng = opts.engine || null;
  const q = eng?.q || null;
  const lod = normalizeLod(opts.lod) || (q ? (q.name === 'low' ? 'low' : q.name === 'medium' ? 'mid' : 'high') : 'high');
  const LOW = lod === 'low';
  const HIGH = lod === 'high';
  const shadows = opts.shadows ?? (q ? !!q.shadows : true);
  // Weld the parts of the kart that never move relative to each other into one
  // geometry per material. Opt-in, and only createKartLOD (the distant-AI build)
  // turns it on: the player's kart and every garage/menu kart stay unwelded.
  const MERGE = !!opts.merge;
  // Overridable only so the LOD preview rigs can build the welded kart's exact
  // unwelded twin; the game never passes it.
  const PLATES = opts.plates ?? (!LOW || MERGE);

  const geos = [];   // owned geometries (disposed with the kart)
  const mats = [];   // owned materials
  const texs = [];   // owned textures
  const G = g => { geos.push(g); return g; };

  const C = new THREE.Color();
  const shade = (hex, f) => C.setHex(hex).multiplyScalar(f).getHex();
  const mix = (a, b, t) => C.setHex(a).lerp(new THREE.Color(b), t).getHex();

  function mat(color, o = {}) {
    const m = new THREE.MeshStandardMaterial({
      color, roughness: o.roughness ?? 0.55, metalness: o.metalness ?? 0.05,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1,
      flatShading: !!o.flat, transparent: !!o.transparent, opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide, depthWrite: o.depthWrite ?? true, map: o.map || null,
      alphaTest: o.alphaTest ?? 0, envMapIntensity: o.env ?? 0.55,
    });
    mats.push(m);
    return m;
  }

  // ---- palette -----------------------------------------------------
  const col = racer.color, col2 = racer.color2;
  // Painted bodywork: low roughness + a real environment map is the difference
  // between "toy with a clear coat" and "matte resin print".
  const M = {
    body: mat(col, { roughness: 0.26, metalness: 0.15, env: 0.9 }),
    bodyDark: mat(shade(col, 0.66), { roughness: 0.34, metalness: 0.12, env: 0.8 }),
    accent: mat(col2, { roughness: 0.26, metalness: 0.12, env: 0.9 }),
    dark: mat(0x2a2e37, { roughness: 0.6, env: 0.5 }),
    frame: mat(0x3b4250, { roughness: 0.45, metalness: 0.45, env: 0.8 }),
    tyre: mat(0x22252b, { roughness: 0.9, env: 0.35 }),
    tread: mat(0x30343d, { roughness: 0.85, flat: true, env: 0.3 }),
    rim: mat(0xefe2c4, { roughness: 0.28, metalness: 0.35, env: 0.9 }),
    hub: mat(col2, { roughness: 0.25, metalness: 0.45, env: 0.9 }),
    chrome: mat(0xbcc6d2, { roughness: 0.14, metalness: 0.9, env: 1.0 }),
    // Hero-tier metal. With no bloom pass, "expensive" has to come from specular
    // contrast and trim colour, not emissive: near-mirror chrome plus a gold
    // anodised accent read as a premium part in a still frame.
    chromeHi: mat(0xc4d0de, { roughness: 0.06, metalness: 1.0, env: 1.5 }),
    // open-ended tubes (intake trumpets, megaphone tips) need both faces
    chromeOpen: mat(0xc9d4e2, { roughness: 0.08, metalness: 1.0, env: 1.35, side: THREE.DoubleSide }),
    gold: mat(0xffc247, { roughness: 0.16, metalness: 0.95, env: 1.3 }),
    goldOpen: mat(0xffc247, { roughness: 0.16, metalness: 0.95, env: 1.3, side: THREE.DoubleSide }),
    goldDark: mat(0xb8842a, { roughness: 0.3, metalness: 0.9, env: 1.0 }),
    // tier-0 metal: dull, oxidised, obviously not chrome
    rust: mat(0x7d6a52, { roughness: 0.95, metalness: 0.2, env: 0.2 }),
    seat: mat(0x3a3f4b, { roughness: 0.7, env: 0.45 }),
    visor: mat(0x141d29, { roughness: 0.05, metalness: 0.7, env: 1.0 }),
    cream: mat(0xf1e7d0, { roughness: 0.32, env: 0.8 }),
    skin: mat(mix(col, 0xffffff, 0.40), { roughness: 0.45, env: 0.6 }),   // robot shell
    glow: mat(col2, { roughness: 0.3, emissive: col2, emissiveIntensity: 0.8 }),
    warm: mat(0xffd79a, { roughness: 0.4, emissive: 0xff9a3c, emissiveIntensity: 0.6 }),
    flame: mat(0xff9a3c, { roughness: 0.4, emissive: 0xff5a10, emissiveIntensity: 1.0, transparent: true, opacity: 0.85 }),
    // junk tier: the point is WRONG MATERIAL, not just wrong shape — dead grey-brown
    // pulp that cannot be mistaken for paint under the warm key.
    cardboard: mat(0x8a7a62, { roughness: 1, metalness: 0, env: 0.15 }),
    tape: mat(0xd8d2c2, { roughness: 0.95, metalness: 0, env: 0.15 }),
  };

  const meshOpts = m => { m.castShadow = shadows; m.receiveShadow = false; return m; };
  function mesh(geo, material, parent, pos, rot) {
    const m = new THREE.Mesh(geo, material);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    meshOpts(m);
    parent.add(m);
    return m;
  }

  /* ---------------- root hierarchy ------------------------------- */
  const group = new THREE.Group();
  group.name = `kart:${racer.id}`;

  // bodyPivot carries roll/pitch/squat; wheels stay on the ground under it.
  const bodyPivot = new THREE.Group();
  bodyPivot.name = 'body';
  group.add(bodyPivot);

  const chassisGrp = new THREE.Group();     // static chassis parts
  bodyPivot.add(chassisGrp);

  // upgrade slots
  const slotGrp = {};
  for (const s of PART_SLOTS) { slotGrp[s] = new THREE.Group(); slotGrp[s].name = 'slot:' + s; bodyPivot.add(slotGrp[s]); }

  const driverPivot = new THREE.Group();    // leans into corners
  // 0.62, not 0.55: the rear wing sits at the driver's shoulder line by design, so
  // at the old height the wing ate the shoulders and left only a dome of helmet
  // above it. Seven centimetres lifts the shoulder pads clear of the wing's
  // trailing edge from the chase camera at every tier. The seat is raised to match.
  driverPivot.position.set(0, 0.62, 0.26);
  bodyPivot.add(driverPivot);

  /* ---------------- contact shadow ------------------------------- */
  const csTex = contactShadowTexture(); texs.push(csTex);
  const csMat = new THREE.MeshBasicMaterial({ map: csTex, transparent: true, depthWrite: false, opacity: 0.85 });
  mats.push(csMat);
  const contact = new THREE.Mesh(G(new THREE.PlaneGeometry(2.9, 3.4)), csMat);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.012;
  contact.renderOrder = -1;
  group.add(contact);

  /* ---------------- chassis -------------------------------------- */
  // floor pan
  mesh(G(roundedBox(0.94, 0.11, 1.56, 0.05)), M.dark, chassisGrp, [0, 0.185, 0.08]);
  // main tub
  mesh(G(roundedBox(0.72, 0.30, 1.52, 0.12)), M.body, chassisGrp, [0, 0.33, 0.10]);
  // narrow front frame beam — the gap between tub and front wheels is what makes
  // the silhouette read as "kart" rather than "brick"
  mesh(G(roundedBox(0.50, 0.22, 0.80, 0.09)), M.body, chassisGrp, [0, 0.30, -0.94]);
  mesh(G(roundedBox(0.34, 0.05, 0.62, 0.02)), M.cream, chassisGrp, [0, 0.42, -0.96]);
  // livery stripe along the top of the tub
  mesh(G(roundedBox(0.44, 0.05, 1.06, 0.022)), M.cream, chassisGrp, [0, 0.50, -0.06]);
  // side pods — pulled inboard and shortened so there is real daylight between
  // pod, fender and rear tyre when you are sitting behind the kart
  for (const sx of [-1, 1]) {
    mesh(G(roundedBox(0.26, 0.32, 0.80, 0.11)), M.body, chassisGrp, [sx * 0.44, 0.34, -0.16]);
    mesh(G(roundedBox(0.28, 0.07, 0.50, 0.03)), M.cream, chassisGrp, [sx * 0.44, 0.49, -0.16]);
    // pod intake + a little radiator core, mid-frequency detail
    mesh(G(roundedBox(0.17, 0.17, 0.08, 0.045)), M.dark, chassisGrp, [sx * 0.44, 0.34, -0.57]);
    if (!LOW) for (let i = 0; i < 3; i++) {
      mesh(G(roundedBox(0.14, 0.02, 0.03, 0.008)), M.chrome, chassisGrp, [sx * 0.44, 0.29 + i * 0.05, -0.60]);
    }
    // suspension arm from the tub out to the front hub
    if (!LOW) {
      const arm = mesh(G(new THREE.CylinderGeometry(0.028, 0.028, 0.42, 6)), M.frame, chassisGrp,
        [sx * 0.36, 0.24, -0.86], [0, 0, Math.PI / 2]);
      arm.rotation.y = sx * 0.22;
    }
  }
  // nose cone
  const nose = mesh(G(roundedBox(0.62, 0.24, 0.40, 0.10)), M.body, chassisGrp, [0, 0.31, -1.14]);
  nose.scale.set(1, 1, 1);
  mesh(G(roundedBox(0.40, 0.09, 0.10, 0.035)), M.accent, chassisGrp, [0, 0.40, -1.30]);
  // two little lamp eyes — friendly machine-world face
  for (const sx of [-1, 1]) {
    mesh(G(new THREE.CylinderGeometry(0.058, 0.058, 0.05, LOW ? 6 : 14)), M.warm, chassisGrp,
      [sx * 0.16, 0.35, -1.34], [Math.PI / 2, 0, 0]);
  }
  // front bumper bar + posts
  mesh(G(roundedBox(0.88, 0.13, 0.13, 0.055)), M.accent, chassisGrp, [0, 0.20, -1.34]);
  for (const sx of [-1, 1]) mesh(G(roundedBox(0.07, 0.09, 0.26, 0.03)), M.frame, chassisGrp, [sx * 0.25, 0.21, -1.24]);
  // rear bumper bar
  mesh(G(roundedBox(1.16, 0.17, 0.18, 0.08)), M.body, chassisGrp, [0, 0.30, 1.08]);
  mesh(G(roundedBox(1.00, 0.05, 0.06, 0.02)), M.accent, chassisGrp, [0, 0.38, 1.06]);
  for (const sx of [-1, 1]) mesh(G(roundedBox(0.09, 0.12, 0.26, 0.04)), M.frame, chassisGrp, [sx * 0.34, 0.31, 0.96]);

  // fenders — arcs over each wheel, the silhouette detail that sells "kart"
  function fender(x, y, z, r, wide, m) {
    const tube = 0.07;
    const t = new THREE.Mesh(G(new THREE.TorusGeometry(r + 0.09, tube, LOW ? 4 : 8, LOW ? 7 : 18, Math.PI * 0.62)), m);
    t.position.set(x, y, z);
    t.rotation.set(0, Math.PI / 2, Math.PI * 0.19);
    t.scale.set(1, 1.0, (wide * 0.56) / tube);
    meshOpts(t); chassisGrp.add(t);
    return t;
  }
  for (const sx of [-1, 1]) {
    fender(sx * FRONT_X, FW, FRONT_Z, FW, FWW, M.body);
    fender(sx * REAR_X, RW, REAR_Z, RW, RWW, M.body);
  }

  // seat
  mesh(G(roundedBox(0.60, 0.13, 0.52, 0.06)), M.seat, chassisGrp, [0, 0.53, 0.30]);
  const seatBack = mesh(G(roundedBox(0.50, 0.46, 0.15, 0.08)), M.seat, chassisGrp, [0, 0.78, 0.56]);
  seatBack.rotation.x = -0.14;
  mesh(G(roundedBox(0.42, 0.08, 0.10, 0.035)), M.accent, chassisGrp, [0, 0.99, 0.58]);
  // seat piping — mid-frequency detail that reads at chase distance
  if (!LOW) for (const sx of [-1, 1]) mesh(G(roundedBox(0.03, 0.36, 0.10, 0.012)), M.accent, chassisGrp, [sx * 0.23, 0.78, 0.55], [-0.14, 0, 0]);

  // dash + steering column + steering wheel
  mesh(G(roundedBox(0.56, 0.18, 0.16, 0.06)), M.bodyDark, chassisGrp, [0, 0.50, -0.50]);
  const steerPivot = new THREE.Group();
  steerPivot.position.set(0, 0.74, -0.32);
  steerPivot.rotation.x = -0.90;   // laid back like a real kart column
  bodyPivot.add(steerPivot);
  const column = mesh(G(new THREE.CylinderGeometry(0.035, 0.045, 0.34, LOW ? 5 : 8)), M.frame, steerPivot, [0, 0, 0.17], [Math.PI / 2, 0, 0]);
  column.castShadow = shadows;
  const wheelRim = mesh(G(new THREE.TorusGeometry(0.165, 0.033, LOW ? 4 : 6, LOW ? 8 : 16)), M.dark, steerPivot);
  for (const a of [-1, 1]) mesh(G(roundedBox(0.30, 0.045, 0.05, 0.02)), M.accent, steerPivot, [0, a * 0.0, 0], [0, 0, a * 0.35]);
  mesh(G(new THREE.CylinderGeometry(0.06, 0.06, 0.05, LOW ? 6 : 12)), M.accent, steerPivot, [0, 0, 0.02], [Math.PI / 2, 0, 0]);

  /* ---------------- number plates -------------------------------- */
  // Kept on the welded build even though it is a 'low' one: the three plates
  // share a geometry and a material, so after the weld they are ONE draw call,
  // and the rear number is the only thing that tells a child WHICH rival is in
  // front of them. The player's own low-tier kart still drops them — nobody ever
  // sees the number on the kart they are sitting in.
  if (PLATES) {
    const numTex = numberPlateTexture(racerNumber(racer), col, col2);
    texs.push(numTex);
    const plateMat = mat(0xffffff, { map: numTex, roughness: 0.55, transparent: true, alphaTest: 0.4 });
    const plateGeo = G(new THREE.PlaneGeometry(0.28, 0.28));
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(plateGeo, plateMat);
      p.position.set(sx * 0.578, 0.36, -0.16);
      p.rotation.y = sx * Math.PI / 2;
      chassisGrp.add(p);
    }
    // The rear number is the one identity cue that survives the chase camera —
    // make it big and put it where nothing occludes it.
    const back = new THREE.Mesh(plateGeo, plateMat);
    back.position.set(0, 0.60, 1.21);
    back.scale.setScalar(1.45);
    chassisGrp.add(back);
  }

  /* ---------------- wheels --------------------------------------- */
  // axle -> steerPivot(front) -> spin
  const wheels = [];
  function buildWheel(kind, sx) {
    const isRear = kind === 'rear';
    const axle = new THREE.Group();
    axle.position.set(sx * (isRear ? REAR_X : FRONT_X), isRear ? RW : FW, isRear ? REAR_Z : FRONT_Z);
    group.add(axle);
    const steerG = new THREE.Group(); axle.add(steerG);
    const spin = new THREE.Group(); steerG.add(spin);
    const w = { kind, sx, axle, steer: steerG, spin, baseY: isRear ? RW : FW, visual: null, r: isRear ? RW : FW, w: isRear ? RWW : FWW };
    wheels.push(w);
    return w;
  }
  for (const sx of [-1, 1]) buildWheel('front', sx);
  for (const sx of [-1, 1]) buildWheel('rear', sx);

  // Tyre visuals are rebuilt when the `tires` part tier changes.
  const tyreGeos = [];
  function buildTyreVisual(w, tier) {
    if (w.visual) { w.spin.remove(w.visual); disposeSubtree(w.visual); }
    const g = new THREE.Group();
    // Tier changes tyre size AND look. The rear pair dominates the chase-camera
    // silhouette, so the width ramp is deliberately aggressive — but only up to a
    // point: at 1.48 the tier-3 kart stopped reading as the same class of vehicle
    // as tier 0 and started reading as a bulldozer. The top of the ramp is pulled
    // back to 1.30 so the step stays legible while the kart stays a hot-rod.
    const fat = [0.70, 1.0, 1.16, 1.30][tier];
    const grow = [0.90, 1.0, 1.06, 1.14][tier];
    // Tier 0 is a mismatched pair: the left corner runs a smaller, balder tyre
    // than the right. The kart visibly sits crooked and hops as it rolls — the
    // joke reads instantly and nothing about it looks like a bug.
    const odd = tier === 0 && w.sx < 0 ? 0.88 : 1;
    const r = w.r * grow * odd, width = w.w * fat * (tier === 0 && w.sx > 0 ? 1.18 : 1);
    w.scaleR = r;
    const seg = LOW ? 8 : 16;
    const tyreMat = tier === 0 ? (w.sx < 0 ? M.rust : M.frame) : M.tyre;
    const carc = new THREE.Mesh(G(new THREE.CylinderGeometry(r, r, width, seg)), tyreMat);
    carc.rotation.z = Math.PI / 2;
    meshOpts(carc); g.add(carc);
    // rounded sidewall shoulders — a fat cartoon tyre, never a plain cylinder
    if (!LOW) for (const s of [-1, 1]) {
      const bul = new THREE.Mesh(G(new THREE.TorusGeometry(r * 0.90, r * 0.115, 5, seg)), tyreMat);
      bul.rotation.y = Math.PI / 2;
      bul.position.x = s * width * 0.42;
      meshOpts(bul); g.add(bul);
    }
    // tread blocks (one instanced draw call per wheel)
    if (!LOW && tier > 0) {
      const n = tier === 3 ? 20 : tier === 2 ? 16 : 12;
      const bw = width * 0.86, bh = (tier === 3 ? 0.075 : tier === 2 ? 0.062 : 0.05) * grow, bd = (2 * Math.PI * r / n) * 0.55;
      const tg = G(roundedBox(bw, bh, bd, 0.018, 1));
      const im = new THREE.InstancedMesh(tg, M.tread, n);
      const mtx = new THREE.Matrix4(), qt = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pos.set(0, Math.cos(a) * (r - 0.005), Math.sin(a) * (r - 0.005));
        e.set(a, 0, 0); qt.setFromEuler(e);
        mtx.compose(pos, qt, scl);
        im.setMatrixAt(i, mtx);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = shadows;
      g.add(im);
    }
    // Tier-0 sidewalls are bare — no white ring, no shoulder highlight — which is
    // most of why the junk tyre reads as a worn-out cast-off rather than a tyre.
    // Tiers 2 and 3 gain a cream sidewall ring: a bright circle on a black tyre is
    // the cheapest possible "these are proper tyres" signal at gameplay distance.
    if (!LOW && tier >= 2) for (const s of [-1, 1]) {
      const ring = new THREE.Mesh(G(new THREE.TorusGeometry(r * 0.74, tier === 3 ? 0.028 : 0.020, 4, seg)),
        tier === 3 ? M.gold : M.cream);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = s * width * 0.5;
      meshOpts(ring); g.add(ring);
    }
    // rim + hub
    const rimR = r * (tier === 3 ? 0.66 : tier === 2 ? 0.62 : 0.56);
    const rimMat = tier === 0 ? M.dark : tier === 3 ? M.chromeHi : M.rim;
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(G(new THREE.CylinderGeometry(rimR, rimR, width * 0.62, LOW ? 8 : 14)), rimMat);
      rim.rotation.z = Math.PI / 2;
      rim.position.x = s * width * 0.22;
      meshOpts(rim); g.add(rim);
      const hub = new THREE.Mesh(G(new THREE.SphereGeometry(rimR * 0.42, LOW ? 6 : 10, LOW ? 4 : 8)),
        tier === 0 ? M.cardboard : tier === 3 ? M.gold : M.hub);
      hub.position.x = s * (width * 0.5 + 0.005);
      meshOpts(hub); g.add(hub);
      // tier-2 gets flat spoke slots, tier-3 a deep multi-spoke chrome face:
      // the two middle tiers have to differ from each other, not just from the ends
      if (!LOW && tier === 2) for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const sp = new THREE.Mesh(G(roundedBox(0.018, rimR * 0.95, 0.05, 0.007)), M.hub);
        sp.position.set(s * (width * 0.5 - 0.01), Math.cos(a) * rimR * 0.44, Math.sin(a) * rimR * 0.44);
        // radial, in the plane of the wheel face. The old `Math.PI/2` on Z swung
        // the spoke's long axis onto the axle, so the "spokes" were 30cm rods
        // sticking out sideways — a turbine fan bolted to the hub, and 0.3 m of
        // phantom width on the tier-3 kart.
        sp.rotation.set(a, 0, 0);
        meshOpts(sp); g.add(sp);
      }
      if (!LOW && tier === 3) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const sp = new THREE.Mesh(G(roundedBox(0.028, rimR * 1.15, 0.055, 0.01)), M.chromeHi);
          sp.position.set(s * (width * 0.5 + 0.006), Math.cos(a) * rimR * 0.5, Math.sin(a) * rimR * 0.5);
          sp.rotation.set(a, 0, 0);   // radial, in the wheel face — see tier-2 note
          meshOpts(sp); g.add(sp);
        }
        const lip = new THREE.Mesh(G(new THREE.TorusGeometry(rimR * 1.02, 0.028, 4, seg)), M.gold);
        lip.rotation.y = Math.PI / 2;
        lip.position.x = s * (width * 0.5 + 0.01);
        meshOpts(lip); g.add(lip);
      }
    }
    // tier-0: a bent coat-hanger "spare spoke" wired across one rim
    if (!LOW && tier === 0 && w.sx > 0) {
      const wire = new THREE.Mesh(G(new THREE.CylinderGeometry(0.016, 0.016, r * 1.7, 4)), M.rust);
      wire.rotation.set(0.7, 0, 0);        // a diameter across the wheel face
      wire.position.x = width * 0.55;
      meshOpts(wire); g.add(wire);
    }
    w.visual = g;
    w.spin.add(g);
  }

  /* ---------------- driver --------------------------------------- */
  const variant = racer.body || 'spark';
  const V = {
    spark: { torso: [0.46, 0.42, 0.34], headR: 0.23, headY: 0.46, boxHead: false },
    slim: { torso: [0.34, 0.54, 0.30], headR: 0.20, headY: 0.54, boxHead: false },
    tank: { torso: [0.68, 0.40, 0.42], headR: 0.23, headY: 0.44, boxHead: true },
    lamp: { torso: [0.44, 0.38, 0.34], headR: 0.25, headY: 0.46, boxHead: false },
    twin: { torso: [0.48, 0.42, 0.34], headR: 0.22, headY: 0.46, boxHead: false },
    round: { torso: [0.62, 0.48, 0.46], headR: 0.19, headY: 0.50, boxHead: false },
    button: { torso: [0.60, 0.32, 0.40], headR: 0.23, headY: 0.40, boxHead: false },
    horn: { torso: [0.52, 0.42, 0.36], headR: 0.22, headY: 0.46, boxHead: true },
  }[variant] || V_default();
  function V_default() { return { torso: [0.46, 0.42, 0.34], headR: 0.23, headY: 0.46, boxHead: false }; }

  const glowParts = [];   // materials pulsed by boost / drift charge

  // torso
  const torso = mesh(G(roundedBox(V.torso[0], V.torso[1], V.torso[2], 0.14)), M.skin, driverPivot, [0, V.torso[1] / 2 + 0.05, 0.02]);
  // chest emblem
  mesh(G(new THREE.CylinderGeometry(0.075, 0.075, 0.04, LOW ? 6 : 12)), M.accent, driverPivot,
    [0, V.torso[1] * 0.55, -V.torso[2] / 2 - 0.005], [Math.PI / 2, 0, 0]);
  // neck
  mesh(G(new THREE.CylinderGeometry(0.075, 0.09, 0.09, LOW ? 6 : 10)), M.dark, driverPivot, [0, V.torso[1] + 0.06, 0.02]);

  // head
  const headPivot = new THREE.Group();
  headPivot.position.set(0, V.headY + V.torso[1] * 0.5, 0.01);
  driverPivot.add(headPivot);
  const hr = V.headR;
  if (V.boxHead) {
    mesh(G(roundedBox(hr * 2.0, hr * 1.8, hr * 1.9, hr * 0.5)), M.body, headPivot);
  } else {
    const hd = mesh(G(new THREE.SphereGeometry(hr, LOW ? 8 : 18, LOW ? 6 : 14)), M.body, headPivot);
    hd.scale.set(1, 0.95, 1);
  }
  // helmet band — sits BELOW the visor (a band level with the visor turns the
  // head into a striped bead instead of a helmeted face)
  mesh(G(new THREE.TorusGeometry(hr * 0.96, hr * 0.11, LOW ? 4 : 6, LOW ? 8 : 18)), M.cream, headPivot, [0, -hr * 0.42, 0], [Math.PI / 2, 0, 0]);
  // visor — a dark glossy wrap on the front (-Z) of the head
  if (V.boxHead) {
    mesh(G(roundedBox(hr * 1.5, hr * 0.62, 0.05, 0.02)), M.visor, headPivot, [0, hr * 0.06, -hr * 0.98]);
  } else {
    // three.js sphere phi runs from -X toward +Z, so a patch centred on -Z
    // (the driver's face) starts at 1.5π minus half the sweep.
    const sweep = Math.PI * 0.40;
    const vg = G(new THREE.SphereGeometry(hr * 1.03, LOW ? 8 : 18, LOW ? 6 : 12,
      Math.PI * 1.5 - sweep / 2, sweep, Math.PI * 0.28, Math.PI * 0.34));
    const vis = new THREE.Mesh(vg, M.visor);
    headPivot.add(vis);
  }
  // shoulder mass either side of the helmet so the head is not a floating ball
  for (const sx of [-1, 1]) {
    const pad = mesh(G(roundedBox(0.17, 0.15, 0.28, 0.07)), M.accent, driverPivot,
      [sx * (V.torso[0] / 2 + 0.05), V.torso[1] * 0.86, 0.03]);
    pad.scale.set(1, 1, 1);
  }

  // per-variant headgear — this is what separates the silhouettes
  const wobblers = [];   // things that jiggle when the kart moves
  function antenna(x, tilt, len, bulbMat) {
    const a = new THREE.Group();
    a.position.set(x, hr * 0.9, 0);
    a.rotation.z = tilt;
    headPivot.add(a);
    mesh(G(new THREE.CylinderGeometry(0.018, 0.022, len, LOW ? 4 : 6)), M.dark, a, [0, len / 2, 0]);
    const bulb = mesh(G(new THREE.SphereGeometry(0.062, LOW ? 6 : 12, LOW ? 5 : 10)), bulbMat, a, [0, len + 0.03, 0]);
    wobblers.push(a);
    return { a, bulb };
  }
  switch (variant) {
    case 'spark': {
      const { bulb } = antenna(0, 0, 0.24, M.glow);
      bulb.geometry = G(new THREE.OctahedronGeometry(0.085, 0));
      bulb.scale.set(0.9, 1.3, 0.9);
      glowParts.push(M.glow);
      // three little spark prongs radiating out of the bulb
      for (const s of [-1, 0, 1]) mesh(G(roundedBox(0.018, 0.07, 0.018, 0.008)), M.warm, bulb, [s * 0.05, 0.05, 0], [0, 0, s * 0.7]);
      break;
    }
    case 'slim':
      antenna(0, 0.12, 0.34, M.accent);
      mesh(G(new THREE.TorusGeometry(0.07, 0.018, 4, LOW ? 8 : 14)), M.accent, headPivot, [0, hr * 1.5, 0], [Math.PI / 2, 0, 0]);
      break;
    case 'tank':
      // heavy roll bar behind the head
      for (const sx of [-1, 1]) mesh(G(roundedBox(0.07, 0.30, 0.09, 0.03)), M.accent, driverPivot, [sx * 0.20, V.torso[1] + 0.22, 0.22]);
      mesh(G(roundedBox(hr * 1.1, 0.07, hr * 1.2, 0.03)), M.accent, headPivot, [0, hr * 0.95, 0]);
      break;
    case 'lamp': {
      const dome = mesh(G(new THREE.SphereGeometry(hr * 0.78, LOW ? 8 : 14, LOW ? 5 : 9, 0, Math.PI * 2, 0, Math.PI / 2)), M.glow, headPivot, [0, hr * 0.72, 0]);
      dome.scale.set(1, 0.85, 1);
      glowParts.push(M.glow);
      mesh(G(new THREE.TorusGeometry(hr * 0.8, 0.03, 4, LOW ? 8 : 16)), M.accent, headPivot, [0, hr * 0.72, 0], [Math.PI / 2, 0, 0]);
      break;
    }
    case 'twin':
      antenna(-hr * 0.55, 0.42, 0.24, M.accent);
      antenna(hr * 0.55, -0.42, 0.24, M.accent);
      for (const sx of [-1, 1]) mesh(G(new THREE.CylinderGeometry(0.07, 0.07, 0.04, LOW ? 6 : 12)), M.accent, headPivot, [sx * hr, 0, 0], [0, 0, Math.PI / 2]);
      break;
    case 'round':
      mesh(G(new THREE.SphereGeometry(hr * 0.55, LOW ? 6 : 12, LOW ? 5 : 8, 0, Math.PI * 2, 0, Math.PI / 2)), M.accent, headPivot, [0, hr * 0.72, 0]);
      // belly plate
      mesh(G(new THREE.CylinderGeometry(0.16, 0.16, 0.05, LOW ? 8 : 14)), M.accent, driverPivot, [0, V.torso[1] * 0.5, -V.torso[2] / 2 - 0.01], [Math.PI / 2, 0, 0]);
      break;
    case 'button': {
      const cap = mesh(G(new THREE.CylinderGeometry(hr * 1.05, hr * 0.95, 0.10, LOW ? 8 : 16)), M.accent, headPivot, [0, hr * 0.92, 0]);
      wobblers.push(cap);
      mesh(G(new THREE.CylinderGeometry(hr * 0.55, hr * 0.55, 0.05, LOW ? 6 : 12)), M.glow, headPivot, [0, hr * 1.0, 0]);
      glowParts.push(M.glow);
      break;
    }
    case 'horn':
      for (const sx of [-1, 1]) {
        const c = mesh(G(new THREE.ConeGeometry(0.13, 0.22, LOW ? 6 : 12, 1, true)), M.accent, driverPivot,
          [sx * (V.torso[0] / 2 + 0.04), V.torso[1] * 0.86, 0.14], [Math.PI / 2 + 0.35, 0, sx * 0.3]);
        c.material = M.accent;
      }
      mesh(G(roundedBox(hr * 1.3, 0.06, 0.10, 0.025)), M.dark, headPivot, [0, -hr * 0.55, -hr * 0.7]);
      break;
  }

  // arms reaching to the steering wheel. The arm is a single stretchy segment
  // aimed at the grip each frame, so the hands never leave the wheel rim.
  const ARM_LEN = 0.44, HAND_OFF = 0.50;
  const arms = [];
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * (V.torso[0] / 2 + 0.02), V.torso[1] * 0.78 + 0.05, 0.0);
    driverPivot.add(shoulder);
    mesh(G(new THREE.SphereGeometry(0.078, LOW ? 6 : 10, LOW ? 5 : 8)), M.accent, shoulder);
    const upper = new THREE.Group(); shoulder.add(upper);
    mesh(G(capsule(0.052, ARM_LEN, LOW ? 5 : 8)), M.skin, upper, [0, -ARM_LEN / 2 - 0.03, 0]);
    const hand = mesh(G(new THREE.SphereGeometry(0.082, LOW ? 6 : 10, LOW ? 5 : 8)), M.dark, upper, [0, -HAND_OFF - 0.03, 0]);
    hand.scale.set(1, 0.85, 1.15);
    arms.push({ shoulder, upper, sx });
  }
  // knees peeking over the dash
  for (const sx of [-1, 1]) {
    const k = mesh(G(new THREE.SphereGeometry(0.11, LOW ? 6 : 10, LOW ? 5 : 8)), M.skin, bodyPivot, [sx * 0.17, 0.60, -0.30]);
    k.scale.set(1, 0.8, 1.5);
  }

  /* ---------------- upgrade parts -------------------------------- */
  const parts = { engine: 1, tires: 1, wing: 1, chassis: 1, exhaust: 1 };
  const flames = [];       // exhaust flame meshes, shown while boosting
  const coreGlow = [];     // meshes/materials that pulse with drift charge & boost

  function clearSlot(name) {
    const g = slotGrp[name];
    for (let i = g.children.length - 1; i >= 0; i--) { const c = g.children[i]; g.remove(c); disposeSubtree(c); }
  }

  // --- rear wing ---------------------------------------------------
  // The old wing sat at 1.62 — above helmet height — on two long vertical pylons,
  // and read as a dragster goalpost rather than a kart. A real kart wing sits at
  // roughly the driver's shoulder line and is WIDE: width, not height, is what
  // makes it legible from behind, and width is what keeps the toy proportions.
  // So the tier ramp now spends its budget on span (1.06 → 1.30 → 1.56 m) and on
  // element count (1 → 2 → 3) instead of on altitude.
  // 1.04 is the highest the main element can sit before it starts eating the
  // driver's helmet from the chase camera — and a visible helmet is worth more to
  // the silhouette than another 6cm of wing.
  const WING_Y = 1.04, WING_Z = 1.30;
  const DECK_Y = 0.42;         // top of the rear tub, where the pylons are rooted

  // Per-racer wing tag: a rear-facing silhouette cue that survives at gameplay
  // distance, since the head and torso are hidden behind the seat from behind.
  function wingTag(g, y, z, w) {
    const s = racer.body;
    const fin = (x, h, tilt) => mesh(G(roundedBox(0.05, h, 0.20, 0.02)), M.accent, g, [x, y + h / 2, z], [0, 0, tilt]);
    if (s === 'spark') fin(0, 0.22, 0);                                     // single centre fin
    else if (s === 'slim') { fin(-0.14, 0.26, 0); fin(0.14, 0.26, 0); }     // twin tall fins
    else if (s === 'twin') { fin(-0.16, 0.20, 0.35); fin(0.16, 0.20, -0.35); } // V fins
    else if (s === 'horn') { fin(-0.22, 0.14, 0); fin(0, 0.20, 0); fin(0.22, 0.14, 0); }
    else if (s === 'tank') for (const sx of [-1, 1])                        // boxed endplates
      mesh(G(roundedBox(0.05, 0.26, 0.34, 0.03)), M.accent, g, [sx * (w / 2 - 0.02), y + 0.09, z]);
    else if (s === 'lamp') {                                                // arch hoop
      const hoop = mesh(G(new THREE.TorusGeometry(0.22, 0.028, 4, LOW ? 8 : 16, Math.PI)), M.accent, g, [0, y + 0.02, z]);
      hoop.rotation.y = 0;
    } else if (s === 'round') {                                             // paddle disc
      mesh(G(new THREE.CylinderGeometry(0.15, 0.15, 0.045, LOW ? 8 : 16)), M.accent, g, [0, y + 0.16, z], [Math.PI / 2, 0, 0]);
      mesh(G(roundedBox(0.05, 0.18, 0.10, 0.02)), M.accent, g, [0, y + 0.07, z]);
    } else if (s === 'button') {                                            // low double deck
      mesh(G(roundedBox(w * 0.7, 0.045, 0.16, 0.02)), M.accent, g, [0, y + 0.17, z], [0.2, 0, 0]);
      for (const sx of [-1, 1]) mesh(G(roundedBox(0.045, 0.17, 0.10, 0.02)), M.accent, g, [sx * w * 0.3, y + 0.09, z]);
    }
  }

  // Short, slightly splayed pylons rooted on the rear deck. Splaying them outward
  // (rather than running them vertically at the body's own width) is what stops
  // the assembly reading as a goalpost: the pylons now trace the same widening
  // fan as the rear tyres.
  function wingPylons(g, topY, mat1, xTop, thick = 0.07) {
    for (const sx of [-1, 1]) {
      const h = topY - DECK_Y;
      const p = mesh(G(roundedBox(thick, h * 1.03, 0.15, 0.03)), mat1, g,
        [sx * (xTop * 0.72), DECK_Y + h / 2, WING_Z - 0.02]);
      p.rotation.z = -sx * 0.20;      // lean outward toward the wing tips
      p.castShadow = shadows;
    }
  }

  // One aerofoil element: a flat plank with a slight angle of attack, plus a
  // contrasting leading-edge strip so the element separates from the one below it.
  function wingElement(g, w, y, z, thick, tilt, m, trimMat) {
    const el = mesh(G(roundedBox(w, thick, 0.30, thick * 0.42)), m, g, [0, y, z], [tilt, 0, 0]);
    el.castShadow = shadows;
    if (trimMat && !LOW) mesh(G(roundedBox(w * 0.98, thick * 0.55, 0.07, thick * 0.2)), trimMat, g,
      [0, y + thick * 0.6, z - 0.13], [tilt, 0, 0]);
    return el;
  }

  function buildWing(tier) {
    const g = slotGrp.wing;
    if (tier === 0) {
      // A grey cardboard plank wired onto one bent coat-hanger and taped to the
      // seat back with the other end drooping. Deliberately asymmetric: the
      // left-hand strut is missing entirely, so the whole thing hangs sideways.
      const hangY = 1.00;
      const p = mesh(G(new THREE.CylinderGeometry(0.018, 0.018, hangY - 0.42, 5)), M.rust, g,
        [0.30, (hangY + 0.42) / 2, WING_Z], [0, 0, 0.30]);
      p.castShadow = shadows;
      // the "replacement" strut on the other side: a stub that does not reach
      mesh(G(new THREE.CylinderGeometry(0.016, 0.016, 0.24, 5)), M.rust, g, [-0.30, 0.56, WING_Z], [0, 0, -0.5]);
      const plank = mesh(G(roundedBox(0.92, 0.05, 0.26, 0.015)), M.cardboard, g, [0.03, hangY, WING_Z], [0.10, 0.10, 0.34]);
      wobblers.push(Object.assign(plank, { userData: { junk: true } }));
      const droop = mesh(G(roundedBox(0.36, 0.04, 0.22, 0.012)), M.cardboard, g, [-0.46, hangY - 0.14, WING_Z], [0, 0.1, 0.62]);
      wobblers.push(Object.assign(droop, { userData: { junk: true } }));
      // duct-tape X, the gag prop
      for (const a of [0.7, -0.7]) mesh(G(roundedBox(0.24, 0.055, 0.03, 0.008)), M.tape, g, [0.26, hangY + 0.03, WING_Z - 0.14], [0, 0, a]);
    } else if (tier === 1) {
      // one element, body-coloured, narrower than the rear track
      const W = 1.06;
      wingPylons(g, WING_Y - 0.06, M.frame, W / 2, 0.065);
      wingElement(g, W, WING_Y - 0.04, WING_Z, 0.065, 0.16, M.body, null);
      for (const sx of [-1, 1]) mesh(G(roundedBox(0.05, 0.20, 0.30, 0.02)), M.accent, g, [sx * (W / 2), WING_Y, WING_Z]);
      wingTag(g, WING_Y - 0.01, WING_Z, W);
    } else if (tier === 2) {
      // two elements on a wider span, with tall accent endplates and a gurney
      // strip — obviously a step up from tier 1 without changing kind
      const W = 1.30;
      wingPylons(g, WING_Y, M.frame, W / 2, 0.075);
      wingElement(g, W, WING_Y, WING_Z, 0.075, 0.18, M.body, M.accent);
      wingElement(g, W * 0.94, WING_Y - 0.20, WING_Z + 0.08, 0.055, 0.30, M.accent, null);
      for (const sx of [-1, 1]) {
        mesh(G(roundedBox(0.055, 0.36, 0.42, 0.035)), M.accent, g, [sx * (W / 2), WING_Y - 0.10, WING_Z]);
        mesh(G(roundedBox(0.06, 0.05, 0.34, 0.02)), M.chrome, g, [sx * (W / 2), WING_Y + 0.06, WING_Z]);
      }
      wingTag(g, WING_Y + 0.04, WING_Z, W);
    } else {
      // Hero tier: a three-element full-span wing on polished chrome swan-necks,
      // with gold-anodised endplate trim and upswept winglets. The read is
      // "wide, layered, jewelled" in a still frame — no bloom required.
      const W = 1.56;
      for (const sx of [-1, 1]) {
        const neck = mesh(G(new THREE.TorusGeometry(0.40, 0.045, 4, LOW ? 8 : 16, Math.PI * 0.55)), M.chromeHi, g,
          [sx * 0.50, 0.78, WING_Z - 0.26], [0, Math.PI / 2, -0.85]);
        neck.castShadow = shadows;
        // outer stay running from the deck out to the tip
        const stay = mesh(G(new THREE.CylinderGeometry(0.026, 0.026, 0.86, LOW ? 5 : 8)), M.chromeHi, g,
          [sx * 0.58, 0.82, WING_Z + 0.04]);
        stay.rotation.z = -sx * 0.34;
      }
      // The main element sits only 2cm above WING_Y. At +0.10 its trailing edge cut
      // straight across the driver's shoulder pads from the chase camera; the tier
      // is carried by span, element count and chrome, so the altitude is free to
      // give back to the driver.
      wingElement(g, W, WING_Y + 0.02, WING_Z, 0.085, 0.20, M.body, M.gold);
      wingElement(g, W * 0.96, WING_Y - 0.21, WING_Z + 0.07, 0.065, 0.32, M.accent, M.gold);
      const edge = mesh(G(roundedBox(W * 1.01, 0.035, 0.06, 0.015)), M.glow, g, [0, WING_Y - 0.02, WING_Z - 0.15], [0.2, 0, 0]);
      coreGlow.push(edge);
      for (const sx of [-1, 1]) {
        // big swept endplate, gold-rimmed
        mesh(G(roundedBox(0.065, 0.60, 0.50, 0.05)), M.accent, g, [sx * (W / 2), WING_Y - 0.16, WING_Z]);
        mesh(G(roundedBox(0.075, 0.055, 0.50, 0.025)), M.gold, g, [sx * (W / 2), WING_Y + 0.13, WING_Z]);
        mesh(G(roundedBox(0.075, 0.30, 0.055, 0.02)), M.gold, g, [sx * (W / 2), WING_Y - 0.14, WING_Z - 0.23]);
        // upswept winglets past the endplate — the widest point on the whole wing
        mesh(G(roundedBox(0.26, 0.045, 0.15, 0.02)), M.chromeHi, g, [sx * (W / 2 + 0.11), WING_Y + 0.24, WING_Z], [0, 0, sx * 0.55]);
      }
      wingTag(g, WING_Y + 0.07, WING_Z, W);
    }
  }

  // --- engine block -----------------------------------------------
  // THE hard slot. The engine lives at z ≈ 0.86, directly behind the seat back and
  // directly in front of the rear number plate and the wing pylons, so anything
  // that stays inside the block's own footprint is occluded from the chase camera.
  // The fix is not to move the base kart out of the way — it is to make the
  // UPGRADE grow out of the occluded volume: every tier above 0 puts its added
  // mass either ABOVE the deck line (y > 0.95, clear of the seat back and above
  // the wing's leading edge) or OUTBOARD of |x| > 0.30 (clear of the number plate,
  // silhouetted against the rear tyres). Intake stacks and a supercharger do this
  // naturally, which is why the ramp is built out of them.
  const ENG_Y = 0.74;
  const DECK_CLEAR = 0.98;    // anything above this is unoccluded from behind
  function buildEngine(tier) {
    const g = slotGrp.engine;
    const z = 0.86;
    // mounting posts down to the tub, so the raised block reads as bolted on
    for (const sx of [-1, 1]) mesh(G(roundedBox(0.08, 0.34, 0.12, 0.03)), M.frame, g, [sx * 0.16, 0.50, z]);

    // An open-ended intake trumpet: chrome, above the deck, unmissable from behind.
    // `tilt` rakes the stack backwards (toward the camera) and `lean` splays it
    // outboard, so a bank of them fans away from the driver's head instead of
    // standing up in front of it.
    const trumpet = (x, y, zz, rTop, rBot, len, tilt = 0.1, lean = 0) => {
      // the tip of a raked+splayed stack moves; place the tip ring where it lands
      const ux = -Math.sin(lean), uy = Math.cos(lean) * Math.cos(tilt), uz = Math.cos(lean) * Math.sin(tilt);
      const t = mesh(G(new THREE.CylinderGeometry(rTop, rBot, len, LOW ? 6 : 12, 1, true)), M.chromeOpen, g,
        [x + ux * len / 2, y + uy * len / 2, zz + uz * len / 2], [tilt, 0, lean]);
      t.castShadow = shadows;
      if (!LOW) mesh(G(new THREE.TorusGeometry(rTop, rTop * 0.16, 4, LOW ? 6 : 12)), M.chromeHi, g,
        [x + ux * len, y + uy * len, zz + uz * len], [Math.PI / 2 + tilt, 0, lean]);
      return t;
    };
    // A ribbed blower drum lying across the kart (axis along X). It is placed by
    // its CENTRE x so the tier-2/3 engines can run two short outboard drums with a
    // clear central channel between them rather than one bar across the sightline.
    const blower = (cx, y, r, len, drumMat, ribMat, ribs) => {
      const d = mesh(G(new THREE.CylinderGeometry(r, r, len, LOW ? 8 : 16)), drumMat, g, [cx, y, z], [0, 0, Math.PI / 2]);
      d.castShadow = shadows;
      if (!LOW) for (let i = 0; i < ribs; i++) {
        mesh(G(new THREE.TorusGeometry(r * 1.04, r * 0.075, 4, 14)), ribMat, g,
          [cx + (-0.5 + (i + 0.5) / ribs) * len, y, z], [0, 0, Math.PI / 2]);
      }
      return d;
    };
    // Everything an upgraded engine adds above the deck must stay OUTSIDE this
    // half-width: the driver's helmet is ~0.23 wide and the chase camera looks
    // straight down the centre line. A kart with no visible person in it loses the
    // toy charm the whole art direction rests on, so the sightline is inviolable.
    const CHANNEL = 0.30;

    if (tier === 0) {
      // A dented tin can strapped on with tape, with a coat-hanger throttle
      // linkage flapping off the top. Small, low and crooked — the silhouette
      // says "there is barely an engine here", which is the joke.
      const can = mesh(G(new THREE.CylinderGeometry(0.16, 0.18, 0.28, LOW ? 6 : 12)), M.cardboard, g, [0.03, ENG_Y - 0.06, z]);
      can.rotation.z = 0.14;
      wobblers.push(Object.assign(can, { userData: { junk: true } }));
      mesh(G(new THREE.TorusGeometry(0.16, 0.028, 4, LOW ? 6 : 12)), M.tape, g, [0.03, ENG_Y - 0.02, z], [Math.PI / 2, 0.1, 0]);
      // bent coat-hanger sticking out of the top, and a floppy rubber hose
      mesh(G(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 5)), M.rust, g, [0.14, ENG_Y + 0.16, z + 0.04], [0.5, 0, -0.5]);
      const hose = mesh(G(capsule(0.035, 0.30, 6)), M.dark, g, [-0.22, ENG_Y + 0.02, z + 0.06], [0.4, 0, 1.15]);
      wobblers.push(Object.assign(hose, { userData: { junk: true } }));
      // a lonely cardboard funnel where a real intake would be
      const fun = mesh(G(new THREE.CylinderGeometry(0.10, 0.045, 0.16, LOW ? 6 : 10, 1, true)), M.cardboard, g,
        [0.03, ENG_Y + 0.18, z], [0.3, 0, 0.25]);
      fun.material = M.cardboard;
      wobblers.push(Object.assign(fun, { userData: { junk: true } }));
    } else if (tier === 1) {
      // A real block with cooling fins and ONE upright chrome intake stack that
      // clears the deck line. From behind this is a single bright vertical pip
      // above the seat — small, but unambiguously present.
      mesh(G(roundedBox(0.42, 0.40, 0.42, 0.09)), M.dark, g, [0, ENG_Y, z]);
      for (let i = 0; i < 4; i++) mesh(G(roundedBox(0.46, 0.035, 0.40, 0.015)), M.frame, g, [0, ENG_Y - 0.13 + i * 0.09, z]);
      mesh(G(roundedBox(0.30, 0.10, 0.34, 0.04)), M.frame, g, [0, ENG_Y + 0.24, z]);
      // The stack has to clear this tier's own wing (top ≈ 1.09) with margin, or
      // the whole upgrade is hidden by the part in front of it — which is exactly
      // the failure the old engine slot had. It also sits outboard of CHANNEL and
      // leans away, so it flanks the helmet instead of standing over it.
      trumpet(CHANNEL + 0.06, DECK_CLEAR + 0.02, z, 0.105, 0.07, 0.34, 0.22, -0.20);   // tip ≈ 1.33
    } else if (tier === 2) {
      // A supercharged block. The blower is SPLIT into two short ribbed drums, one
      // outboard of each shoulder, and the FOUR stacks are two raked banks of two
      // sitting on top of them. The cluster is still twice as wide and twice as
      // tall as tier 1's single pipe, but the mass is now either side of the
      // helmet instead of stacked in front of it.
      mesh(G(roundedBox(0.46, 0.46, 0.48, 0.10)), M.dark, g, [0, ENG_Y + 0.02, z]);
      for (let i = 0; i < 5; i++) mesh(G(roundedBox(0.50, 0.03, 0.46, 0.012)), M.chrome, g, [0, ENG_Y - 0.16 + i * 0.085, z]);
      for (const sx of [-1, 1]) blower(sx * 0.40, DECK_CLEAR + 0.06, 0.135, 0.28, M.frame, M.chrome, 3);
      // low chrome crossover joining the two drums UNDER the sightline, so the pair
      // still reads as one supercharger rather than two unrelated cans
      mesh(G(new THREE.CylinderGeometry(0.055, 0.055, 0.56, LOW ? 6 : 10)), M.chrome, g,
        [0, DECK_CLEAR - 0.06, z + 0.05], [0, 0, Math.PI / 2]);
      for (const sx of [-1, 1]) for (const i of [0, 1]) {
        trumpet(sx * (CHANNEL + 0.05 + i * 0.17), DECK_CLEAR + 0.15, z + i * 0.05,
          0.068, 0.048, 0.21, 0.26, -sx * 0.24);                                   // tips ≈ 1.34
      }
      for (const sx of [-1, 1]) {
        mesh(G(roundedBox(0.14, 0.26, 0.34, 0.05)), M.accent, g, [sx * 0.34, ENG_Y + 0.10, z]);
        mesh(G(new THREE.CylinderGeometry(0.05, 0.05, 0.30, LOW ? 5 : 8)), M.chrome, g, [sx * 0.44, 0.88, z + 0.06], [0, 0, -sx * 0.5]);
      }
    } else {
      // Hero tier: polished twin blowers with a gold drive pulley, SIX stacks in
      // two raked banks reaching y ≈ 1.50, and twin turbos slung outboard with
      // chrome crossover pipes arcing up over the deck. This is a genuine
      // silhouette change — the kart grows a machine on its back — and every
      // added element is either above 0.98 or outboard of the plate. Critically,
      // the whole machine is built as two outboard banks with an open channel
      // down the middle, so the driver still reads from the chase camera.
      mesh(G(roundedBox(0.48, 0.46, 0.48, 0.13)), M.dark, g, [0, ENG_Y, z]);
      for (const sx of [-1, 1]) mesh(G(roundedBox(0.06, 0.36, 0.44, 0.03)), M.gold, g, [sx * 0.25, ENG_Y + 0.04, z]);
      // caged core, still there, but now a jewel inside the machine rather than
      // the only thing carrying the tier
      const core = mesh(G(new THREE.IcosahedronGeometry(0.13, LOW ? 0 : 1)), M.glow, g, [0, ENG_Y + 0.02, z - 0.16]);
      core.userData.spin = true; core.userData.pulse = true;
      coreGlow.push(core);
      for (const sx of [-1, 1]) blower(sx * 0.45, DECK_CLEAR + 0.13, 0.165, 0.32, M.chromeHi, M.gold, 3);
      // gold drive pulley + belt on the OUTER face of the left blower, where the
      // chase camera sees it in profile against the sky
      mesh(G(new THREE.CylinderGeometry(0.15, 0.15, 0.05, LOW ? 8 : 16)), M.gold, g, [-0.64, DECK_CLEAR + 0.13, z], [0, 0, Math.PI / 2]);
      mesh(G(new THREE.TorusGeometry(0.115, 0.02, 4, LOW ? 8 : 14)), M.goldDark, g, [-0.67, DECK_CLEAR + 0.03, z], [0, Math.PI / 2, 0]);
      // gold-trimmed plenum bridging the two drums, kept BELOW the sightline
      mesh(G(roundedBox(0.62, 0.10, 0.30, 0.04)), M.gold, g, [0, DECK_CLEAR - 0.03, z + 0.04]);
      for (const sx of [-1, 1]) for (const i of [0, 1, 2]) {
        trumpet(sx * (CHANNEL + 0.05 + i * 0.14), DECK_CLEAR + 0.24, z + (i - 1) * 0.05,
          0.068, 0.048, 0.26, 0.28, -sx * 0.26);                                       // tips ≈ 1.48
      }
      for (const sx of [-1, 1]) {
        // turbo: snail housing outboard, chrome crossover arcing back over the deck
        const snail = mesh(G(new THREE.CylinderGeometry(0.135, 0.135, 0.16, LOW ? 8 : 14)), M.chromeHi, g,
          [sx * 0.46, 0.80, z + 0.02], [0, 0, Math.PI / 2]);
        snail.castShadow = shadows;
        mesh(G(new THREE.TorusGeometry(0.135, 0.032, 4, LOW ? 8 : 14)), M.gold, g, [sx * 0.46, 0.80, z + 0.02], [0, 0, Math.PI / 2]);
        const pipe = mesh(G(new THREE.TorusGeometry(0.20, 0.045, 4, LOW ? 8 : 14, Math.PI * 0.72)), M.chromeHi, g,
          [sx * 0.46, 0.88, z + 0.02], [0, Math.PI / 2, sx > 0 ? -0.4 : Math.PI + 0.4]);
        pipe.castShadow = shadows;
        // wastegate screamer poking up and out
        mesh(G(new THREE.CylinderGeometry(0.045, 0.055, 0.26, LOW ? 6 : 10)), M.chromeHi, g,
          [sx * 0.62, 1.06, z - 0.04], [0, 0, sx * 0.30]);
      }
      const halo = mesh(G(new THREE.TorusGeometry(0.30, 0.03, 4, LOW ? 10 : 20)), M.glow, g, [0, ENG_Y + 0.02, z - 0.16], [Math.PI / 2, 0, 0]);
      coreGlow.push(halo);
    }
  }

  // --- exhaust ------------------------------------------------------
  function buildExhaust(tier) {
    const g = slotGrp.exhaust;
    const mk = (x, y, z, len, rot, m) => mesh(G(new THREE.CylinderGeometry(0.055, 0.062, len, LOW ? 6 : 10)), m, g, [x, y, z], rot);
    const flame = (x, y, z, s) => {
      const fg = G(new THREE.ConeGeometry(0.062 * s, 0.30 * s, LOW ? 6 : 10));
      fg.translate(0, 0.15 * s, 0);                  // grow backwards out of the pipe
      const f = new THREE.Mesh(fg, M.flame);
      f.position.set(x, y, z);
      f.rotation.x = Math.PI / 2;                    // tip points backwards (+Z)
      f.visible = false;
      f.castShadow = false;
      g.add(f);
      flames.push(f);
      return f;
    };
    // The pipes are pushed OUTBOARD as the tier rises (|x| 0.34 → 0.52 → 0.66), out
    // over the rear tyres where the number plate, the seat and the wing pylons
    // cannot hide them, and the tip diameter roughly doubles across the ramp. From
    // behind, the exhaust is a pair of bright chrome ears growing away from the
    // body — a width cue, which survives distance far better than a detail cue.
    // A megaphone tip: open cone, flared mouth, with an optional coloured tip ring.
    // open-ended cones must be double-sided or the mouth renders as a hole
    const openOf = m => (m === M.gold ? M.goldOpen : M.chromeOpen);
    const megaphone = (x, y, z, rIn, rOut, len, tilt, m, ringMat, ringR) => {
      const c = mesh(G(new THREE.CylinderGeometry(rOut, rIn, len, LOW ? 8 : 14, 1, true)), openOf(m), g, [x, y, z], [Math.PI / 2 + tilt, 0, 0]);
      c.castShadow = shadows;
      // The mouth needs a dark bore or the lit backfaces make the pipe read as a
      // pale ring — a doughnut stuck to the side of the kart rather than a pipe.
      const ax = [0, -Math.sin(tilt), Math.cos(tilt)];
      const bore = mesh(G(new THREE.CircleGeometry(rOut * 0.9, LOW ? 8 : 14)), M.dark, g,
        [x + ax[0] * len * 0.36, y + ax[1] * len * 0.36, z + ax[2] * len * 0.36], [tilt, 0, 0]);
      bore.castShadow = false;
      if (ringMat && !LOW) mesh(G(new THREE.TorusGeometry(ringR ?? rOut, rOut * 0.16, 4, LOW ? 8 : 14)), ringMat, g,
        [x + ax[0] * len * 0.5, y + ax[1] * len * 0.5, z + ax[2] * len * 0.5], [tilt, 0, 0]);
      return c;
    };
    if (tier === 0) {
      // ONE bent, rusty, tape-wrapped pipe on the right and nothing on the left.
      // The asymmetry is the gag and it reads from directly behind.
      const p = mk(0.34, 0.80, 1.00, 0.50, [1.0, 0, 0.45], M.rust);
      p.material = M.rust;
      wobblers.push(Object.assign(p, { userData: { junk: true } }));
      for (const t of [0, 1]) mesh(G(new THREE.TorusGeometry(0.062, 0.026, 4, 8)), M.tape, g,
        [0.40 + t * 0.03, 0.92 + t * 0.09, 1.14 + t * 0.06], [Math.PI / 2 + 0.4, 0, 0]);
      // the stub where the other pipe used to be, blanked off with tape
      mesh(G(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 6)), M.rust, g, [-0.32, 0.62, 1.02], [1.1, 0, 0]);
      mesh(G(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 6)), M.tape, g, [-0.32, 0.67, 1.07], [1.1, 0, 0]);
      flame(0.44, 1.00, 1.26, 0.7);
    } else if (tier === 1) {
      // a tidy chrome pair, tucked inboard of the rear tyres
      for (const sx of [-1, 1]) {
        mk(sx * 0.44, 0.80, 0.98, 0.52, [1.14, 0, -sx * 0.26], M.chrome);
        megaphone(sx * 0.62, 0.92, 1.18, 0.062, 0.085, 0.18, -0.34, M.chrome, null);
        flame(sx * 0.63, 0.96, 1.31, 0.85);
      }
    } else if (tier === 2) {
      // Four pipes bundled into two accent-tipped megaphones that now exit
      // OUTBOARD of the rear tyre, silhouetted against open ground instead of
      // against the kart's own bodywork. The kart visibly gets wider.
      for (const sx of [-1, 1]) {
        for (const i of [0, 1]) mk(sx * (0.40 + i * 0.16), 0.78 + i * 0.05, 0.96, 0.54, [1.10, 0, -sx * (0.32 + i * 0.12)], M.chrome);
        const coll = mesh(G(new THREE.CylinderGeometry(0.085, 0.072, 0.34, LOW ? 8 : 12)), M.chrome, g,
          [sx * 0.80, 0.72, 0.98], [Math.PI / 2 + 0.16, 0, -sx * 0.18]);
        coll.castShadow = shadows;
        megaphone(sx * 0.86, 0.80, 1.22, 0.078, 0.110, 0.26, -0.30, M.chrome, M.accent, 0.110);
        flame(sx * 0.87, 0.83, 1.36, 0.9);
      }
    } else {
      // Hero tier: twin chrome cannons slung just outside the rear tyres with gold
      // mouth rings, plus a stacked pair of smaller stingers above them. Still the
      // widest, brightest thing on the back of the kart after the wing — but the
      // cannons used to sit at |x| = 1.08 with a 0.175 mouth, which put the kart at
      // ~2.5 m across and made it read as a monster truck next to tier 0. Pulled
      // back to |x| = 0.94 with a smaller mouth: expensive and fast, not oversized.
      for (const sx of [-1, 1]) {
        for (const i of [0, 1, 2]) mk(sx * (0.36 + i * 0.13), 0.74 + i * 0.05, 0.92, 0.60, [1.08, 0, -sx * (0.36 + i * 0.11)], M.chromeHi);
        const collector = mesh(G(new THREE.CylinderGeometry(0.105, 0.09, 0.40, LOW ? 8 : 14)), M.chromeHi, g,
          [sx * 0.88, 0.78, 0.96], [Math.PI / 2 + 0.16, 0, -sx * 0.20]);
        collector.castShadow = shadows;
        megaphone(sx * 0.94, 0.86, 1.26, 0.095, 0.150, 0.30, -0.26, M.chromeHi, M.gold, 0.150);
        const ring = mesh(G(new THREE.TorusGeometry(0.095, 0.028, 4, LOW ? 8 : 16)), M.glow, g, [sx * 0.95, 0.88, 1.36], [0.2, 0, 0]);
        coreGlow.push(ring);
        flame(sx * 0.95, 0.89, 1.40, 1.0);
        // small upper stinger, stacked above the cannon
        mesh(G(new THREE.CylinderGeometry(0.05, 0.058, 0.34, LOW ? 6 : 10)), M.chromeHi, g,
          [sx * 0.80, 1.10, 1.02], [Math.PI / 2 + 0.32, 0, -sx * 0.24]);
        megaphone(sx * 0.86, 1.22, 1.18, 0.055, 0.082, 0.14, -0.28, M.gold, null);
        flame(sx * 0.87, 1.25, 1.28, 0.7);
      }
    }
  }

  // --- chassis dress ------------------------------------------------
  // A rear diffuser: a wide angled panel under the rear bumper with vertical
  // strakes. This is the chassis slot's rear-visible payload — side skirts are
  // almost invisible from directly behind, but a toothed band sitting in the
  // shadow under the tail is a strong dark/light pattern the eye picks up
  // immediately, and its width and tooth count can carry the whole tier ramp.
  function diffuser(g, w, nStrakes, panelMat, strakeMat, dropY) {
    const z = 1.16;
    const panel = mesh(G(roundedBox(w, 0.05, 0.34, 0.02)), panelMat, g, [0, dropY + 0.10, z], [-0.42, 0, 0]);
    panel.castShadow = shadows;
    if (LOW) return;
    for (let i = 0; i < nStrakes; i++) {
      const x = (-0.5 + (i + 0.5) / nStrakes) * w;
      mesh(G(roundedBox(0.035, 0.20, 0.30, 0.015)), strakeMat, g, [x, dropY + 0.06, z], [-0.42, 0, 0]);
    }
  }

  // The chassis slot's SILHOUETTE payload: a roll hoop behind the driver.
  //
  // Skirts and a diffuser sit low, in the kart's own shadow, and half of them
  // hide behind the rear tyres — measured against the garage's preview window,
  // chassis 0 → 3 moved 2.4% of the pixels against a noise floor of ~2%, i.e.
  // the one slot whose upgrade a child could not see at all. A hoop is the
  // opposite kind of shape: it stands clear of the bodywork against open
  // background, so its height, width and material carry the tier from every
  // angle the game ever shows, including the small side window in the garage.
  function rollHoop(g, w, top, tube, matUp, matTop, brace) {
    const seg = LOW ? 5 : 8;
    const z = 0.62, footY = 0.44;
    for (const sx of [-1, 1]) {
      const post = mesh(G(new THREE.CylinderGeometry(tube, tube * 1.12, top - footY, seg)), matUp, g,
        [sx * w, (top + footY) / 2, z], [0, 0, -sx * 0.06]);
      post.castShadow = shadows;
      if (brace) {
        const bl = 0.52;
        const arm = mesh(G(new THREE.CylinderGeometry(tube * 0.72, tube * 0.72, bl, seg)), matUp, g,
          [sx * (w + 0.05), top - 0.30, z + bl * 0.42], [0.86, 0, -sx * 0.12]);
        arm.castShadow = shadows;
      }
    }
    const bar = mesh(G(new THREE.CylinderGeometry(tube, tube, w * 2, seg)), matTop || matUp, g,
      [0, top, z], [0, 0, Math.PI / 2]);
    bar.castShadow = shadows;
    return bar;
  }

  // …and the chassis slot's FRONT-visible payload. The garage previews the kart
  // nose-on, which is the one angle from which skirts, diffuser and hoop all but
  // vanish; a front splitter is the widest thing on the kart at exactly that
  // angle, so its span and its end fins carry the tier there.
  function splitter(g, w, panelMat, edgeMat, nFins) {
    const z = -1.44, y = 0.135;
    const blade = mesh(G(roundedBox(w, 0.045, 0.30, 0.018)), panelMat, g, [0, y, z], [0.06, 0, 0]);
    blade.castShadow = shadows;
    mesh(G(roundedBox(w * 0.96, 0.035, 0.06, 0.014)), edgeMat, g, [0, y + 0.05, z - 0.12]);
    for (let i = 0; i < nFins; i++) {
      const sx = i % 2 ? 1 : -1;
      const f = 0.30 + 0.16 * Math.floor(i / 2);
      mesh(G(roundedBox(0.03, 0.15, 0.24, 0.012)), edgeMat, g, [sx * w * f, y + 0.08, z], [0, sx * 0.12, 0]);
    }
    return blade;
  }

  // Rear fender flares. The garage's preview window looks straight at the back of
  // the kart, where the skirts hide behind the tyres and the diffuser hides in
  // the tail's own shadow — so the tier ramp also runs across the top of the rear
  // wheels, which is open background from that angle and from the chase camera.
  function flares(g, y, w, panelMat, edgeMat) {
    for (const sx of [-1, 1]) {
      const top = mesh(G(roundedBox(w, 0.055, 0.80, 0.025)), panelMat, g,
        [sx * (REAR_X + 0.02), y, REAR_Z], [0, 0, -sx * 0.09]);
      top.castShadow = shadows;
      mesh(G(roundedBox(0.05, 0.20, 0.72, 0.02)), edgeMat, g,
        [sx * (REAR_X + w * 0.48), y - 0.09, REAR_Z], [0, 0, -sx * 0.09]);
      // inboard stay, tying the flare back to the bodywork
      mesh(G(roundedBox(0.20, 0.045, 0.09, 0.018)), edgeMat, g,
        [sx * (REAR_X - w * 0.5 - 0.06), y - 0.03, REAR_Z + 0.24], [0, 0, -sx * 0.09]);
    }
  }

  function buildChassisKit(tier) {
    const g = slotGrp.chassis;
    if (tier === 0) {
      // Mismatched cardboard patch panels, taped on crooked — and only one of
      // them reaches the ground. A flattened box is wedged under the tail where a
      // diffuser should be, and it drags.
      for (const sx of [-1, 1]) {
        const p = mesh(G(roundedBox(0.05, sx > 0 ? 0.28 : 0.16, sx > 0 ? 0.64 : 0.40, 0.02)), M.cardboard, g,
          [sx * 0.58, 0.34, -0.10], [0, 0, sx * 0.34]);
        wobblers.push(Object.assign(p, { userData: { junk: true } }));
      }
      const flap = mesh(G(roundedBox(0.46, 0.04, 0.28, 0.015)), M.cardboard, g, [0.08, 0.50, -1.05], [0.18, 0.14, 0.10]);
      wobblers.push(Object.assign(flap, { userData: { junk: true } }));
      // the dragging cardboard "diffuser", one corner folded up
      const drag = mesh(G(roundedBox(0.76, 0.035, 0.42, 0.012)), M.cardboard, g, [-0.06, 0.13, 1.20], [-0.30, 0.12, 0.16]);
      wobblers.push(Object.assign(drag, { userData: { junk: true } }));
      for (const a of [0.8, -0.8]) mesh(G(roundedBox(0.20, 0.05, 0.03, 0.008)), M.tape, g, [-0.58, 0.40, -0.12], [0, Math.PI / 2, a]);
      mesh(G(roundedBox(0.26, 0.05, 0.03, 0.008)), M.tape, g, [0.16, 0.20, 1.06], [0, 0, 0.3]);
      // Where the roll hoop should be: one rusted stub leaning out of its socket,
      // with the other side snapped off and taped over. Reads as "there is
      // supposed to be something here" — the shape the next three tiers finish.
      const stub = mesh(G(new THREE.CylinderGeometry(0.026, 0.030, 0.46, LOW ? 5 : 8)), M.rust, g,
        [-0.30, 0.66, 0.62], [0.16, 0, 0.42]);
      wobblers.push(Object.assign(stub, { userData: { junk: true } }));
      mesh(G(new THREE.CylinderGeometry(0.030, 0.030, 0.07, LOW ? 5 : 8)), M.tape, g, [0.30, 0.47, 0.62]);
      mesh(G(roundedBox(0.30, 0.05, 0.03, 0.008)), M.tape, g, [-0.28, 0.55, 0.60], [0, 0, 1.1]);
    } else if (tier === 1) {
      for (const sx of [-1, 1]) mesh(G(roundedBox(0.07, 0.14, 0.96, 0.03)), M.bodyDark, g, [sx * 0.55, 0.21, -0.05]);
      diffuser(g, 0.86, 3, M.bodyDark, M.dark, 0.06);
      rollHoop(g, 0.30, 1.14, 0.030, M.frame, M.frame, false);
      splitter(g, 0.94, M.bodyDark, M.dark, 0);
      flares(g, 0.90, 0.34, M.bodyDark, M.dark);
    } else if (tier === 2) {
      for (const sx of [-1, 1]) {
        mesh(G(roundedBox(0.10, 0.18, 1.16, 0.045)), M.accent, g, [sx * 0.56, 0.21, -0.02]);
        // flared skirt end, kicked out behind the rear axle so the kart widens
        // toward the camera rather than staying a parallel slab
        mesh(G(roundedBox(0.09, 0.20, 0.34, 0.04)), M.accent, g, [sx * 0.66, 0.22, 0.62], [0, -sx * 0.22, 0]);
        mesh(G(roundedBox(0.16, 0.05, 0.34, 0.02)), M.bodyDark, g, [sx * 0.55, 0.31, -0.66], [0, 0, sx * 0.2]);
      }
      mesh(G(roundedBox(1.02, 0.05, 0.26, 0.02)), M.bodyDark, g, [0, 0.19, -1.24]);
      diffuser(g, 1.12, 5, M.bodyDark, M.accent, 0.04);
      // taller, braced, and the top bar goes accent-coloured: same shape, plainly
      // one step up
      rollHoop(g, 0.355, 1.35, 0.036, M.frame, M.accent, true);
      mesh(G(roundedBox(0.62, 0.05, 0.05, 0.02)), M.accent, g, [0, 1.06, 0.62]);
      splitter(g, 1.20, M.bodyDark, M.accent, 2);
      flares(g, 0.97, 0.46, M.body, M.accent);
      // rear tie-bar across the tail, above the number plate
      mesh(G(roundedBox(1.08, 0.075, 0.10, 0.03)), M.accent, g, [0, 0.85, 1.10]);
      for (const sx of [-1, 1]) mesh(G(roundedBox(0.30, 0.035, 0.16, 0.015)), M.accent, g, [sx * 0.44, 0.40, -1.10], [0, 0, sx * 0.30]);
    } else {
      for (const sx of [-1, 1]) {
        mesh(G(roundedBox(0.12, 0.20, 1.30, 0.06)), M.accent, g, [sx * 0.57, 0.22, -0.02]);
        mesh(G(roundedBox(0.11, 0.22, 0.44, 0.05)), M.accent, g, [sx * 0.72, 0.23, 0.66], [0, -sx * 0.26, 0]);
        mesh(G(roundedBox(0.13, 0.05, 0.44, 0.02)), M.gold, g, [sx * 0.72, 0.35, 0.66], [0, -sx * 0.26, 0]);
        const strip = mesh(G(roundedBox(0.04, 0.05, 1.16, 0.02)), M.glow, g, [sx * 0.625, 0.14, -0.02]);
        coreGlow.push(strip);
        // canard fins on the nose
        mesh(G(roundedBox(0.28, 0.035, 0.16, 0.015)), M.chromeHi, g, [sx * 0.46, 0.40, -1.10], [0, 0, sx * 0.36]);
      }
      mesh(G(roundedBox(1.10, 0.05, 0.30, 0.02)), M.chromeHi, g, [0, 0.17, -1.28]);
      diffuser(g, 1.38, 7, M.chromeHi, M.gold, 0.02);
      // Hero hoop: full-height polished cage with a gold crown bar, an X brace
      // in the opening and a light line along the top edge.
      rollHoop(g, 0.40, 1.54, 0.042, M.chromeHi, M.gold, true);
      for (const s of [-1, 1]) {
        mesh(G(new THREE.CylinderGeometry(0.022, 0.022, 0.92, LOW ? 5 : 8)), M.chromeHi, g,
          [0, 0.98, 0.615], [0, 0, s * 0.72]);
      }
      const crown = mesh(G(roundedBox(0.80, 0.035, 0.06, 0.015)), M.glow, g, [0, 1.60, 0.62]);
      coreGlow.push(crown);
      splitter(g, 1.50, M.chromeHi, M.gold, 4);
      flares(g, 1.04, 0.62, M.chromeHi, M.gold);
      mesh(G(roundedBox(1.34, 0.09, 0.12, 0.035)), M.gold, g, [0, 0.88, 1.10]);
      for (const sx of [-1, 1]) mesh(G(roundedBox(0.07, 0.26, 0.10, 0.03)), M.chromeHi, g, [sx * 0.60, 0.74, 1.10]);
      const lip = mesh(G(roundedBox(1.34, 0.03, 0.05, 0.012)), M.glow, g, [0, 0.10, -1.56]);
      coreGlow.push(lip);
      const under = mesh(G(new THREE.PlaneGeometry(1.1, 2.2)), M.glow, g, [0, 0.06, 0], [-Math.PI / 2, 0, 0]);
      under.castShadow = false;
      coreGlow.push(under);
    }
  }

  /* ---------------- static weld (cheap AI karts only) ------------- */
  //
  // Draw calls, not triangles, are what an integrated-GPU school laptop runs out
  // of first, and a measured frame of this game spends 95% of its calls on the
  // eight karts (847 total, of which 805 are karts and 31 the entire world —
  // props.js already instances and merges). A kart is ~200 tiny meshes that
  // never move relative to one another, which is exactly the shape of thing a
  // renderer should be given as ONE mesh.
  //
  // The weld is lossless by construction: same vertices, same normals, same
  // materials, same world transforms, same shadow flags — the only thing that
  // changes is how many buffers get bound. Anything that animates is a FRAME
  // boundary and is welded only within itself:
  //   bodyPivot   roll/pitch/squat      driverPivot  leans into corners
  //   headPivot   turns                 steerPivot   turns with the wheel
  //   arm shoulders (aimed at the grips), each wheel's spin group,
  //   and the wobblers / coreGlow / flames registries, which are moved,
  //   pulsed, scaled or toggled per frame by update().
  // Concatenate a bucket of {geo, matrix} into one indexed BufferGeometry.
  function weldGeometries(items) {
    let vCount = 0, iCount = 0;
    const prepped = [];
    for (const it of items) {
      const g = it.geo.clone();
      g.applyMatrix4(it.matrix);                 // transforms normals correctly
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      vCount += n;
      iCount += g.index ? g.index.count : n;
      prepped.push(g);
    }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const uvs = new Float32Array(vCount * 2);
    const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
    let vo = 0, io = 0;
    for (const g of prepped) {
      const p = g.attributes.position, nm = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const o3 = (vo + i) * 3, o2 = (vo + i) * 2;
        pos[o3] = p.getX(i); pos[o3 + 1] = p.getY(i); pos[o3 + 2] = p.getZ(i);
        if (nm) { nor[o3] = nm.getX(i); nor[o3 + 1] = nm.getY(i); nor[o3 + 2] = nm.getZ(i); }
        if (uv) { uvs[o2] = uv.getX(i); uvs[o2 + 1] = uv.getY(i); }
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
      else for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
      vo += p.count;
      io += g.index ? g.index.count : p.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }

  // Weld every static mesh under `roots` into one mesh per material, parented to
  // `frame`. `roots` must all sit in `frame`'s own coordinate space. `stop` is
  // the set of nodes that must keep their own transform (see the note above);
  // recursion never enters one, and a mesh with a stopped descendant is left
  // exactly where it is.
  function weldFrame(frame, stop, roots = [frame]) {
    const buckets = new Map();
    const dead = [];
    const _m = () => new THREE.Matrix4();
    const holdsDynamic = obj => {
      let f = false;
      obj.traverse(o => { if (o !== obj && (stop.has(o) || o.isInstancedMesh)) f = true; });
      return f;
    };
    const collect = (obj, m) => {
      if (obj.isMesh && obj.geometry && obj.material) {
        const mm = obj.material;
        const key = `${mm.uuid}|${obj.castShadow ? 1 : 0}|${obj.receiveShadow ? 1 : 0}|${obj.renderOrder}|${obj.visible ? 1 : 0}`;
        let b = buckets.get(key);
        if (!b) {
          b = { material: mm, castShadow: obj.castShadow, receiveShadow: obj.receiveShadow,
            renderOrder: obj.renderOrder, visible: obj.visible, items: [] };
          buckets.set(key, b);
        }
        b.items.push({ geo: obj.geometry, matrix: m });
      }
      for (const c of obj.children) { c.updateMatrix(); collect(c, _m().multiplyMatrices(m, c.matrix)); }
    };
    const visit = (obj, m) => {
      for (const c of obj.children) {
        if (stop.has(c) || c.isInstancedMesh) continue;
        c.updateMatrix();
        const cm = _m().multiplyMatrices(m, c.matrix);
        if (c.isMesh && !holdsDynamic(c)) { collect(c, cm); dead.push(c); }
        else visit(c, cm);
      }
    };
    for (const r of roots) visit(r, _m());
    if (!dead.length) return;
    for (const d of dead) d.removeFromParent();
    for (const b of buckets.values()) {
      const mesh2 = new THREE.Mesh(G(weldGeometries(b.items)), b.material);
      mesh2.castShadow = b.castShadow;
      mesh2.receiveShadow = b.receiveShadow;
      mesh2.renderOrder = b.renderOrder;
      mesh2.visible = b.visible;
      mesh2.name = 'weld';
      frame.add(mesh2);
    }
  }

  // Drop the source geometries the weld orphaned. They were never uploaded to
  // the GPU (the kart is welded before its first frame), so this is CPU arrays
  // only — but it is ~200 of them per kart, times seven opponents.
  function pruneGeos() {
    const live = new Set();
    group.traverse(o => { if (o.geometry) live.add(o.geometry); });
    for (let i = geos.length - 1; i >= 0; i--) {
      if (!live.has(geos[i])) { geos[i].dispose(); geos.splice(i, 1); }
    }
  }

  // The five upgrade slots and the chassis are all identity-transform siblings
  // under bodyPivot, i.e. ONE rigid frame — so they weld together, and a body
  // that shares a material with a wing costs one draw call, not two. They cannot
  // weld into chassisGrp itself, because clearSlot() has to be able to throw the
  // slot half away again when the garage changes a part: see setParts.
  const slotWeld = MERGE ? new THREE.Group() : null;
  if (slotWeld) { slotWeld.name = 'weld:slots'; bodyPivot.add(slotWeld); }
  let chassisWelded = false;

  function weldStatics() {
    const stop = new Set([driverPivot, headPivot, steerPivot, contact, slotWeld]);
    for (const a of arms) stop.add(a.shoulder);
    for (const w of wheels) { stop.add(w.axle); stop.add(w.steer); stop.add(w.spin); }
    for (const arr of [wobblers, coreGlow, flames]) for (const o of arr) stop.add(o);

    if (!chassisWelded) {
      // The knees hang off bodyPivot directly; in the welded build they belong
      // to the same rigid frame as the chassis, so move them there first.
      for (const c of [...bodyPivot.children]) if (c.isMesh && !stop.has(c)) chassisGrp.add(c);
      weldFrame(chassisGrp, stop);
      weldFrame(driverPivot, stop);
      weldFrame(headPivot, stop);
      weldFrame(steerPivot, stop);
      for (const a of arms) weldFrame(a.shoulder, stop);
      // A wobbler is a frame of its own (update() rotates it), but whatever
      // hangs off it — the spark racer's three prongs — is static within it.
      for (const o of wobblers) weldFrame(o, stop);
      chassisWelded = true;
    }
    // The slot half is rebuilt from scratch on every parts change.
    for (const c of [...slotWeld.children]) { c.removeFromParent(); }
    weldFrame(slotWeld, stop, PART_SLOTS.map(s => slotGrp[s]).filter(Boolean));
    for (const w of wheels) if (w.visual) weldFrame(w.visual, stop);
    pruneGeos();
  }

  let api = null;

  let built = false;

  function setParts(p = {}) {
    const changed = [];
    for (const s of PART_SLOTS) {
      if (p[s] === undefined) continue;
      const t = clamp(Math.round(p[s]), 0, PART_TIERS - 1);
      if (t !== parts[s]) { parts[s] = t; changed.push(s); }
    }
    if (built && !changed.length) return api;
    // First call builds every slot. On a welded kart every LATER call does too:
    // the five slots share one welded mesh per material, so a single slot can no
    // longer be replaced on its own — the welded half is thrown away and rebuilt
    // whole. Slower than the unwelded path and never taken in the game (only the
    // garage's preview kart changes parts after construction, and it is never
    // welded), but it keeps setParts honest instead of silently stale.
    const todo = (built && !MERGE) ? changed : PART_SLOTS;
    built = true;
    for (const s of todo) {
      if (s === 'tires') { for (const w of wheels) buildTyreVisual(w, parts.tires); continue; }
      clearSlot(s);
      // slot-local glow/flame registries must drop the stale entries
      pruneDetached();
      if (s === 'wing') buildWing(parts.wing);
      else if (s === 'engine') buildEngine(parts.engine);
      else if (s === 'exhaust') buildExhaust(parts.exhaust);
      else if (s === 'chassis') buildChassisKit(parts.chassis);
    }
    if (MERGE) weldStatics();
    return api;
  }

  function pruneDetached() {
    for (const arr of [flames, coreGlow, wobblers]) {
      for (let i = arr.length - 1; i >= 0; i--) if (!arr[i].parent) arr.splice(i, 1);
    }
  }

  // initial build
  setParts(Object.assign({ engine: 1, tires: 1, wing: 1, chassis: 1, exhaust: 1 }, opts.parts || {}));

  /* ---------------- animation ------------------------------------ */
  const st = {
    steer: 0, speed: 0, prevSpeed: 0, spin: 0, drift: 0, driftDir: 1,
    air: 0, boost: 0, charge: 0, t: 0, bob: 0,
  };
  const baseGlow = M.glow.emissiveIntensity;

  function update(dt, s = {}) {
    dt = Math.min(dt || 1 / 60, 1 / 20);
    st.t += dt;
    const steerT = clamp(s.steer || 0, -1, 1);
    const speedT = clamp(s.speed01 || 0, 0, 1);
    const driftT = s.drifting ? 1 : 0;
    const airT = s.airborne ? 1 : 0;
    const boostT = s.boosting ? 1 : 0;
    st.charge = clamp(s.driftCharge01 || 0, 0, 1);
    if (s.drifting) st.driftDir = s.driftDir != null ? Math.sign(s.driftDir) || st.driftDir : (Math.abs(steerT) > 0.05 ? Math.sign(steerT) : st.driftDir);

    st.prevSpeed = st.speed;
    st.steer = approach(st.steer, steerT, 9, dt);
    st.speed = approach(st.speed, speedT, 5, dt);
    st.drift = approach(st.drift, driftT, 8, dt);
    st.air = approach(st.air, airT, 7, dt);
    st.boost = approach(st.boost, boostT, 10, dt);
    const accel = clamp((st.speed - st.prevSpeed) / Math.max(dt, 1e-4), -4, 4);

    // wheels roll — rear radius sets the reference ground speed
    st.spin += st.speed * dt * 26;
    const steerAngle = -st.steer * 0.52;    // forward is -Z, so right turn = -Y
    for (const w of wheels) {
      w.spin.rotation.x = st.spin * (w.kind === 'rear' ? 1 : RW / FW);
      if (w.kind === 'front') w.steer.rotation.y = steerAngle;
      // suspension: rear squats under power, wheels droop in the air
      const squat = w.kind === 'rear' ? -clamp(accel, 0, 2) * 0.018 : clamp(accel, 0, 2) * 0.010;
      const droop = st.air * -0.05;
      const bob = Math.sin(st.t * 14 + (w.sx > 0 ? 1.7 : 0)) * 0.006 * st.speed;
      w.axle.position.y = (w.scaleR || w.baseY) + squat + droop + bob;
    }

    // body: rolls OUT of the turn, pitches under acceleration, squats at speed
    const lean = st.steer * (0.35 + 0.65 * st.speed);
    const driftLean = st.drift * st.driftDir * 0.20;
    bodyPivot.rotation.z = lean * 0.13 + driftLean;
    bodyPivot.rotation.x = accel * 0.035 + st.air * 0.06 - st.speed * 0.012;
    bodyPivot.rotation.y = -st.drift * st.driftDir * 0.13 - st.steer * 0.02;
    bodyPivot.position.y = -st.speed * 0.02 - clamp(accel, 0, 2) * 0.012 + Math.sin(st.t * 11) * 0.006 * st.speed;
    bodyPivot.position.x = lean * 0.02;
    // boost stretch — a little squash & stretch sells acceleration
    const stretch = 1 + st.boost * 0.05;
    bodyPivot.scale.set(1 - st.boost * 0.02, 1 - st.boost * 0.015, stretch);

    // driver leans INTO the corner, opposite the chassis roll
    driverPivot.rotation.z = -lean * 0.26 - driftLean * 0.9;
    driverPivot.rotation.y = st.steer * 0.14 + st.drift * st.driftDir * 0.18;
    driverPivot.rotation.x = 0.05 + st.speed * 0.10 + st.boost * 0.10;   // tucks in at speed
    headPivot.rotation.y = -st.steer * 0.22 - st.drift * st.driftDir * 0.25;
    headPivot.rotation.z = lean * 0.10;

    // hands turn the wheel; the arms are aimed at the moving grips
    steerPivot.rotation.z = -st.steer * 0.85;
    const cz = Math.cos(steerPivot.rotation.z), sz = Math.sin(steerPivot.rotation.z);
    const cx = Math.cos(steerPivot.rotation.x), sxr = Math.sin(steerPivot.rotation.x);
    for (const a of arms) {
      // grip position in the driver's local space (column roll then column tilt)
      const gx = a.sx * 0.155 * cz, gy0 = a.sx * 0.155 * sz, gz0 = 0.03;
      const gy = gy0 * cx - gz0 * sxr, gz = gy0 * sxr + gz0 * cx;
      _v.set(gx + steerPivot.position.x, gy + steerPivot.position.y, gz + steerPivot.position.z);
      // into the driver's own frame — the driver tucks and leans, so the grip
      // must be un-rotated by driverPivot or the hands drift off the rim
      _v.sub(driverPivot.position).applyQuaternion(_q2.copy(driverPivot.quaternion).invert());
      _v.sub(a.shoulder.position);
      const dist = Math.max(0.2, _v.length());
      _v.divideScalar(dist);
      _q.setFromUnitVectors(_down, _v);
      a.shoulder.quaternion.copy(_q);
      a.shoulder.scale.y = clamp(dist / HAND_OFF, 0.75, 1.3);
      a.shoulder.scale.x = a.shoulder.scale.z = 1 / Math.sqrt(a.shoulder.scale.y);
    }

    // wobbly bits jiggle — junk-tier parts flap hard enough to be a joke
    for (let i = 0; i < wobblers.length; i++) {
      const w = wobblers[i];
      const amp = (w.userData.junk ? 0.30 : 0.09) * (0.35 + st.speed) * (1 + st.air);
      w.rotation.x = (w.userData.x0 ??= w.rotation.x) + Math.sin(st.t * 9 + i * 1.3) * amp;
      w.rotation.z = (w.userData.z0 ??= w.rotation.z) + Math.sin(st.t * 7.3 + i * 2.1) * amp * 0.8 - st.steer * 0.12;
    }

    // glow responds to drift charge and boost
    const heat = clamp(st.charge * 0.8 + st.boost * 1.6, 0, 2.4);
    M.glow.emissiveIntensity = baseGlow + heat;
    M.flame.emissiveIntensity = 0.45 + st.boost * 0.85 + st.charge * 0.25;
    for (const f of flames) {
      f.visible = st.boost > 0.05;
      const p = st.boost * (0.7 + 0.3 * Math.sin(st.t * 40 + f.position.x * 9));
      f.scale.set(0.6 + p, 0.5 + p * 0.95, 0.6 + p);
    }
    for (const c of coreGlow) {
      if (c.userData.spin) { c.rotation.y += dt * (0.8 + heat * 2.5); c.rotation.x += dt * 0.4; }
      if (c.userData.pulse) c.scale.setScalar(1 + 0.07 * Math.sin(st.t * (7 + heat * 7)) + heat * 0.05);
    }
    contact.material.opacity = 0.85 * (1 - st.air * 0.85);
  }

  /* ---------------- disposal ------------------------------------- */
  function disposeSubtree(obj) {
    obj.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }

  function dispose() {
    disposeSubtree(group);
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const t of texs) t.dispose();
    group.removeFromParent();
    group.clear();
    geos.length = mats.length = texs.length = 0;
  }

  api = {
    group, racer, parts, wheels, lod,
    bodyPivot, driverPivot, headPivot, steerPivot,
    update, setParts, dispose,
    // handy for the race camera / HUD
    get width() { return 1.55; },
    get length() { return 2.75; },
  };
  return api;
}

// Cheaper variant for distant AI karts. Respects engine.q if given.
//
// Two things make it cheap, and until Wave 5 neither of them fired:
//   * 'low' detail — the same reduction the player's kart already takes at the
//     נמוך tier. `opts.lod` used to be passed through raw, so race.js's `lod: 1`
//     lost the string compare and bought mid detail (see normalizeLod).
//   * the static weld — one draw call per material per animated frame instead
//     of one per mesh. Lossless; see weldFrame.
export function createKartLOD(opts = {}) {
  return createKart(Object.assign({}, opts, {
    lod: normalizeLod(opts.lod) || 'low',
    shadows: false,
    merge: opts.merge ?? true,
  }));
}

/* ------------------------------------------------------------------ */
/* previews                                                            */
/* ------------------------------------------------------------------ */

function makeGround(size) {
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0x9c8a72, roughness: 1 }));
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  return g;
}

function baseScene(engine, groundSize = 80) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x93a7cd);
  scene.fog = new THREE.Fog(0xb9a68d, 26, 130);
  scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x6b5238, 1.0));

  const sun = new THREE.DirectionalLight(0xffd6a0, 3.1);
  sun.position.set(-10, 9, 8);
  sun.castShadow = !!engine?.q?.shadows;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(engine.q.shadowSize, engine.q.shadowSize);
    const c = sun.shadow.camera;
    c.left = -18; c.right = 18; c.top = 18; c.bottom = -18; c.near = 0.5; c.far = 60;
    sun.shadow.bias = -0.0012; sun.shadow.normalBias = 0.02;
  }
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 1.2);
  rim.position.set(8, 6, -9);
  scene.add(rim);

  const ground = makeGround(groundSize);
  scene.add(ground);

  // Procedural environment map: without it MeshStandardMaterial has no specular
  // response outside the direct-light lobe and the bodywork reads as matte resin.
  let env = null;
  if (engine?.renderer) {
    env = makeKartEnvironment(engine.renderer);
    scene.environment = env.texture;
  }
  return { scene, ground, env };
}

// Shared teardown for every preview scene below.
function disposeWorld(ground, env, karts) {
  for (const k of karts) k.dispose();
  ground.geometry.dispose();
  ground.material.dispose();
  env?.dispose();
}

function fakeDrive(t) {
  // a plausible lap of input so --t N shows the animation doing its job
  const steer = Math.sin(t * 0.9) * 0.9;
  const speed01 = 0.55 + 0.45 * Math.sin(t * 0.5 + 1.1);
  const drifting = Math.abs(steer) > 0.72;
  return {
    steer, speed01, drifting,
    driftCharge01: drifting ? clamp((Math.abs(steer) - 0.72) * 3, 0, 1) : 0,
    airborne: false,
    boosting: Math.sin(t * 0.7) > 0.55,
  };
}

// Hero three-quarter. Good for judging form; NOT the camera the game uses —
// judge readability against previewChase/previewRear instead.
export function preview(engine) {
  const { scene, ground, env } = baseScene(engine, 90);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
  camera.position.set(3.6, 2.15, 4.6);
  camera.lookAt(0, 0.60, -0.05);

  const kart = createKart({ racer: ROSTER[0], engine, parts: { engine: 2, tires: 2, wing: 2, chassis: 2, exhaust: 2 } });
  kart.group.rotation.y = 3.30;
  scene.add(kart.group);

  let t = 0;
  return {
    scene, camera,
    update(dt) { t += dt; kart.update(dt, fakeDrive(t)); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { disposeWorld(ground, env, [kart]); },
  };
}

// THE camera the game actually renders from: directly behind, gameplay distance,
// framed like reference/image4.png. Every readability decision is judged here.
export function previewChase(engine) {
  const { scene, ground, env } = baseScene(engine, 120);
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 400);
  camera.position.set(0, 1.45, 6.30);
  camera.lookAt(0, 0.80, -1.2);

  const kart = createKart({ racer: ROSTER[0], engine, parts: { engine: 2, tires: 2, wing: 2, chassis: 2, exhaust: 2 } });
  scene.add(kart.group);

  let t = 0;
  return {
    scene, camera,
    update(dt) {
      t += dt;
      const s = fakeDrive(t);
      s.steer *= 0.35; s.drifting = false; s.driftCharge01 = 0;   // keep it judgeable
      kart.update(dt, s);
      // the chase camera lags the kart's roll a little, as it will in the race
      camera.position.x = -s.steer * 0.30;
      camera.lookAt(0, 0.80, -1.2);
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { disposeWorld(ground, env, [kart]); },
  };
}

// All eight from behind at gameplay size — the real test of whether the roster
// is distinguishable in a race.
export function previewRear(engine) {
  const { scene, ground, env } = baseScene(engine, 160);
  const camera = new THREE.PerspectiveCamera(44, 16 / 9, 0.1, 400);
  camera.position.set(0, 2.15, 12.6);
  camera.lookAt(0, 0.95, -0.6);

  const karts = [];
  ROSTER.forEach((r, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const k = createKart({ racer: r, engine, parts: { engine: 2, tires: 2, wing: 2, chassis: 2, exhaust: 2 } });
    k.group.position.set((col - 1.5) * 3.55, 0, row === 0 ? 0.2 : -5.6);
    k.group.rotation.y = (i % 2 ? 0.06 : -0.06);
    scene.add(k.group);
    karts.push(k);
  });

  let t = 0;
  return {
    scene, camera,
    update(dt) { t += dt; karts.forEach((k, i) => k.update(dt, fakeDrive(t + i * 0.8))); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { disposeWorld(ground, env, karts); },
  };
}

export function previewRoster(engine) {
  const { scene, ground, env } = baseScene(engine, 140);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 400);
  camera.position.set(5.4, 6.6, 16.5);
  camera.lookAt(0, 0.5, 0.6);

  const karts = [];
  const COLS = 4, SX = 4.1, SZ = 4.6;
  ROSTER.forEach((r, i) => {
    const cx = (i % COLS) - (COLS - 1) / 2;
    const cz = Math.floor(i / COLS) - 0.5;
    const k = createKart({ racer: r, engine, parts: { engine: 2, tires: 2, wing: i % 4, chassis: 2, exhaust: 2 } });
    k.group.position.set(cx * SX, 0, cz * SZ);
    k.group.rotation.y = 0.34;
    scene.add(k.group);
    karts.push(k);
    // colour puck under each kart so the identity reads even in a thumbnail
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.06, 28),
      new THREE.MeshStandardMaterial({ color: r.color, roughness: 0.8 }));
    puck.position.set(cx * SX, 0.02, cz * SZ);
    puck.receiveShadow = true;
    scene.add(puck);
    karts.push({ dispose() { puck.geometry.dispose(); puck.material.dispose(); }, update() {} });
  });

  let t = 0;
  return {
    scene, camera,
    update(dt) {
      t += dt;
      karts.forEach((k, i) => k.update(dt, fakeDrive(t + i * 0.7)));
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { disposeWorld(ground, env, karts); },
  };
}

// THE progression test. The same racer, four times, every slot matched at tier
// 0 / 1 / 2 / 3, framed from the same low-behind angle the game actually renders
// from. If the four karts do not step clearly left-to-right here, the upgrade
// ladder does not exist as far as a player is concerned.
export function previewTierLadder(engine) {
  const { scene, ground, env } = baseScene(engine, 200);
  // Matched to previewChase's ~6° elevation, pulled back and narrowed so all
  // four sit in frame without becoming a three-quarter hero shot.
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 400);
  camera.position.set(0, 2.30, 15.4);   // ≈5° elevation, same as the chase rig
  camera.lookAt(0, 0.92, 0);

  const karts = [];
  const SX = 3.55;
  for (let tier = 0; tier < PART_TIERS; tier++) {
    const k = createKart({
      racer: ROSTER[0], engine,
      parts: { engine: tier, tires: tier, wing: tier, chassis: tier, exhaust: tier },
    });
    k.group.position.set((tier - (PART_TIERS - 1) / 2) * SX, 0, 0);
    scene.add(k.group);
    karts.push(k);
  }

  let t = 0;
  return {
    scene, camera,
    update(dt) {
      t += dt;
      // straight-ahead, mid-throttle, no drift — the calmest pose to judge from
      const s = { steer: 0, speed01: 0.55, drifting: false, driftCharge01: 0, airborne: false, boosting: false };
      karts.forEach(k => k.update(dt, s));
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { disposeWorld(ground, env, karts); },
  };
}

// ── LOD comparison rigs (Wave 5) ─────────────────────────────────────────────
// Three builds of the same opponent, framed identically, so the two questions a
// LOD change has to answer can be answered by looking:
//   *Old   — what race.js used to get from `lod: 1`: MID detail, unwelded.
//   *Plain — the LOD fix alone: LOW detail, unwelded.
//   *Weld  — what it gets now: LOW detail, welded. Must be pixel-identical to
//            *Plain, because the weld only changes how many buffers are bound.
// Both rigs hold a constant pose, so `--t 1.5` is reproducible.
const LOD_ROW = [[10, -3.0], [25, 3.2], [50, 13.0]];
const LOD_POSE = { steer: 0.10, speed01: 0.62, drifting: false, driftCharge01: 0, airborne: false, boosting: false };
const LOD_PARTS = { engine: 2, tires: 2, wing: 2, chassis: 2, exhaust: 2 };

function lodRow(engine, make) {
  const { scene, ground, env } = baseScene(engine, 260);
  // The race's own fog would have dissolved the 50 m kart into the ground before
  // it could be judged — which is an argument for the LOD, not a way to test it.
  scene.fog = new THREE.Fog(0xb9a68d, 120, 400);
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 400);
  camera.position.set(0, 1.62, 1.2);
  camera.lookAt(0, 1.0, -24);
  const karts = LOD_ROW.map(([d, x], i) => {
    const k = make(engine, ROSTER[i % ROSTER.length]);
    k.group.position.set(x, 0, -d);
    scene.add(k.group);
    return k;
  });
  return {
    scene, camera,
    update(dt) { for (const k of karts) k.update(dt, LOD_POSE); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { disposeWorld(ground, env, karts); },
  };
}

function lodHero(engine, make) {
  const { scene, ground, env } = baseScene(engine, 90);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 400);
  camera.position.set(3.6, 2.15, 4.6);
  camera.lookAt(0, 0.60, -0.05);
  const kart = make(engine, ROSTER[0]);
  kart.group.rotation.y = 3.30;
  scene.add(kart.group);
  return {
    scene, camera,
    update(dt) { kart.update(dt, LOD_POSE); },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { disposeWorld(ground, env, [kart]); },
  };
}

const mkOld = (engine, racer) => createKart({ racer, engine, parts: LOD_PARTS, lod: 'mid', shadows: false });
const mkPlain = (engine, racer) => createKart({ racer, engine, parts: LOD_PARTS, lod: 'low', shadows: false, plates: true });
const mkWeld = (engine, racer) => createKartLOD({ racer, engine, parts: LOD_PARTS, lod: 1 });

export const previewLodOld = engine => lodRow(engine, mkOld);
export const previewLodPlain = engine => lodRow(engine, mkPlain);
export const previewLodWeld = engine => lodRow(engine, mkWeld);
export const previewLodHeroOld = engine => lodHero(engine, mkOld);
export const previewLodHeroPlain = engine => lodHero(engine, mkPlain);
export const previewLodHeroWeld = engine => lodHero(engine, mkWeld);

export function previewParts(engine) {
  const { scene, ground, env } = baseScene(engine, 140);
  // Framed from behind, not from a three-quarter hero angle: these pairs exist to
  // answer "can you see the difference while racing?", and only a rear view can.
  // The junk tier sits in the NEAR row so the hero tier reads over the top of it.
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 400);
  camera.position.set(0, 4.55, 17.6);
  camera.lookAt(0, 0.85, -0.4);

  const karts = [];
  // One column per slot; junk tier in the NEAR row, hero tier behind it, both
  // yawed toward the camera's rear quarter so the back of each kart — the only
  // view the game ever gives a player — stays the dominant face.
  const SX = 3.9, SZ = 6.6;
  PART_SLOTS.forEach((slot, i) => {
    const cx = i - (PART_SLOTS.length - 1) / 2;
    for (const [row, tier] of [[0.5, 0], [-0.5, PART_TIERS - 1]]) {
      const p = { engine: 1, tires: 1, wing: 1, chassis: 1, exhaust: 1 };
      p[slot] = tier;
      const k = createKart({ racer: ROSTER[0], engine, parts: p });
      k.group.position.set(cx * SX + (tier ? -0.55 : 0.55), 0, row * SZ);
      k.group.rotation.y = 0.34;
      scene.add(k.group);
      karts.push(k);
    }
  });

  let t = 0;
  return {
    scene, camera,
    update(dt) {
      t += dt;
      const s = fakeDrive(t);
      s.boosting = true;                 // show the high-tier glow doing its thing
      s.driftCharge01 = 0.8;
      karts.forEach(k => k.update(dt, s));
    },
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    dispose() { disposeWorld(ground, env, karts); },
  };
}

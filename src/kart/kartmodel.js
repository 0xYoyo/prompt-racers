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
/* createKart                                                           */
/* ------------------------------------------------------------------ */

export function createKart(opts = {}) {
  const racer = opts.racer || ROSTER[0];
  const eng = opts.engine || null;
  const q = eng?.q || null;
  const lod = opts.lod || (q ? (q.name === 'low' ? 'low' : q.name === 'medium' ? 'mid' : 'high') : 'high');
  const LOW = lod === 'low';
  const HIGH = lod === 'high';
  const shadows = opts.shadows ?? (q ? !!q.shadows : true);

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
  driverPivot.position.set(0, 0.55, 0.26);
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
  mesh(G(roundedBox(0.60, 0.13, 0.52, 0.06)), M.seat, chassisGrp, [0, 0.47, 0.30]);
  const seatBack = mesh(G(roundedBox(0.50, 0.42, 0.15, 0.08)), M.seat, chassisGrp, [0, 0.70, 0.56]);
  seatBack.rotation.x = -0.14;
  mesh(G(roundedBox(0.42, 0.08, 0.10, 0.035)), M.accent, chassisGrp, [0, 0.89, 0.58]);
  // seat piping — mid-frequency detail that reads at chase distance
  if (!LOW) for (const sx of [-1, 1]) mesh(G(roundedBox(0.03, 0.34, 0.10, 0.012)), M.accent, chassisGrp, [sx * 0.23, 0.70, 0.55], [-0.14, 0, 0]);

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
  if (!LOW) {
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
    // tier changes tyre size + look: 0 skinny & worn, 3 huge & glowing
    const fat = [0.80, 1.0, 1.14, 1.26][tier];
    const grow = [0.94, 1.0, 1.05, 1.10][tier];
    const r = w.r * grow, width = w.w * fat;
    w.scaleR = r;
    const seg = LOW ? 8 : 16;
    const tyreMat = tier === 0 ? M.frame : M.tyre;
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
      const n = tier >= 2 ? 16 : 12;
      const bw = width * 0.86, bh = 0.05 * grow, bd = (2 * Math.PI * r / n) * 0.55;
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
    // rim + hub
    const rimR = r * (tier >= 2 ? 0.62 : 0.56);
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(G(new THREE.CylinderGeometry(rimR, rimR, width * 0.62, LOW ? 8 : 14)), tier === 0 ? M.dark : M.rim);
      rim.rotation.z = Math.PI / 2;
      rim.position.x = s * width * 0.22;
      meshOpts(rim); g.add(rim);
      const hub = new THREE.Mesh(G(new THREE.SphereGeometry(rimR * 0.42, LOW ? 6 : 10, LOW ? 4 : 8)), tier === 3 ? M.glow : M.hub);
      hub.position.x = s * (width * 0.5 + 0.005);
      meshOpts(hub); g.add(hub);
      if (tier === 3 && !LOW) {
        const ring = new THREE.Mesh(G(new THREE.TorusGeometry(rimR * 0.82, 0.022, 4, 14)), M.glow);
        ring.position.x = s * (width * 0.48);
        ring.rotation.y = Math.PI / 2;
        g.add(ring);
      }
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
    const k = mesh(G(new THREE.SphereGeometry(0.11, LOW ? 6 : 10, LOW ? 5 : 8)), M.skin, bodyPivot, [sx * 0.17, 0.56, -0.30]);
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
  // The wing lives ABOVE helmet height on visible pylons. From the chase camera
  // that is the only place a rear part can read: below ~1.15 it just merges with
  // the driver and the seat back into one coloured slab.
  const WING_Y = 1.62, WING_Z = 1.30;

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

  function wingPylons(g, topY, mat1, w = 0.42) {
    for (const sx of [-1, 1]) {
      const h = topY - 0.40;
      mesh(G(roundedBox(0.065, h, 0.13, 0.03)), mat1, g, [sx * w, 0.40 + h / 2, WING_Z - 0.02]);
    }
  }

  function buildWing(tier) {
    const g = slotGrp.wing;
    if (tier === 0) {
      // A grey cardboard plank on a bent coat-hanger, taped on crooked. It is
      // meant to look like something that fell off a shelf, not like paint.
      const hangY = 1.06;
      for (const sx of [-1, 1]) {
        const p = mesh(G(new THREE.CylinderGeometry(0.018, 0.018, hangY - 0.5, 5)), M.frame, g,
          [sx * 0.26, (hangY + 0.5) / 2, WING_Z], [0, 0, sx * 0.26]);
        p.castShadow = shadows;
      }
      const plank = mesh(G(roundedBox(0.86, 0.05, 0.24, 0.015)), M.cardboard, g, [0.03, hangY, WING_Z], [0.10, 0.10, 0.30]);
      wobblers.push(Object.assign(plank, { userData: { junk: true } }));
      const droop = mesh(G(roundedBox(0.34, 0.04, 0.20, 0.012)), M.cardboard, g, [-0.42, hangY - 0.10, WING_Z], [0, 0.1, 0.55]);
      wobblers.push(Object.assign(droop, { userData: { junk: true } }));
      // duct-tape X, the gag prop
      for (const a of [0.7, -0.7]) mesh(G(roundedBox(0.22, 0.05, 0.03, 0.008)), M.tape, g, [0.26, hangY + 0.02, WING_Z - 0.13], [0, 0, a]);
    } else if (tier === 1) {
      wingPylons(g, WING_Y - 0.14, M.frame, 0.44);
      mesh(G(roundedBox(0.92, 0.06, 0.28, 0.026)), M.body, g, [0, WING_Y - 0.10, WING_Z], [0.16, 0, 0]);
      for (const sx of [-1, 1]) mesh(G(roundedBox(0.05, 0.16, 0.26, 0.02)), M.accent, g, [sx * 0.44, WING_Y - 0.06, WING_Z]);
      wingTag(g, WING_Y - 0.07, WING_Z, 0.92);
    } else if (tier === 2) {
      wingPylons(g, WING_Y, M.bodyDark, 0.46);
      mesh(G(roundedBox(0.92, 0.07, 0.30, 0.03)), M.body, g, [0, WING_Y, WING_Z], [0.18, 0, 0]);
      mesh(G(roundedBox(0.90, 0.05, 0.18, 0.02)), M.accent, g, [0, WING_Y - 0.16, WING_Z + 0.06], [0.30, 0, 0]);
      for (const sx of [-1, 1]) mesh(G(roundedBox(0.06, 0.30, 0.34, 0.04)), M.accent, g, [sx * 0.46, WING_Y - 0.09, WING_Z]);
      wingTag(g, WING_Y + 0.03, WING_Z, 0.98);
    } else {
      // hero tier: real geometric drama — a swept bi-plane on chrome swan-necks
      for (const sx of [-1, 1]) {
        const neck = mesh(G(new THREE.TorusGeometry(0.46, 0.04, 4, LOW ? 8 : 16, Math.PI * 0.60)), M.chrome, g,
          [sx * 0.48, 1.02, WING_Z - 0.30], [0, Math.PI / 2, -0.75]);
        neck.castShadow = shadows;
      }
      const main = mesh(G(roundedBox(1.04, 0.08, 0.34, 0.035)), M.body, g, [0, WING_Y + 0.10, WING_Z], [0.2, 0, 0]);
      mesh(G(roundedBox(0.96, 0.05, 0.20, 0.022)), M.accent, g, [0, WING_Y - 0.10, WING_Z + 0.06], [0.32, 0, 0]);
      const edge = mesh(G(roundedBox(1.06, 0.035, 0.06, 0.015)), M.glow, g, [0, WING_Y + 0.06, WING_Z - 0.15], [0.2, 0, 0]);
      coreGlow.push(edge);
      for (const sx of [-1, 1]) {
        mesh(G(roundedBox(0.06, 0.52, 0.42, 0.05)), M.accent, g, [sx * 0.52, WING_Y - 0.10, WING_Z]);
        mesh(G(roundedBox(0.045, 0.14, 0.30, 0.02)), M.glow, g, [sx * 0.552, WING_Y + 0.10, WING_Z]);
        // upswept winglets
        mesh(G(roundedBox(0.22, 0.04, 0.13, 0.02)), M.chrome, g, [sx * 0.62, WING_Y + 0.22, WING_Z], [0, 0, sx * 0.55]);
      }
      wingTag(g, WING_Y + 0.13, WING_Z, 1.04);
      main.castShadow = shadows;
    }
  }

  // --- engine block -----------------------------------------------
  // Engine sits high enough that its top clears the seat back (top ≈ 0.97) —
  // otherwise the whole upgrade is invisible from the only camera the game uses.
  const ENG_Y = 0.74;
  function buildEngine(tier) {
    const g = slotGrp.engine;
    const z = 0.86;
    // mounting posts down to the tub, so the raised block reads as bolted on
    for (const sx of [-1, 1]) mesh(G(roundedBox(0.08, 0.34, 0.12, 0.03)), M.frame, g, [sx * 0.16, 0.50, z]);
    if (tier === 0) {
      const can = mesh(G(new THREE.CylinderGeometry(0.16, 0.18, 0.28, LOW ? 6 : 12)), M.cardboard, g, [0.03, ENG_Y - 0.06, z]);
      can.rotation.z = 0.14;
      wobblers.push(Object.assign(can, { userData: { junk: true } }));
      mesh(G(new THREE.TorusGeometry(0.16, 0.028, 4, LOW ? 6 : 12)), M.tape, g, [0.03, ENG_Y - 0.02, z], [Math.PI / 2, 0.1, 0]);
      // bent coat-hanger sticking out of the top
      mesh(G(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 5)), M.frame, g, [0.14, ENG_Y + 0.16, z + 0.04], [0.5, 0, -0.5]);
    } else if (tier === 1) {
      mesh(G(roundedBox(0.42, 0.40, 0.42, 0.09)), M.dark, g, [0, ENG_Y, z]);
      for (let i = 0; i < 4; i++) mesh(G(roundedBox(0.46, 0.035, 0.40, 0.015)), M.frame, g, [0, ENG_Y - 0.13 + i * 0.09, z]);
      mesh(G(new THREE.CylinderGeometry(0.085, 0.085, 0.12, LOW ? 6 : 12)), M.chrome, g, [0, ENG_Y + 0.24, z]);
    } else if (tier === 2) {
      mesh(G(roundedBox(0.44, 0.46, 0.48, 0.10)), M.dark, g, [0, ENG_Y + 0.02, z]);
      for (let i = 0; i < 5; i++) mesh(G(roundedBox(0.48, 0.03, 0.46, 0.012)), M.chrome, g, [0, ENG_Y - 0.16 + i * 0.085, z]);
      for (const sx of [-1, 1]) {
        // intake trumpets
        const tr = mesh(G(new THREE.CylinderGeometry(0.10, 0.06, 0.20, LOW ? 6 : 12, 1, true)), M.chrome, g, [sx * 0.13, ENG_Y + 0.34, z], [0.12, 0, 0]);
        tr.material.side = THREE.DoubleSide;
      }
      mesh(G(roundedBox(0.28, 0.10, 0.10, 0.04)), M.accent, g, [0, ENG_Y + 0.28, z - 0.23]);
    } else {
      mesh(G(roundedBox(0.44, 0.44, 0.46, 0.14)), M.dark, g, [0, ENG_Y, z]);
      // caged glowing core
      const core = mesh(G(new THREE.IcosahedronGeometry(0.17, LOW ? 0 : 1)), M.glow, g, [0, ENG_Y + 0.08, z]);
      core.userData.spin = true; core.userData.pulse = true;
      coreGlow.push(core);
      for (let i = 0; i < 3; i++) {
        const ring = mesh(G(new THREE.TorusGeometry(0.22, 0.022, 4, LOW ? 8 : 16)), M.chrome, g, [0, ENG_Y + 0.08, z], [i * 0.9, i * 1.1, 0]);
        ring.castShadow = false;
      }
      const halo = mesh(G(new THREE.TorusGeometry(0.30, 0.03, 4, LOW ? 10 : 20)), M.glow, g, [0, ENG_Y + 0.08, z], [Math.PI / 2, 0, 0]);
      coreGlow.push(halo);
      for (const sx of [-1, 1]) mesh(G(roundedBox(0.09, 0.34, 0.40, 0.04)), M.chrome, g, [sx * 0.28, ENG_Y + 0.02, z]);
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
    // Pipe tips are lifted to ~1.0–1.15 so they clear the seat back and stay
    // readable in the chase view.
    if (tier === 0) {
      const p = mk(0.30, 0.82, 1.00, 0.46, [1.0, 0, 0.45], M.frame);
      p.material = M.frame;
      wobblers.push(Object.assign(p, { userData: { junk: true } }));
      mesh(G(new THREE.TorusGeometry(0.06, 0.022, 4, 8)), M.tape, g, [0.38, 0.94, 1.18], [Math.PI / 2 + 0.4, 0, 0]);
      flame(0.40, 0.96, 1.24, 0.7);
    } else if (tier === 1) {
      for (const sx of [-1, 1]) { mk(sx * 0.34, 0.88, 1.02, 0.42, [1.15, 0, 0], M.chrome); flame(sx * 0.34, 0.98, 1.22, 0.8); }
    } else if (tier === 2) {
      for (const sx of [-1, 1]) for (const i of [0, 1]) {
        const x = sx * (0.26 + i * 0.14);
        mk(x, 0.90 + i * 0.07, 1.00, 0.48, [1.1, 0, 0], M.chrome);
        mesh(G(new THREE.TorusGeometry(0.062, 0.02, 4, LOW ? 6 : 12)), M.accent, g, [x, 1.01 + i * 0.07, 1.21], [Math.PI / 2 + 0.45, 0, 0]);
        flame(x, 1.02 + i * 0.07, 1.24, 0.85);
      }
    } else {
      for (const sx of [-1, 1]) {
        const noz = mesh(G(new THREE.CylinderGeometry(0.10, 0.075, 0.28, LOW ? 8 : 14)), M.chrome, g, [sx * 0.36, 0.96, 1.06], [Math.PI / 2 + 0.16, 0, 0]);
        const ring = mesh(G(new THREE.TorusGeometry(0.09, 0.025, 4, LOW ? 8 : 16)), M.glow, g, [sx * 0.36, 0.98, 1.19], [0.16, 0, 0]);
        coreGlow.push(ring);
        noz.castShadow = shadows;
        flame(sx * 0.36, 0.98, 1.21, 1.1);
      }
    }
  }

  // --- chassis dress ------------------------------------------------
  function buildChassisKit(tier) {
    const g = slotGrp.chassis;
    if (tier === 0) {
      // mismatched cardboard patch panels, taped on crooked
      for (const sx of [-1, 1]) {
        const p = mesh(G(roundedBox(0.05, 0.28, 0.64, 0.02)), M.cardboard, g, [sx * 0.58, 0.34, -0.10], [0, 0, sx * 0.30]);
        wobblers.push(Object.assign(p, { userData: { junk: true } }));
      }
      const flap = mesh(G(roundedBox(0.46, 0.04, 0.28, 0.015)), M.cardboard, g, [0.08, 0.50, -1.05], [0.18, 0.14, 0.10]);
      wobblers.push(Object.assign(flap, { userData: { junk: true } }));
      for (const a of [0.8, -0.8]) mesh(G(roundedBox(0.20, 0.05, 0.03, 0.008)), M.tape, g, [-0.58, 0.40, -0.12], [0, Math.PI / 2, a]);
    } else if (tier === 1) {
      for (const sx of [-1, 1]) mesh(G(roundedBox(0.07, 0.14, 0.96, 0.03)), M.bodyDark, g, [sx * 0.55, 0.21, -0.05]);
    } else if (tier === 2) {
      for (const sx of [-1, 1]) {
        mesh(G(roundedBox(0.10, 0.18, 1.16, 0.045)), M.accent, g, [sx * 0.56, 0.21, -0.02]);
        mesh(G(roundedBox(0.16, 0.05, 0.34, 0.02)), M.bodyDark, g, [sx * 0.55, 0.31, -0.66], [0, 0, sx * 0.2]);
      }
      mesh(G(roundedBox(1.02, 0.05, 0.26, 0.02)), M.bodyDark, g, [0, 0.19, -1.24]);
    } else {
      for (const sx of [-1, 1]) {
        mesh(G(roundedBox(0.12, 0.20, 1.30, 0.06)), M.accent, g, [sx * 0.57, 0.22, -0.02]);
        const strip = mesh(G(roundedBox(0.04, 0.05, 1.16, 0.02)), M.glow, g, [sx * 0.625, 0.14, -0.02]);
        coreGlow.push(strip);
        // canard fins on the nose
        mesh(G(roundedBox(0.28, 0.035, 0.16, 0.015)), M.chrome, g, [sx * 0.46, 0.40, -1.10], [0, 0, sx * 0.36]);
      }
      mesh(G(roundedBox(1.10, 0.05, 0.30, 0.02)), M.chrome, g, [0, 0.17, -1.28]);
      const under = mesh(G(new THREE.PlaneGeometry(1.1, 2.2)), M.glow, g, [0, 0.06, 0], [-Math.PI / 2, 0, 0]);
      under.castShadow = false;
      coreGlow.push(under);
    }
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
    const todo = built ? changed : PART_SLOTS;   // first call builds every slot
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
    M.flame.emissiveIntensity = 0.6 + st.boost * 1.6 + st.charge * 0.4;
    for (const f of flames) {
      f.visible = st.boost > 0.05;
      const p = st.boost * (0.7 + 0.3 * Math.sin(st.t * 40 + f.position.x * 9));
      f.scale.set(0.6 + p, 0.5 + p * 1.6, 0.6 + p);
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
export function createKartLOD(opts = {}) {
  return createKart(Object.assign({}, opts, { lod: opts.lod || 'low', shadows: false }));
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
  camera.position.set(0, 1.85, 9.20);
  camera.lookAt(0, 0.95, -0.6);

  const karts = [];
  ROSTER.forEach((r, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const k = createKart({ racer: r, engine, parts: { engine: 2, tires: 2, wing: 2, chassis: 2, exhaust: 2 } });
    k.group.position.set((col - 1.5) * 2.60, 0, row === 0 ? 0.2 : -4.4);
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

export function previewParts(engine) {
  const { scene, ground, env } = baseScene(engine, 140);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 400);
  camera.position.set(0, 4.4, 19.4);
  camera.lookAt(0, 1.00, -0.2);

  const karts = [];
  const SX = 3.6, SZ = 5.2;
  PART_SLOTS.forEach((slot, i) => {
    const cx = i - (PART_SLOTS.length - 1) / 2;
    for (const [row, tier] of [[-0.5, 0], [0.5, PART_TIERS - 1]]) {
      const p = { engine: 1, tires: 1, wing: 1, chassis: 1, exhaust: 1 };
      p[slot] = tier;
      const k = createKart({ racer: ROSTER[0], engine, parts: p });
      k.group.position.set(cx * SX, 0, row * SZ);
      k.group.rotation.y = 0.62;
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

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAGE GATE — no mirrored Hebrew anywhere in the 3D world, ever again.
//
// The bug this guards (Wave 4, item 7): the trackside sponsor boards were
// lettered with the texture's U axis running along `+side*tangent`, while a
// driver's screen-right at that board is `-side*tangent`. Every board on all
// three tracks therefore read back-to-front, and the DoubleSide material meant
// nobody was even looking at the face that had been authored. The start gantry
// escaped only because its board is a PlaneGeometry rotated to face back down
// the track, which lands its +X (U) on the driver's screen-right by accident of
// construction.
//
// The invariant, which holds for ANY normal at ANY viewing angle:
//
//     U must increase along (up x N)   and   V along +Y
//
// where N is the quad's own front normal. This test re-derives U and N from the
// BUILT GEOMETRY of every text mesh on every track — position and uv buffers,
// not source strings — so a future placement site that gets its maths backwards
// is caught even if it never touches trackbuild.js.
//
// It also pins:
//   * every lettered panel is readable from the racing line (its face points at
//     the centreline, or it has a back-to-back twin that does);
//   * signage never intrudes on the drivable corridor (auditTrackClearance);
//   * signage thins out on the low quality tier;
//   * track 2's display names are עיר הנוירונים / Neuron City, while its
//     persisted `id` stays 'circuit' so existing saves keep resolving.
//
//   node tests/signage.test.mjs
// ─────────────────────────────────────────────────────────────────────────────

// ---- headless canvas stub: the procedural textures need a 2D context --------
/**
 * Glyph advance the stub charges, in em per character. See the note on
 * `measureText` below; it is real-Chrome measurement, not a guess, and it is
 * asserted against the shipping TEXT_ADV_EM further down.
 */
const STUB_ADV = 0.62;
/** Widest em/char any candidate face measured in real Chrome (generic fallback). */
const WIDEST_MEASURED_ADV = 0.6033;
function stubCanvas() {
  const state = {};
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      switch (k) {
        case 'createImageData':
          return (w, h) => ({ data: new Uint8ClampedArray(w * (h || w) * 4), width: w, height: h || w });
        case 'getImageData':
          return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        case 'createLinearGradient':
        case 'createRadialGradient':
        case 'createConicGradient':
        case 'createPattern':
          return () => ({ addColorStop() {} });
        case 'measureText':
          // FONT-AWARE, and deliberately pessimistic. The old stub returned
          // `chars * 8` whatever the font, which made the real-font clamp inside
          // drawWorldText a no-op here and left the gate unable to see the bug
          // this wave existed to fix.
          //
          // THE NUMBER HAS TO DESCRIBE THE WIDEST FONT THAT COULD RENDER, not
          // the one this machine has. Measured in real Chrome at 1024 px over
          // every authored world phrase, bold, worst line 'שכבה נסתרת':
          //     "Arial Hebrew"       0.555 em/char  (macOS)
          //     "Noto Sans Hebrew"   0.473 em/char  (where installed)
          //     generic sans-serif   0.603 em/char  (Windows/Linux/Android)
          // The old 0.60 sat BELOW the generic fallback, so a line could fit
          // here and be 0.5% wider than the stub believed on a school laptop.
          // 0.62 matches TEXT_ADV_EM and clears the widest measured fallback,
          // and STUB_ADV below re-pins that agreement so the two cannot drift.
          return (s) => {
            const m = /(\d+(?:\.\d+)?)px/.exec(String(t.font || '16px'));
            return { width: String(s).length * STUB_ADV * (m ? +m[1] : 16) };
          };
        default:
          return () => {};
      }
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: 0, height: 0, style: {}, getContext: () => ctx };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { createElement: (tag) => (tag === 'canvas' ? stubCanvas() : { style: {} }) };
}

const THREE = await import('three');
const { buildTrack, auditTrackClearance, signUAxis, enforceSignOrientation, TEXT_MESHES, TRACK_SIGNS,
  signLayout, signUV, signTileIndex, SIGN_COLS, SIGN_ROWS, SIGN_TILE_ASPECT, SIGN_MAX_CHARS,
  SIGN_LINES } = await import('../src/track/trackbuild.js');
const { TRACKS, getTrack } = await import('../src/track/trackdef.js');
const SIGNDATA = await import('../src/track/signdata.js');
const { WORLD_TEXT_STATS, resetWorldTextStats, fitText, allWorldPhrases,
  BRAND_BOARDS, HOLO_BOARDS, BRAND_BOARD_W, BRAND_BOARD_H, BRAND_TILE_ASPECT,
  HOLO_BOARD_W, HOLO_BOARD_H, HOLO_TILE_ASPECT, TEXT_ADV_EM, TEXT_CAP_EM } = SIGNDATA;
// The glossary the world boards echo. Imported for one reason only: it is the
// ONE anchor in this file that lives outside the data under test, so an
// assertion tied to it cannot be satisfied by editing the phrase list.
const BADGES = await import('../src/core/badges.js');

// Everything below is measured on the ONE shared drawing path, so the counters
// have to start from a clean slate before the first track is built.
resetWorldTextStats();

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed++;
  console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name.padEnd(58)} ${detail ? '\x1b[2m' + detail + '\x1b[0m' : ''}`);
};

const UP = new THREE.Vector3(0, 1, 0);
const engineAt = (propDensity, texSize = 512) => ({
  q: { texSize, shadows: false, propDensity, crowdDensity: 0.4, drawDistance: 700 },
});

/**
 * Pull every upright, lettered quad out of a built track, in world space, and
 * measure the two things that decide whether its text reads forwards:
 *   n  — the face normal
 *   u  — the direction in which the texture's U coordinate increases
 *   v  — the direction in which V increases
 */
function textFaces(track) {
  const out = [];
  const { group, spline } = track;
  group.updateMatrixWorld(true);
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  group.traverse(o => {
    if (!o.isMesh || !TEXT_MESHES.has(o.name)) return;
    const geo = o.geometry, pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index;
    if (!pos || !uv || !idx) return;
    for (let f = 0; f < idx.count / 3; f++) {
      const ia = idx.getX(f * 3), ib = idx.getX(f * 3 + 1), ic = idx.getX(f * 3 + 2);
      p0.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
      p1.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
      p2.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      const e1 = p1.clone().sub(p0), e2 = p2.clone().sub(p0);
      const n = e1.clone().cross(e2);
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();
      if (Math.abs(n.y) > 0.8) continue;                    // not a lettered face
      const du1 = uv.getX(ib) - uv.getX(ia), dv1 = uv.getY(ib) - uv.getY(ia);
      const du2 = uv.getX(ic) - uv.getX(ia), dv2 = uv.getY(ic) - uv.getY(ia);
      const det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-12) continue;
      const u = e1.clone().multiplyScalar(dv2).sub(e2.clone().multiplyScalar(dv1)).divideScalar(det);
      const v = e2.clone().multiplyScalar(du1).sub(e1.clone().multiplyScalar(du2)).divideScalar(det);
      if (u.lengthSq() < 1e-12 || v.lengthSq() < 1e-12) continue;
      const c = p0.clone().add(p1).add(p2).multiplyScalar(1 / 3);
      const s = spline.closestT(c);
      out.push({
        mesh: o.name, n, u: u.normalize(), v: v.normalize(), c,
        t: s.t, lateral: s.lateral, right: spline.rightAt(s.t),
      });
    }
  });
  return out;
}

const built = [];
console.log('\n  ANTI-MIRRORING INVARIANT — U must run along (up x N)\n  ' + '─'.repeat(78));
for (const def of TRACKS) {
  const track = buildTrack(def.id, engineAt(1), { audit: false });
  built.push(track);
  const faces = textFaces(track);

  let mirrored = 0, upsideDown = 0, worst = 1;
  for (const f of faces) {
    const want = signUAxis(f.n);
    const d = f.u.dot(want);
    if (d < 0.9) { mirrored++; if (d < worst) worst = d; }
    if (f.v.dot(UP) < 0.9) upsideDown++;
  }
  ok(`${def.id}: lettered faces found`, faces.length >= 8, `${faces.length} faces`);
  // COVERAGE, not correctness. The finish-gantry board carries def.nameHe and is
  // the piece D32 names as the diagnostic for the whole mirroring bug — and it
  // was built with no `.name`, so it fell outside TEXT_MESHES and therefore
  // outside BOTH enforceSignOrientation and this test. The gate shared the
  // fix's blind spot. If it ever loses its name again, this fails.
  const gantryFaces = faces.filter(f => f.mesh === 'gantry-board').length;
  ok(`${def.id}: the finish-gantry board is inside the swept set`, gantryFaces >= 4,
    `${gantryFaces} gantry faces (2 boards x 2 tris)`);
  // ...and the same coverage question asked of EVERY lettered mesh, not only the
  // one that was caught last time. The barrier sponsor boards and the night
  // city's holo billboards are lettered too; if either ever loses its name it
  // drops out of enforceSignOrientation and out of every check below it.
  const byMesh = {};
  for (const f of faces) byMesh[f.mesh] = (byMesh[f.mesh] || 0) + 1;
  const wantMeshes = ['signage', 'boards', 'gantry-board']
    .concat(def.theme === 'circuit' ? ['holo-signs'] : []);
  ok(`${def.id}: every lettered mesh is inside the swept set`,
    wantMeshes.every(m => (byMesh[m] || 0) > 0),
    wantMeshes.map(m => `${m}=${byMesh[m] || 0}`).join(' '));
  ok(`${def.id}: no mirrored text (U along up x N)`, mirrored === 0,
    mirrored ? `${mirrored}/${faces.length} mirrored, worst dot=${worst.toFixed(3)}` : `${faces.length} faces clean`);
  ok(`${def.id}: no upside-down text (V along +Y)`, upsideDown === 0,
    upsideDown ? `${upsideDown} faces` : '');

  // Readable from the racing line: face the centreline, or have a twin that does.
  let unreadable = 0;
  for (const f of faces) {
    const inward = f.right.clone().multiplyScalar(-Math.sign(f.lateral));
    if (f.n.dot(inward) > 0) continue;
    const twin = faces.some(g => g !== f && g.n.dot(f.n) < -0.9 &&
      Math.abs(f.n.dot(g.c.clone().sub(f.c))) < 0.4 && g.c.distanceTo(f.c) < 16);
    if (!twin) unreadable++;
  }
  // THE half that catches the shipped bug: a quad can satisfy U = up x N and
  // still read backwards if its front face points AWAY from the racing line,
  // because a DoubleSide material then shows the driver its reverse.
  ok(`${def.id}: no face lettered on its far side (would read mirrored)`, unreadable === 0,
    unreadable ? `${unreadable} faces point away with no back-to-back twin` : '');

  // A negative scale (or a negative texture repeat) mirrors text without ever
  // touching a uv buffer — the other way this bug class comes back.
  let negScale = 0, negRepeat = 0;
  track.group.traverse(o => {
    if (!o.isMesh || !TEXT_MESHES.has(o.name)) return;
    if (o.matrixWorld.determinant() < 0) negScale++;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      for (const k of ['map', 'emissiveMap']) {
        const tex = m?.[k];
        if (tex?.isTexture && (tex.repeat.x < 0 || tex.repeat.y < 0)) negRepeat++;
      }
    }
  });
  ok(`${def.id}: no negative world scale on text meshes`, negScale === 0);
  ok(`${def.id}: no negative texture repeat on text meshes`, negRepeat === 0);

  // The central sweep must be a GUARD, not a crutch: if it is repairing anything
  // on a finished track, some placement site is still getting its maths wrong
  // and should be fixed at source (D32 fixed both known ones).
  const st = track.group.userData.signOrientation;
  ok(`${def.id}: the sweep repairs nothing (source is correct)`,
    !!st && st.repairedUV === 0 && st.repairedWinding === 0,
    st ? `uv ${st.repairedUV}, winding ${st.repairedWinding}` : 'no stat recorded');

  // ...and it must be IDEMPOTENT. It was not: the finish gantry hangs one shared
  // PlaneGeometry off two meshes, and the sweep rewrote that one uv buffer once
  // per mesh, taking its own output as the second pass's "original" and leaving
  // two vertices with identical UVs — a collapsed, unreadable board. Sweeping a
  // clean track twice must be a no-op.
  const again = enforceSignOrientation(track.group, track.spline);
  ok(`${def.id}: the sweep is idempotent (safe on shared geometry)`,
    again.repairedUV === 0 && again.repairedWinding === 0,
    `second pass repaired uv ${again.repairedUV}, winding ${again.repairedWinding}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE TEXT PATH — the Wave-5 bug, and the shape of the gate that catches it.
//
// The player reported world text that was "corrupted, truncated, non-words".
// None of it was a mirroring bug: there were THREE unrelated pieces of code
// drawing Hebrew into the world, and two of them drew at a FIXED font size onto
// SQUARE atlas tiles that were then mapped onto 4.5:1 and 2:1 banner quads.
// Measured with the real font at 1024 px, 'מנוע פרומפט' rendered 656 px wide in
// a 512 px tile — so 28% of it landed on the tile NEXT DOOR, which then painted
// its own background over half of it. Every barrier board and every holo
// billboard in the game showed a truncated word glued to a fragment of another.
//
// Nothing above could see it. The anti-mirroring invariant is about geometry and
// was perfectly satisfied; the legibility gate measured cap height, which was
// fine; the copy gate read source strings, which were fine. The bug lived in the
// one place nothing looked: between the size the drawing code chose and the
// space the tile actually had.
//
// So this section asserts on WHAT THE DRAWING DID. `WORLD_TEXT_STATS.draws` is
// filled by drawWorldText itself — the shipping code path, on the real build of
// all three tracks — and every entry records the rows it laid out, the size it
// settled on, the width it measured and the limit it had. The checks are
// OCR-free and source-driven: the rows must reassemble into the authored phrase,
// the measured width must fit, and the phrase must be one this project wrote.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n  ONE TEXT PATH — every letter in the world drawn by signdata.js\n  ' + '─'.repeat(78));
{
  const draws = WORLD_TEXT_STATS.draws;
  const prefixes = new Set(draws.map(d => d.key.split(':')[0]));
  // Which mesh each consumer of the shared path ends up on. D32b's lesson: a
  // drawing site that is not tied to a mesh in TEXT_MESHES is a site outside
  // both the fix and the gate.
  const MESH_OF = { signage: 'signage', boards: 'boards', 'holo-signs': 'holo-signs', gantry: 'gantry-board' };

  ok('the shared path drew the world text of all three tracks',
    draws.length >= 3 * SIGN_LINES + BRAND_BOARDS.length + HOLO_BOARDS.length + 3,
    `${draws.length} lines drawn`);
  // The font model and the stub that stands in for a browser here must agree,
  // and BOTH must sit on the far side of the widest face that could render. This
  // is the assertion that would have caught the model being fitted to the one
  // font that happened to be installed on the machine that wrote it.
  ok('the width model is pessimistic against the widest measured font',
    TEXT_ADV_EM >= WIDEST_MEASURED_ADV && STUB_ADV >= WIDEST_MEASURED_ADV,
    `model ${TEXT_ADV_EM} em/char, stub ${STUB_ADV}, widest measured ${WIDEST_MEASURED_ADV} (generic sans-serif)`);
  ok('all four lettered consumers go through it',
    ['signage', 'boards', 'holo-signs', 'gantry'].every(p => prefixes.has(p)),
    [...prefixes].sort().join(', '));
  ok('every consumer of the shared path names a mesh in TEXT_MESHES',
    [...prefixes].every(p => MESH_OF[p] && TEXT_MESHES.has(MESH_OF[p])),
    [...prefixes].map(p => `${p}->${MESH_OF[p] || '??'}`).join(' '));

  // THE assertion the shipped brand/holo atlases fail: nothing overflows.
  ok('no world text overflows its tile', WORLD_TEXT_STATS.overflow === 0,
    WORLD_TEXT_STATS.worst
      ? `"${WORLD_TEXT_STATS.worst.line}" ${WORLD_TEXT_STATS.worst.wpx.toFixed(0)}px in ` +
        `${WORLD_TEXT_STATS.worst.limit.toFixed(0)}px (${WORLD_TEXT_STATS.worst.key})`
      : `${WORLD_TEXT_STATS.drawn} lines, ${WORLD_TEXT_STATS.wrapped} wrapped, ` +
        `${WORLD_TEXT_STATS.shrunk} shrunk to fit`);

  // Measured, per line, against the space it actually had.
  const over = draws.filter(d => d.widthPx > d.limit + 1e-6);
  ok('every measured line fits inside its own tile', over.length === 0,
    over.length ? over.slice(0, 3).map(d => `${d.key} "${d.line}" ${d.widthPx.toFixed(0)}>${d.limit.toFixed(0)}`).join(' | ')
      : `widest fill ${Math.max(...draws.map(d => d.widthPx / d.limit)).toFixed(2)} of the limit`);

  // WHOLE WORDS. Shrink-to-fit and wrapping are allowed; losing a character is
  // not. The rows the fitter produced must reassemble into the authored phrase.
  const cut = draws.filter(d => d.rows.join(' ') !== d.line);
  ok('no line is truncated or broken mid-word', cut.length === 0,
    cut.length ? cut.slice(0, 3).map(d => `${d.key}: "${d.rows.join(' ')}" != "${d.line}"`).join(' | ') : '');

  // The copy on the boards is copy this project authored — not a leftover, not
  // a placeholder, not a fragment of the line next door.
  const authored = new Set(allWorldPhrases().map(p => p.line).concat(TRACKS.map(t => t.nameHe)));
  const unknown = draws.filter(d => !authored.has(d.line));
  ok('every phrase drawn into the world is an authored phrase', unknown.length === 0,
    unknown.length ? [...new Set(unknown.map(d => `${d.key} "${d.line}"`))].slice(0, 4).join(' | ') : '');
  const drawnSet = new Set(draws.map(d => d.line));
  const missing = allWorldPhrases().filter(p => !drawnSet.has(p.line));
  ok('every authored phrase reaches the world', missing.length === 0,
    missing.length ? missing.slice(0, 4).map(p => `${p.source}[${p.index}] "${p.line}"`).join(' | ')
      : `${allWorldPhrases().length} authored phrases, all drawn`);

  // THE ROOT CAUSE, pinned from the BUILT GEOMETRY of all three tracks. A tile
  // whose aspect differs from its board's means the fit budget the drawing code
  // works to is not the metres of board the text really has — which is how "it
  // fits" and "it spills into the next tile" were true at the same time, and it
  // is also why the gantry name has been 2.2x too wide since Wave 1. Derived
  // from the uv rect (the atlases are square canvases, so du/dv IS the tile
  // aspect) rather than from the constants, so it fails if a board is resized
  // without its tile — the realistic regression.
  const wrongAspect = [];
  for (const track of built) {
    track.group.updateMatrixWorld(true);
    track.group.traverse(o => {
      if (!o.isMesh || !TEXT_MESHES.has(o.name)) return;
      const pos = o.geometry.attributes.position, uv = o.geometry.attributes.uv;
      if (!pos || !uv) return;
      const p = new THREE.Vector3();
      for (let qd = 0; qd < pos.count / 4; qd++) {
        const b = qd * 4;
        let lo = Infinity, hi = -Infinity, u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        const pts = [];
        for (let k = 0; k < 4; k++) {
          p.fromBufferAttribute(pos, b + k).applyMatrix4(o.matrixWorld);
          pts.push(p.clone());
          lo = Math.min(lo, p.y); hi = Math.max(hi, p.y);
          u0 = Math.min(u0, uv.getX(b + k)); u1 = Math.max(u1, uv.getX(b + k));
          v0 = Math.min(v0, uv.getY(b + k)); v1 = Math.max(v1, uv.getY(b + k));
        }
        const hM = hi - lo;
        let wM = 0;
        for (const a of pts) for (const c of pts) wM = Math.max(wM, Math.hypot(a.x - c.x, a.z - c.z));
        if (hM < 1e-6 || wM < 1e-6) continue;
        // The gantry board carries its own answer: its material samples a 4:1
        // strip and the name is pre-compressed to suit (see gantryTexture).
        const want = o.userData.textAspect ?? ((u1 - u0) / (v1 - v0));
        const got = wM / hM;
        if (Math.abs(got / want - 1) > 0.03) {
          wrongAspect.push(`${track.def.id}/${o.name} board ${got.toFixed(2)}:1 vs text ${want.toFixed(2)}:1`);
        }
      }
    });
  }
  ok('every lettered board has its texture tile\'s aspect (text is not stretched)',
    wrongAspect.length === 0,
    wrongAspect.length ? [...new Set(wrongAspect)].slice(0, 4).join(' | ')
      : `signage ${SIGN_TILE_ASPECT}:1, boards ${BRAND_TILE_ASPECT}:1, holo ${HOLO_TILE_ASPECT}:1, gantry pre-compressed`);

  // Wrapping is the fitter's answer to a line too long for one row, and it must
  // never lose a word. Exercised directly because the shipping boards are wide
  // enough that a single row always wins — which is exactly why the branch would
  // otherwise rot unnoticed.
  const long = 'מנוע פרומפט חזק מאוד';
  const wrapped = fitText(long, 1.0);
  ok('the fitter wraps rather than truncating when a row will not fit',
    wrapped.rows.length === 2 && wrapped.rows.join(' ') === long,
    `${wrapped.rows.length} rows: ${wrapped.rows.join(' / ')}`);
  ok('wrapping buys a bigger glyph than cramming one row',
    wrapped.fontFrac > fitText(long, 1.0, { maxRows: 1 }).fontFrac,
    `${wrapped.fontFrac.toFixed(3)} vs ${fitText(long, 1.0, { maxRows: 1 }).fontFrac.toFixed(3)} em`);

  // D38's floor, applied to the two board families that never had one. Cap
  // height in metres, and what that is in pixels at the distance each is read
  // from (px = 547 * capMetres / distance at 1600x900, fov 62).
  const capOf = (line, aspect, hM, opts) => fitText(line, aspect, opts).capFrac * hM;
  const brandCaps = BRAND_BOARDS.map(b => capOf(b.he, BRAND_TILE_ASPECT, BRAND_BOARD_H));
  const holoCaps = HOLO_BOARDS.map(b => capOf(b.he, HOLO_TILE_ASPECT, HOLO_BOARD_H, { fitH: 0.60 }));
  const minBrand = Math.min(...brandCaps), minHolo = Math.min(...holoCaps);
  ok('barrier boards clear the legibility floor (>=0.30 m of cap)', minBrand >= 0.30,
    `smallest ${minBrand.toFixed(3)} m = ${(547 * minBrand / 12).toFixed(1)} px read at 12 m`);
  ok('holo billboards clear the legibility floor (>=0.60 m of cap)', minHolo >= 0.60,
    `smallest ${minHolo.toFixed(3)} m = ${(547 * minHolo / 30).toFixed(1)} px read at 30 m`);
}

/**
 * Every roadside board of a built track, in the order a driver passes it after
 * the start line, with the ATLAS TILE it carries read back out of the uv buffer.
 * `tile` is the index into TRACK_SIGNS[theme].lines.
 */
function boardOrder(track, def) {
  const mesh = track.group.getObjectByName('signage');
  if (!mesh) return [];
  track.group.updateMatrixWorld(true);
  const pos = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
  const seen = new Map();
  const p = new THREE.Vector3();
  for (let qd = 0; qd < pos.count / 4; qd++) {
    const b = qd * 4;
    const c = new THREE.Vector3();
    let u0 = Infinity, v0 = Infinity;
    for (let k = 0; k < 4; k++) {
      p.fromBufferAttribute(pos, b + k).applyMatrix4(mesh.matrixWorld);
      c.add(p);
      u0 = Math.min(u0, uv.getX(b + k)); v0 = Math.min(v0, uv.getY(b + k));
    }
    c.multiplyScalar(0.25);
    const tile = signTileIndex(u0, v0);
    // Two back-to-back faces per board: one entry each.
    if (seen.has(tile)) continue;
    const s = track.spline.closestT(c);
    seen.set(tile, { tile, arc: ((s.t - def.startT) % 1 + 1) % 1 });
  }
  return [...seen.values()].sort((a, b) => a.arc - b.arc).map((b, i) => ({ ...b, pos: i }));
}

console.log('\n  ROADSIDE SIGNAGE — placement, clearance, thinning\n  ' + '─'.repeat(78));
for (let i = 0; i < TRACKS.length; i++) {
  const def = TRACKS[i], track = built[i];
  const signs = track.group.getObjectByName('signage');
  const panels = signs ? signs.geometry.index.count / 6 : 0;   // 2 tris per quad
  ok(`${def.id}: roadside signage exists`, !!signs && panels >= 6,
    `${panels} faces = ${panels / 2} back-to-back boards`);

  // Clearance: nothing we added may stand in the drivable corridor.
  const hits = auditTrackClearance(track, { log: false });
  const ours = hits.filter(h => /^signage/.test(h.mesh));
  ok(`${def.id}: signage clear of the racing line`, ours.length === 0,
    ours.length ? ours.map(h => `${h.mesh} lateral=${h.lateral.toFixed(2)}`).join(', ') : '');
  ok(`${def.id}: whole track clear of the racing line`, hits.length === 0,
    hits.length ? hits.map(h => h.mesh).join(', ') : '');

  // Mid-ground band: the depth rung GAPS.md calls the best visual move left.
  // "Beyond +12 m" alone was too weak to see the bug it was written for — every
  // Cloud Peak board sat pinned at exactly 17 m and sailed through it, giving
  // the finale no depth rung at all. So this also demands a SPREAD: boards at
  // one distance are a fence, not a rung.
  const faces = textFaces(track).filter(f => f.mesh === 'signage');
  const outs = faces.map(f => Math.abs(f.lateral) - track.spline.widthAt(f.t));
  const midOuts = outs.filter(o => o > 12);
  const spread = midOuts.length ? Math.max(...midOuts) - Math.min(...midOuts) : 0;
  ok(`${def.id}: some signage sits in the mid-ground band`, midOuts.length >= 8,
    `${midOuts.length / 4} of ${faces.length / 4} boards beyond +12 m`);
  ok(`${def.id}: the mid-ground band has depth (>=6 m of spread)`, spread >= 6,
    `${spread.toFixed(1)} m between nearest and furthest`);

  // ── THE CURRICULUM IS A SEQUENCE, NOT A BAG ────────────────────────────────
  // TRACK_SIGNS[theme].lines is written in the order a child should meet it:
  // the early boards need no vocabulary, the late ones echo glossary terms the
  // game has already taught. That is worth nothing unless the ORDER ON THE
  // GROUND is the order in the list — one shuffled index, or a random pick per
  // board, and the progression is decoration. Derived from the built UV buffer,
  // not from the placement code, so it holds however the boards get placed.
  const order = boardOrder(track, def);
  const back = order.filter((b, k) => k > 0 && b.tile <= order[k - 1].tile);
  ok(`${def.id}: boards carry the authored lines IN ORDER along the lap`,
    order.length >= 6 && back.length === 0,
    back.length ? `board ${back[0].pos} of ${order.length} shows line ${back[0].tile}, after ${order[back[0].pos - 1].tile}`
      : `${order.length} boards, tiles ${order.map(b => b.tile).join(',')} from the start line`);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE WHOLE LIST REACHES THE GROUND — at EVERY quality tier.
//
// The gap this closes. `placeSignage` sized its board count from the lap length
// alone (`round(L / step)`) and then handed out atlas tiles in list order, first
// come first served. Nothing tied the two numbers together and nothing checked
// them against each other, so the last two lines of every track never reached
// the high tier, the last six never reached medium and the last TEN never
// reached low — and it is the tail of each list that carries the payoff and the
// glossary echoes (`זה מודל שפה` is glos.llm.term; `שם רצים מודלים` is the last
// sentence of glos.cloud.def). A child on a school laptop met the first six
// lines of a twelve-line lesson and none of the conclusion.
//
// The check that would have caught it, and now does: at every tier the sequence
// on the ground must be STRICTLY INCREASING (the progression is a sequence),
// must START at line 0 and END at the last line (it spans the whole list), and
// must not skip more than one "stride" anywhere (it samples evenly rather than
// taking a clump). Derived from the built UV buffers of a real build at each
// tier, not from the placement arithmetic.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n  CURRICULUM COVERAGE — every tier gets the whole lesson\n  ' + '─'.repeat(78));
const TIERS = [
  ['high', engineAt(1, 512)],
  ['medium', engineAt(0.7, 512)],
  ['low', engineAt(0.35, 256)],
];
for (const def of TRACKS) {
  const N = (TRACK_SIGNS[def.theme] || TRACK_SIGNS.oasis).lines.length;
  for (const [tier, eng] of TIERS) {
    const tr = buildTrack(def.id, eng, { audit: false });
    const tiles = boardOrder(tr, def).map(b => b.tile);
    const rising = tiles.every((v, k) => k === 0 || v > tiles[k - 1]);
    const stride = Math.ceil((N - 1) / Math.max(1, tiles.length - 1));
    const gap = tiles.reduce((m, v, k) => (k ? Math.max(m, v - tiles[k - 1]) : m), 0);
    ok(`${def.id}/${tier}: the placed lines span the whole authored list`,
      tiles.length >= 3 && rising && tiles[0] === 0 && tiles[tiles.length - 1] === N - 1 &&
      gap <= stride + 1,
      `${tiles.length} of ${N} lines: [${tiles.join(',')}]${rising ? '' : ' NOT RISING'} biggest gap ${gap} (stride ${stride})`);
    // ...and the tier that can carry them all must carry them all. This is the
    // assertion that ties the list length to the board budget: author a
    // thirteenth line without widening the budget and this goes red, rather
    // than the line silently never being built.
    if (tier === 'high') {
      const set = new Set(tiles);
      const missing = [...Array(N).keys()].filter(k => !set.has(k));
      ok(`${def.id}/high: EVERY authored line is on the ground`, missing.length === 0,
        missing.length ? `lines ${missing.join(',')} never placed` : `all ${N} placed`);
    }
    tr.dispose();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGIBILITY GATE — the curriculum has to be READABLE, not merely present.
//
// Round 1 shipped 14 correctly-lettered, correctly-themed, factually-true boards
// per lap, and then rendered their Hebrew at 6.5-8 px of cap height from the
// driver's seat: texture, not text. The gate that shipped with it could not see
// that at all — it asserted only that boards exist and sit beyond +12 m, both of
// which a 7 px sign passes with room to spare.
//
// So this measures what a child actually sees. It rebuilds the chase camera's
// steady-state geometry (CHASE_PRESETS.chase: 5.5 m back, 3.25 m up, looking up
// the racing line), walks it around the lap, and for every sign panel in frame
// projects the GLYPH CAP HEIGHT — not the board — into pixels at 1600x900:
//
//     px = capMetres * (H/2) / (tan(fov/2) * distance)
//
// Cap height in metres is `signLayout(line).capFrac * boardHeightMetres`, which
// is why sign sizing had to become analytic: a size decided inside a canvas draw
// callback is invisible to any headless gate, and that invisibility is precisely
// how it shrank to 0.13 em without anyone noticing.
// ─────────────────────────────────────────────────────────────────────────────
const CAM = { dist: 5.5, height: 3.25, fov: 62, W: 1600, H: 900, samples: 400 };

/**
 * Cap height, as a fraction of the board's height, OF THE SIZE THE SHIPPING CODE
 * ACTUALLY SETTLED ON — keyed 'signage:<theme>:<line index>' out of the draw log
 * that `drawWorldText` writes as it letters the atlas.
 *
 * The legibility table below used to be computed from `signLayout`, the ANALYTIC
 * model. That is the same shape of mistake as D38's "the size was decided where
 * no gate could see it", one step further along: the size was now visible, but
 * the gate was reading the PROPOSAL rather than the settlement. Whenever the
 * real-font clamp shrinks a line — which is exactly what happens when the font
 * on the machine is wider than the model — every number in the table would have
 * been an overstatement, and nothing here would have said so.
 *
 * The minimum across atlas sizes, because the same theme is baked at 1024 px on
 * the high tier and 512 px on the low one and the px floor rounds differently.
 */
const drawnCapFrac = (() => {
  const m = new Map();
  for (const d of WORLD_TEXT_STATS.draws) {
    if (!d.key.startsWith('signage:')) continue;
    const prev = m.get(d.key);
    if (prev === undefined || d.capFrac < prev) m.set(d.key, d.capFrac);
  }
  return m;
})();

/** Every sign panel of a built track, in world space, with its glyph size. */
function signPanels(track) {
  const out = [];
  const theme = track.def.theme;
  const lines = (TRACK_SIGNS[theme] || TRACK_SIGNS.oasis).lines;
  track.group.updateMatrixWorld(true);
  track.group.traverse(o => {
    if (!o.isMesh || o.name !== 'signage') return;
    const pos = o.geometry.attributes.position, uv = o.geometry.attributes.uv;
    const idx = o.geometry.index;
    if (!pos || !uv || !idx) return;
    const quads = pos.count / 4;
    const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let qd = 0; qd < quads; qd++) {
      const b = qd * 4;
      for (let k = 0; k < 4; k++) p[k].fromBufferAttribute(pos, b + k).applyMatrix4(o.matrixWorld);
      const c = p[0].clone().add(p[1]).add(p[2]).add(p[3]).multiplyScalar(0.25);
      let lo = Infinity, hi = -Infinity, u0 = Infinity, v0 = Infinity;
      for (let k = 0; k < 4; k++) {
        lo = Math.min(lo, p[k].y); hi = Math.max(hi, p[k].y);
        u0 = Math.min(u0, uv.getX(b + k)); v0 = Math.min(v0, uv.getY(b + k));
      }
      // Normal of the face as it will actually be rasterised (post-repair index).
      const ia = idx.getX(qd * 6), ib = idx.getX(qd * 6 + 1), ic = idx.getX(qd * 6 + 2);
      const a = new THREE.Vector3().fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
      const bb = new THREE.Vector3().fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
      const cc = new THREE.Vector3().fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      const n = bb.clone().sub(a).cross(cc.clone().sub(a)).normalize();
      // Which atlas tile, and therefore which line of copy, is on this face?
      const col = Math.round(u0 * SIGN_COLS);
      const row = SIGN_ROWS - 1 - Math.round(v0 * SIGN_ROWS);
      const tile = row * SIGN_COLS + col;
      const line = lines[tile % lines.length] ?? '';
      const h = hi - lo;
      // The size the DRAWING settled on, not the size the model proposed. Falls
      // back to the analytic layout only if the atlas was never drawn (it always
      // is, and `drawn caps come from the shipping path` below pins that).
      const capFrac = drawnCapFrac.get(`signage:${theme}:${tile}`)
        ?? signLayout(line, SIGN_TILE_ASPECT).capFrac;
      out.push({ c, n, h, line, tile, cap: capFrac * h, analytic: signLayout(line, SIGN_TILE_ASPECT).capFrac * h });
    }
  });
  return out;
}

/**
 * Walk a chase camera round the lap and record, per sample, the cap height in
 * pixels of the most readable sign on screen — and, per board, the best it is
 * ever seen at.
 */
function capHeightProfile(track) {
  const { spline } = track;
  const panels = signPanels(track);
  const cam = new THREE.PerspectiveCamera(CAM.fov, CAM.W / CAM.H, 0.5, 2000);
  const frustum = new THREE.Frustum();
  const mat = new THREE.Matrix4();
  const kPx = (CAM.H / 2) / Math.tan((CAM.fov * Math.PI / 180) / 2);
  const best = [];
  const perPanel = new Float64Array(panels.length);
  for (let s = 0; s < CAM.samples; s++) {
    const t = s / CAM.samples;
    const fr = spline.frameAt(t);
    cam.position.set(
      fr.pos.x - fr.tan.x * CAM.dist, fr.pos.y + CAM.height, fr.pos.z - fr.tan.z * CAM.dist);
    // Look up the racing line the way ChaseCamera does, not at the kart's feet.
    const near = spline.offsetPoint((t + 9 / spline.length) % 1, 0);
    const far = spline.offsetPoint((t + 24 / spline.length) % 1, 0);
    cam.lookAt(near.clone().multiplyScalar(0.76).addScaledVector(far, 0.24).setY(
      near.y * 0.76 + far.y * 0.24 + 0.15));
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    frustum.setFromProjectionMatrix(mat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let px = 0;
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      if (p.n.dot(cam.position.clone().sub(p.c)) <= 0) continue;   // facing away
      if (!frustum.containsPoint(p.c)) continue;
      const d = cam.position.distanceTo(p.c);
      if (d > 700) continue;
      const v = p.cap * kPx / d;
      if (v > perPanel[i]) perPanel[i] = v;
      px = Math.max(px, v);
    }
    best.push(px);
  }
  // Two faces per board; a board's score is the better of its two faces.
  const boards = [];
  for (let i = 0; i < perPanel.length; i += 2) boards.push(Math.max(perPanel[i], perPanel[i + 1]));
  return { best, boards, panels };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

console.log('\n  LEGIBILITY — can a kid actually READ a sign at racing speed?\n  ' + '─'.repeat(78));
console.log('    chase cam ' + CAM.dist + ' m back, ' + CAM.height + ' m up, fov ' + CAM.fov +
  ', ' + CAM.W + 'x' + CAM.H + ', ' + CAM.samples + ' samples/lap\n');
for (let i = 0; i < TRACKS.length; i++) {
  const def = TRACKS[i], { best, boards, panels: panelsOf } = capHeightProfile(built[i]);
  const max = Math.max(...best), med = median(best);
  const pct14 = best.filter(v => v >= 14).length / best.length;
  const boardMed = median(boards);
  console.log(`    ${def.id.padEnd(8)} median-best ${med.toFixed(1)} px | max ${max.toFixed(1)} px | ` +
    `${(pct14 * 100).toFixed(0)}% of lap >= 14 px | per-board best: median ${boardMed.toFixed(1)} px`);

  // THE assertion the shipped sizing fails: somewhere on every lap, one sign must
  // be big enough to read at 90 km/h. 18 px of cap height is roughly a 24 px
  // font — about the smallest a child reads reliably off a moving board.
  ok(`${def.id}: a sign reaches readable size on the lap (>=18 px cap)`,
    max >= 18, `max ${max.toFixed(1)} px`);

  // ...and it must not be one freak board on one freak frame. Per BOARD, because
  // that is the unit of teaching: a lap-wide average can be carried by a single
  // huge sign while thirteen others stay unreadable. The median board has to be
  // readable at its own best moment, and nearly all of them must get close.
  ok(`${def.id}: the median board becomes readable (>=18 px at its best)`,
    boardMed >= 18, `median board peaks at ${boardMed.toFixed(1)} px`);
  // PER BOARD, with no aggregate to hide behind. This was `>=85% reach 14 px`,
  // and 85% of 14 boards is twelve — so two boards a lap could sit permanently
  // under D38's floor and the gate would call it fine. It did: circuit's
  // 'סיבוב אימון' peaked at 12.5 px on every lap of its life, and nothing said
  // so, because the one number printed was an average. A floor that a named
  // exception may sit under is a decision; a floor that anonymous boards fall
  // through is a hole. EXEMPT is empty, and if it ever is not, the line that is
  // under the floor has to be written down here by hand.
  const EXEMPT = new Set([]);
  const shortfall = boards
    .map((v, k) => ({ px: v, line: panelsOf[k * 2]?.line || '?' }))
    .filter(b => b.px < 14 && !EXEMPT.has(b.line));
  ok(`${def.id}: EVERY board is readable at some point on the lap (>=14 px cap)`,
    shortfall.length === 0,
    shortfall.length
      ? shortfall.map(b => `"${b.line}" peaks at ${b.px.toFixed(1)} px`).join(' | ')
      : `${boards.length} boards, worst peaks at ${Math.min(...boards).toFixed(1)} px`);

  // Ambient, not incidental: a readable board should be on screen for a real
  // share of the lap, not for one corner of it. (Round 1: 0-1%.)
  ok(`${def.id}: readable signage recurs across the lap (>=15% of lap >= 14 px)`,
    pct14 >= 0.15, `${(pct14 * 100).toFixed(0)}% of the lap`);

  // One lap, one reading of each line. The atlas held 8 tiles against 14 boards,
  // so six boards a lap repeated a line the player had already passed — which
  // reads as a rendering mistake, not as a curriculum.
  const shown = signPanels(built[i]).map(p => p.line);
  const uniq = new Set(shown);
  ok(`${def.id}: no board repeats another's copy on a lap`, uniq.size === shown.length / 2,
    `${uniq.size} distinct lines on ${shown.length / 2} boards`);
}

{
  const hi = buildTrack('oasis', engineAt(1), { audit: false, dress: false });
  const lo = buildTrack('oasis', engineAt(0.35, 256), { audit: false, dress: false });
  const count = tr => {
    const s = tr.group.getObjectByName('signage');
    return s ? s.geometry.index.count / 12 : 0;    // boards (2 faces each)
  };
  ok('signage thins out on the low quality tier', count(lo) < count(hi),
    `low=${count(lo)} boards, high=${count(hi)} boards`);
  ok('low tier still keeps some signage', count(lo) >= 3, `low=${count(lo)}`);
  hi.dispose(); lo.dispose();
}

{
  // The SAME question of the other two lettered families. They were exempt: the
  // barrier boards were gated on a raw rng threshold and the holo billboards on
  // a fixed 62 m step, so the low tier carried every one of them — lettered
  // furniture is a texture upload and a draw call like anything else.
  // Circuit City, because it is the only track with holo billboards.
  const hi = buildTrack('circuit', engineAt(1), { audit: false });
  const lo = buildTrack('circuit', engineAt(0.35, 256), { audit: false });
  const quads = (tr, name) => {
    const m = tr.group.getObjectByName(name);
    return m ? m.geometry.index.count / 6 : 0;
  };
  ok('barrier sponsor boards thin out on the low quality tier',
    quads(lo, 'boards') < quads(hi, 'boards'),
    `low=${quads(lo, 'boards')}, high=${quads(hi, 'boards')}`);
  ok('low tier still keeps some sponsor boards', quads(lo, 'boards') >= 3, `low=${quads(lo, 'boards')}`);
  ok('holo billboards thin out on the low quality tier',
    quads(lo, 'holo-signs') < quads(hi, 'holo-signs'),
    `low=${quads(lo, 'holo-signs')}, high=${quads(hi, 'holo-signs')}`);
  ok('low tier still keeps some holo billboards', quads(lo, 'holo-signs') >= 3,
    `low=${quads(lo, 'holo-signs')}`);
  hi.dispose(); lo.dispose();
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTHING STANDS IN FRONT OF A BOARD — checked as a RECTANGLE, not as a point.
//
// `signOccluded` walks a candidate inward until the view is clear, and it used
// to ray-test the board's CENTRE only. A board is 14.6 m x 3.65 m: a canopy roof
// and two of its beams crossed the top-left of oasis's 'פחות טעויות' while the
// centre ray flew clean between them (shots/w5c-crop-mid4k.png), and the
// placement code called that clear. This re-runs the same question on the BUILT
// track — centre plus four inner corners, from the two distances a board is read
// from — so the fix cannot quietly regress to a point test.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n  OCCLUSION — the whole board is visible, not just its middle\n  ' + '─'.repeat(78));
for (let i = 0; i < TRACKS.length; i++) {
  const def = TRACKS[i], track = built[i];
  const { spline } = track;
  const L = spline.length;
  // Tall, cheap geometry — the same deliberately name-free rule the placement
  // uses, restated here rather than imported so the gate is not the code.
  const blockers = [];
  const bb = new THREE.Box3();
  track.group.updateMatrixWorld(true);
  track.group.traverse(o => {
    if (!o.isMesh || !o.geometry || /^signage/.test(o.name)) return;
    const g = o.geometry;
    const tris = (g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3;
    if (tris < 1 || tris > 20000) return;
    bb.setFromObject(o);
    if (bb.max.y - bb.min.y < 3) return;
    blockers.push(o);
  });
  const ray = new THREE.Raycaster();
  const blocked = [];
  for (const p of signPanels(track)) {
    const u = signUAxis(p.n);
    const t = spline.closestT(p.c).t;
    const probes = [p.c];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        probes.push(new THREE.Vector3(
          p.c.x + u.x * sx * (p.h * SIGN_TILE_ASPECT) * 0.40,
          p.c.y + sy * p.h * 0.40,
          p.c.z + u.z * sx * (p.h * SIGN_TILE_ASPECT) * 0.40));
      }
    }
    for (const back of [45, 28]) {
      const rp = spline.offsetPoint(((t - back / L) % 1 + 1) % 1, 0);
      const eye = new THREE.Vector3(rp.x, rp.y + 3.25, rp.z);
      for (const q of probes) {
        const dir = q.clone().sub(eye);
        const d = dir.length();
        if (d < 1) continue;
        ray.set(eye, dir.multiplyScalar(1 / d));
        ray.near = 0.5; ray.far = d - 1.0;
        const hit = ray.intersectObjects(blockers, false);
        if (hit.length) {
          blocked.push(`"${p.line}" blocked from ${back} m back by ${hit[0].object.name || '(unnamed)'}`);
        }
      }
    }
  }
  ok(`${def.id}: no board is blocked at its centre OR its corners`, blocked.length === 0,
    blocked.length ? [...new Set(blocked)].slice(0, 3).join(' | ')
      : `${signPanels(track).length / 2} boards x 5 points x 2 read distances clear`);
}

console.log('\n  COPY — ambient curriculum, short enough to be READ\n  ' + '─'.repeat(78));
// Length is optics, not style: cap height is 0.4 * boardWidth / characters, so
// every extra character costs the board ~7% of its legibility. A 24-character
// line on a 13 m board renders at 0.22 m of Hebrew — 6 px from the driver's
// seat. This is the assertion that stops good copy from being written too long
// to teach anything.
for (const [theme, set] of Object.entries(TRACK_SIGNS)) {
  const bad = set.lines.filter(l => {
    const w = l.trim().split(/\s+/).length;
    return w < 2 || w > 3 || l.length > SIGN_MAX_CHARS || !/[֐-׿]/.test(l);
  });
  const longest = [...set.lines].sort((a, b) => b.length - a.length)[0];
  ok(`${theme}: ${SIGN_LINES} Hebrew signs, 2-3 words, <= ${SIGN_MAX_CHARS} chars`,
    set.lines.length === SIGN_LINES && bad.length === 0,
    bad.length ? bad.join(' | ') : `longest "${longest}" = ${longest.length}`);
  ok(`${theme}: no duplicate copy`, new Set(set.lines).size === set.lines.length);
}
ok(`the atlas has a tile for every authored line`, SIGN_LINES <= SIGN_COLS * SIGN_ROWS,
  `${SIGN_LINES} lines in ${SIGN_COLS}x${SIGN_ROWS} = ${SIGN_COLS * SIGN_ROWS} tiles`);

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE BOARDS SAY — the half of the gate that was missing entirely.
//
// Everything above this line checks the MECHANISM: geometry, fit, order, size.
// A critic mutated the exported phrase data before importing this file (ESM
// singletons, no source edit) and got three green runs that each shipped
// something the project forbids:
//
//   * every track's curriculum REVERSED — the payoff on board one, the opening
//     line at the flag. Green, because "IN ORDER" compares a tile index to a lap
//     position and both reversed together.
//   * real company names on two world boards. Green: tools/verify.mjs's sweep
//     does not reach these strings, and nothing here looked.
//   * two lines replaced with non-words. Green, because "every phrase drawn is
//     an authored phrase" validates the draws against the array they were drawn
//     FROM — it is circular, and can only ever catch a drawing bug.
//
// The three assertions below are the ones those mutants fail. Each is anchored
// OUTSIDE the phrase list — on the glossary in core/badges.js, on a list of real
// trademarks, and on a lexicon that has to be edited deliberately — because an
// assertion that reads only the data under test cannot judge it.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n  CONTENT — the boards say what the curriculum says they say\n  ' + '─'.repeat(78));
{
  const norm = (s) => String(s).replace(/[־‐-―-]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = (s) => norm(s).split(' ').filter(Boolean);
  const phrases = allWorldPhrases();

  // ── 1. THE PAYOFF LANDS LAST ───────────────────────────────────────────────
  // Each track declares the word its last board exists to deliver. Three things
  // are asserted, and reversing the list breaks all three: the word is one the
  // GAME'S GLOSSARY teaches (external anchor — core/badges.js, which no mutation
  // of the phrase list can reach); it appears on exactly ONE board; and that
  // board is the last one. Note what is deliberately NOT asserted: which words
  // the other eleven boards use. D42 — gate the property, anchor one string.
  const glossary = Object.entries(BADGES.GLOSSARY_STRINGS.he)
    .filter(([k]) => /\.(term|def)$/.test(k)).map(([, v]) => v).join(' \n ');
  for (const [theme, set] of Object.entries(TRACK_SIGNS)) {
    const payoff = set.payoff || '';
    const hits = set.lines.map((l, i) => [l, i]).filter(([l]) => norm(l).includes(norm(payoff)));
    ok(`${theme}: the payoff word "${payoff}" is a word the glossary teaches`,
      !!payoff && glossary.includes(payoff),
      payoff ? `found in GLOSSARY_STRINGS.he` : 'no payoff declared');
    ok(`${theme}: the payoff is on exactly one board, and it is the LAST one`,
      hits.length === 1 && hits[0][1] === set.lines.length - 1,
      hits.length === 1
        ? `line ${hits[0][1]} of ${set.lines.length}: "${hits[0][0]}"`
        : `${hits.length} boards carry it: ${hits.map(h => `[${h[1]}] "${h[0]}"`).join(' ')}`);
  }

  // ── 2. NO REAL TRADEMARKS ANYWHERE IN THE WORLD ────────────────────────────
  // "All-original content" is a contest rule, and a disqualifying one. The brand
  // boards and holo billboards are invented identities on purpose; this is what
  // stops the next agent (or a well-meant "make it feel real" edit) from putting
  // a real logo on a barrier. Whole-word matching over the normalised phrase, so
  // 'ברק אנרגיה' is not tripped by a substring of somebody's trademark.
  const TRADEMARKS = [
    // Hebrew transliterations a Hebrew-first game would actually reach for.
    ['קוקה', 'קולה'], ['קולה'], ['מקדונלדס'], ['מקדונלד'], ['בורגר', 'קינג'], ['פפסי'],
    ['נייקי'], ['אדידס'], ['פומה'], ['גוגל'], ['אפל'], ['מיקרוסופט'], ['אמזון'],
    ['פייסבוק'], ['אינסטגרם'], ['טיקטוק'], ['יוטיוב'], ['נטפליקס'], ['סמסונג'],
    ['אינטל'], ['אנבידיה'], ['טסלה'], ['פרארי'], ['מרצדס'], ['טויוטה'], ['יונדאי'],
    ['פורד'], ['שברולט'], ['פורשה'], ['רד', 'בול'], ['שופרסל'], ['אלביט'], ['לגו'],
    ['דיסני'], ['פוקימון'], ['נינטנדו'], ['מריו'], ['סוני'], ['אוסם'], ['תנובה'],
    // ...and the Latin ones, for the English build and for any future ASCII copy.
    ['coca'], ['cola'], ['pepsi'], ['mcdonalds'], ['nike'], ['adidas'], ['google'],
    ['apple'], ['microsoft'], ['amazon'], ['facebook'], ['netflix'], ['samsung'],
    ['intel'], ['nvidia'], ['tesla'], ['ferrari'], ['mercedes'], ['toyota'], ['ford'],
    ['redbull'], ['shell'], ['disney'], ['pokemon'], ['nintendo'], ['lego'],
    ['openai'], ['chatgpt'], ['gemini'], ['copilot'],
  ];
  const ipHits = [];
  for (const p of phrases) {
    const w = words(p.line).map(x => x.toLowerCase());
    for (const brand of TRADEMARKS) {
      for (let i = 0; i + brand.length <= w.length; i++) {
        if (brand.every((b, k) => w[i + k] === b)) ipHits.push(`${p.source}[${p.index}] "${p.line}" ~ ${brand.join(' ')}`);
      }
    }
  }
  ok('no real company or product name on any world board', ipHits.length === 0,
    ipHits.length ? ipHits.slice(0, 4).join(' | ')
      : `${phrases.length} phrases swept against ${TRADEMARKS.length} trademarks`);

  // ── 3. EVERY WORD IS A WORD ────────────────────────────────────────────────
  // The lexicon is a SEPARATE artifact from the phrase list on purpose: it is
  // the second signature on every word that reaches a child's eye. Adding a word
  // to a board means adding it here too, which is a moment to ask whether an
  // eight-year-old knows it (D41 rejected שדה, סף הפעלה and משאב לפי מידה at
  // exactly that moment). Swapping a line for `קרשט בלגמ` — the critic's mutant,
  // and equally a mojibake or a half-copied paste — fails here and cannot be
  // made to pass by editing the copy alone.
  const LEXICON = new Set([
    // — the roadside curriculum —
    'או', 'אוספים', 'אות', 'אחר', 'אימון', 'אלפי', 'בינה', 'במקום', 'בענן',
    'דוגמאות', 'דוגמה', 'דולק', 'דפוס', 'החיבור', 'הלאה', 'הרבה', 'וטבלאות',
    'ומילים', 'זה', 'זמין', 'חוזר', 'חיבור', 'טובה', 'טוקנים', 'טעויות', 'טעות',
    'כבוי', 'מאגר', 'מאובטח', 'מהירה', 'מודל', 'מודלים', 'מחשב', 'מחשבים',
    'מידע', 'מכל', 'מלמדת', 'מספרים', 'מקום', 'מרכז', 'משתנה', 'מתחלקת',
    'נוירון', 'נוירונים', 'נכנסים', 'נסתרת', 'נקיים', 'נתוני', 'נתונים', 'עבודה',
    'עובר', 'עולמית', 'על', 'עמוקה', 'ענן', 'פחות', 'קטן', 'רחוק', 'רצים', 'רשת',
    'שכבה', 'שם', 'שפה', 'שרת', 'תמונות', 'תשובה',
    // — the invented racing-series identities (barrier boards, holo billboards) —
    'טורבו', 'ברק', 'אנרגיה', 'נחל', 'אלגו', 'גיר', 'מנוע', 'פרומפט', 'טק',
    'דאטה', 'סיטי', 'אקספרס', 'פיקסל', 'אור',
  ]);
  const strange = [];
  for (const p of phrases) {
    for (const w of words(p.line)) if (!LEXICON.has(w)) strange.push(`${p.source}[${p.index}] "${w}" in "${p.line}"`);
  }
  ok('every word on every world board is in the approved lexicon', strange.length === 0,
    strange.length ? strange.slice(0, 5).join(' | ')
      : `${new Set(phrases.flatMap(p => words(p.line))).size} distinct words, all approved`);
  // ...and the lexicon must not rot into a rubber stamp: a word nobody uses any
  // more is a word nobody re-read when it was added.
  const used = new Set(phrases.flatMap(p => words(p.line)));
  const stale = [...LEXICON].filter(w => !used.has(w));
  ok('the lexicon carries no words the boards stopped using', stale.length === 0,
    stale.length ? stale.join(' ') : `${LEXICON.size} words, all in use`);
}

console.log('\n  TRACK 2 RENAME — display names change, the saved id does not\n  ' + '─'.repeat(78));
{
  const t2 = TRACKS[1];
  ok('track 2 Hebrew name is עיר הנוירונים', t2.nameHe === 'עיר הנוירונים', t2.nameHe);
  ok('track 2 English name is Neuron City', t2.nameEn === 'Neuron City', t2.nameEn);
  ok('the old name is gone from both languages',
    !/המעגלים/.test(t2.nameHe) && !/Circuit City/i.test(t2.nameEn));
  // SAVE COMPATIBILITY: results[] persists the id, not the name.
  ok('track 2 id is still "circuit" (saves resolve)', t2.id === 'circuit', t2.id);
  ok('track 2 theme is still "circuit" (palettes/skins key off it)', t2.theme === 'circuit');
  ok('getTrack("circuit") still resolves', getTrack('circuit').def === t2);
  ok('the gantry reads the new name', getTrack(1).def.nameHe === 'עיר הנוירונים');
}

for (const t of built) t.dispose();

console.log('\n  ' + (failed
  ? `\x1b[31m${failed} check(s) failed\x1b[0m`
  : '\x1b[32mall signage checks passed\x1b[0m') + '\n');
process.exit(failed ? 1 : 0);

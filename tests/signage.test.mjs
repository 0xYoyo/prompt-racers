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
          return (s) => ({ width: String(s).length * 8 });
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
  signLayout, signUV, SIGN_COLS, SIGN_ROWS, SIGN_TILE_ASPECT, SIGN_MAX_CHARS } =
  await import('../src/track/trackbuild.js');
const { TRACKS, getTrack } = await import('../src/track/trackdef.js');

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
      const line = lines[(row * SIGN_COLS + col) % lines.length] ?? '';
      const h = hi - lo;
      out.push({ c, n, h, line, cap: signLayout(line, SIGN_TILE_ASPECT).capFrac * h });
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
  const def = TRACKS[i], { best, boards } = capHeightProfile(built[i]);
  const max = Math.max(...best), med = median(best);
  const pct14 = best.filter(v => v >= 14).length / best.length;
  const boardMed = median(boards);
  const reach14 = boards.filter(v => v >= 14).length / boards.length;
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
  ok(`${def.id}: nearly every board is readable at some point (>=85% reach 14 px)`,
    reach14 >= 0.85, `${(reach14 * 100).toFixed(0)}% of ${boards.length} boards`);

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
  ok(`${theme}: ${SIGN_COLS * SIGN_ROWS} Hebrew signs, 2-3 words, <= ${SIGN_MAX_CHARS} chars`,
    set.lines.length === SIGN_COLS * SIGN_ROWS && bad.length === 0,
    bad.length ? bad.join(' | ') : `longest "${longest}" = ${longest.length}`);
  ok(`${theme}: no duplicate copy`, new Set(set.lines).size === set.lines.length);
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

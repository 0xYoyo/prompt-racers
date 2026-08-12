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
const { buildTrack, auditTrackClearance, signUAxis, TEXT_MESHES, TRACK_SIGNS } =
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
  const faces = textFaces(track).filter(f => f.mesh === 'signage');
  const mid = faces.filter(f => Math.abs(f.lateral) > track.spline.widthAt(f.t) + 12).length;
  ok(`${def.id}: some signage sits in the mid-ground band`, mid >= 2,
    `${mid / 4} of ${faces.length / 4} boards beyond +12 m`);
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

console.log('\n  COPY — ambient curriculum, 2-4 words, themed per track\n  ' + '─'.repeat(78));
for (const [theme, set] of Object.entries(TRACK_SIGNS)) {
  const bad = set.lines.filter(l => {
    const w = l.trim().split(/\s+/).length;
    return w < 2 || w > 4 || !/[֐-׿]/.test(l);
  });
  ok(`${theme}: 8 Hebrew signs of 2-4 words`, set.lines.length === 8 && bad.length === 0,
    bad.length ? bad.join(' | ') : '');
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

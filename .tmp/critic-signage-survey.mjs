// Offline survey: what does a driver actually SEE of the roadside signage?
// Simulates the chase camera along a whole lap and measures, per frame:
//   * how many signage boards are inside the frustum
//   * the on-screen cap height (px) of their Hebrew at 1600x900
//   * the incidence angle (how side-on the board is)
function stubCanvas() {
  const state = {};
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      switch (k) {
        case 'createImageData': return (w, h) => ({ data: new Uint8ClampedArray(w * (h || w) * 4), width: w, height: h || w });
        case 'getImageData': return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        case 'createLinearGradient': case 'createRadialGradient': case 'createConicGradient': case 'createPattern':
          return () => ({ addColorStop() {} });
        case 'measureText': return (s) => ({ width: String(s).length * 8 });
        default: return () => {};
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
const { buildTrack, TRACK_SIGNS } = await import('../src/track/trackbuild.js');
const { TRACKS } = await import('../src/track/trackdef.js');

const W = 1600, H = 900, FOV = 62;
const engineAt = (propDensity, texSize = 512) => ({ q: { texSize, shadows: false, propDensity, crowdDensity: 0.4, drawDistance: 700 } });

// group quads of the `signage` mesh into boards (each board = 2 back-to-back quads)
function boards(track, meshName) {
  const out = [];
  const g = track.group.getObjectByName(meshName);
  if (!g) return out;
  const pos = g.geometry.attributes.position, uv = g.geometry.attributes.uv, idx = g.geometry.index;
  const nQuad = idx.count / 6;
  for (let q = 0; q < nQuad; q++) {
    const vs = [];
    for (let k = 0; k < 4; k++) vs.push(new THREE.Vector3().fromBufferAttribute(pos, idx.getX(q * 6) + k));
    // quad verts are contiguous: base..base+3
    const base = idx.getX(q * 6);
    const p = [0, 1, 2, 3].map(k => new THREE.Vector3().fromBufferAttribute(pos, base + k));
    const c = p[0].clone().add(p[1]).add(p[2]).add(p[3]).multiplyScalar(0.25);
    const n = p[1].clone().sub(p[0]).cross(p[3].clone().sub(p[0])).normalize();
    const w = p[1].distanceTo(p[0]), h = p[3].distanceTo(p[0]);
    const uvRect = [uv.getX(base), uv.getY(base)];
    out.push({ c, n, w, h, uvRect, base });
  }
  return out;
}

for (const def of TRACKS) {
  const track = buildTrack(def.id, engineAt(1), { audit: false });
  const sp = track.spline;
  const sg = boards(track, 'signage');
  const bd = boards(track, 'boards');
  const N = 400;
  let framesWithSign = 0, totalVisible = 0, best = [];
  const heights = [];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const p = sp.offsetPoint(t, 0);
    const tan = sp.tangentAt(t);
    const eye = new THREE.Vector3(p.x - tan.x * 5.5, p.y + 3.25, p.z - tan.z * 5.5);
    const fwd = new THREE.Vector3(tan.x, -0.04, tan.z).normalize();
    let vis = 0, bestPx = 0;
    for (const b of sg) {
      const d = b.c.clone().sub(eye);
      const dist = d.length();
      if (dist > 220) continue;
      const dir = d.clone().normalize();
      const cosAng = dir.dot(fwd);
      if (cosAng < Math.cos(THREE.MathUtils.degToRad(FOV * 0.5 * 1.6))) continue;  // rough frustum (h fov wider)
      if (b.n.dot(dir) > 0) continue;                                              // facing away
      const incid = -b.n.dot(dir);                                                 // 1 = square on
      // apparent cap height: text is ~0.40 of tile height for 2-word lines
      const capM = b.h * 0.22;   // measured from a real render, not the source constant
      const px = (capM / dist) / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) * H;
      if (px < 4) continue;                       // below any plausible reading threshold
      if (incid < 0.25) continue;                 // edge-on sliver
      vis++;
      if (px > bestPx) bestPx = px;
    }
    if (vis) { framesWithSign++; heights.push(bestPx); }
    totalVisible += vis;
  }
  heights.sort((a, b) => a - b);
  console.log(`\n${def.id} (${def.nameHe})`);
  console.log(`  lap length ${sp.length.toFixed(0)} m, signage boards=${sg.length / 2}, sponsor boards=${bd.length}`);
  console.log(`  frames (of ${N} around the lap) with >=1 readable sign: ${framesWithSign} (${(framesWithSign / N * 100).toFixed(0)}%)`);
  console.log(`  mean signs visible per frame: ${(totalVisible / N).toFixed(2)}`);
  if (heights.length) console.log(`  best on-screen cap height px: median ${heights[heights.length >> 1].toFixed(1)}, p90 ${heights[Math.floor(heights.length*0.9)].toFixed(1)}, max ${heights[heights.length - 1].toFixed(1)}`);
  console.log(`  frames where the best sign is >=14 px (HUD-small): ${(heights.filter(v=>v>=14).length/N*100).toFixed(0)}%`);
  // distance from the road edge
  const outs = [];
  for (let i = 0; i < sg.length; i += 2) {
    const b = sg[i];
    const s = sp.closestT(b.c);
    outs.push(Math.abs(s.lateral) - sp.widthAt(s.t));
  }
  outs.sort((a, b) => a - b);
  console.log(`  board offsets past the road edge (m): ${outs.map(v => v.toFixed(0)).join(', ')}`);
  track.dispose();
}

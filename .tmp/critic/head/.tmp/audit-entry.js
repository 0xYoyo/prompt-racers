
import * as THREE from 'three';
import { engine } from "/Users/yoyopc/repos/kart-project/src/core/engine.js";
import { buildTrack, auditTrackClearance } from "/Users/yoyopc/repos/kart-project/src/track/trackbuild.js";
import { applyTheme } from "/Users/yoyopc/repos/kart-project/src/gfx/sky.js";
import { disposeTextureCache } from "/Users/yoyopc/repos/kart-project/src/gfx/textures.js";

window.__RUN = async () => {
  const el = document.getElementById('app');
  engine.init(el);
  const out = [];
  for (const tier of ['low','medium','high']) {
    engine.setQuality(tier);
    for (const id of ['oasis','circuit','cloud']) {
      const scene = new THREE.Scene();
      const rig = applyTheme(scene, id, engine);
      const track = buildTrack(id, engine);
      scene.add(track.group);
      const hits = auditTrackClearance(track, { log: false });
      // replicate the flowtest ray probe, but report the full identity of the hit
      const rays = [];
      { const rc = new THREE.Raycaster();
        for (let i = 0; i < 480; i++) {
          const t = i / 480;
          const p = track.spline.positionAt(t), tan = track.spline.tangentAt(t);
          p.y += 0.8; rc.set(p, tan); rc.far = 6;
          const h = rc.intersectObject(track.group, true).filter(h => h.distance > 0.2);
          if (h.length) rays.push({ t: +t.toFixed(3), d: +h[0].distance.toFixed(2),
            n: h[0].object.name || '?', par: h[0].object.parent?.name || '?',
            type: h[0].object.type, inst: h[0].instanceId ?? -1,
            pt: [+h[0].point.x.toFixed(1), +h[0].point.y.toFixed(1), +h[0].point.z.toFixed(1)] });
        } }
      // draw-call / triangle census
      let calls = 0, tris = 0, insts = 0;
      track.group.traverse(o => {
        if (!o.isMesh) return;
        calls++;
        const g = o.geometry;
        const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        tris += n * (o.isInstancedMesh ? o.count : 1);
        if (o.isInstancedMesh) insts += o.count;
      });
      // + sky dome
      out.push({ tier, id, calls, tris: Math.round(tris), insts,
                 crowd: track.dress?.crowdCount ?? 0,
                 tokens: track.tokenSpots.length, cps: track.checkpoints.length,
                 rays,
                 hits: hits.map(h => ({ m: h.mesh, t: +h.t.toFixed(4), lat: +h.lateral.toFixed(2), h: +h.height.toFixed(2), x: +h.x.toFixed(1), y: +h.y.toFixed(1), z: +h.z.toFixed(1) })) });
      track.dispose(); rig.dispose(); disposeTextureCache();
    }
  }
  return out;
};

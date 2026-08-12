// ChaseCamera — the single biggest contributor to "this feels fast".
//
// Design rules, in priority order:
//   1. NEVER make a kid motion-sick. Every follower here is a critically damped
//      spring (no overshoot, no oscillation, ever) and every rate is time-based
//      so it behaves identically at 30 and 144 fps.
//   2. Speed must be legible: FOV widens with speed, punches on boost, the rig
//      pulls back and drops slightly, and the look target leads up the track so
//      blind corners are readable before you're in them.
//   3. Drifts must be readable: the camera swings toward the outside of the
//      slide and looks *through* the corner, the way a rally camera does.
//   4. Landing must not whip. Vertical follow is slower than horizontal, and
//      while airborne the yaw follower is slowed right down.
//
// Usage:
//   const chase = new ChaseCamera(camera, { spline });
//   chase.update(dt, kartBody);          // dt is the fixed 1/60
//   chase.shake(0.8, 0.35);              // on a wall hit
//   chase.mode = 'hood' | 'chase' | 'orbit';
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));

function dampV3(cur, target, l, dt) {
  const k = 1 - Math.exp(-l * dt);
  cur.x += (target.x - cur.x) * k;
  cur.y += (target.y - cur.y) * k;
  cur.z += (target.z - cur.z) * k;
  return cur;
}

/**
 * Critically damped spring (Game Programming Gems 4 smoothDamp). No overshoot by
 * construction — this is why the camera can be fast without being nauseating.
 */
function smoothDampV3(cur, vel, target, smoothTime, dt, maxSpeed = Infinity) {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxD = maxSpeed * st;
  let dx = cur.x - target.x, dy = cur.y - target.y, dz = cur.z - target.z;
  const mag = Math.hypot(dx, dy, dz);
  if (mag > maxD && mag > 0) { const s = maxD / mag; dx *= s; dy *= s; dz *= s; }
  const tx = cur.x - dx, ty = cur.y - dy, tz = cur.z - dz;
  const tmpx = (vel.x + omega * dx) * dt;
  const tmpy = (vel.y + omega * dy) * dt;
  const tmpz = (vel.z + omega * dz) * dt;
  vel.x = (vel.x - omega * tmpx) * exp;
  vel.y = (vel.y - omega * tmpy) * exp;
  vel.z = (vel.z - omega * tmpz) * exp;
  let ox = tx + (dx + tmpx) * exp;
  let oy = ty + (dy + tmpy) * exp;
  let oz = tz + (dz + tmpz) * exp;
  // Prevent overshoot past the target.
  const odx = target.x - cur.x, ody = target.y - cur.y, odz = target.z - cur.z;
  const rdx = ox - target.x, rdy = oy - target.y, rdz = oz - target.z;
  if (odx * rdx + ody * rdy + odz * rdz > 0) {
    ox = target.x; oy = target.y; oz = target.z;
    vel.x = (ox - cur.x) / dt; vel.y = (oy - cur.y) / dt; vel.z = (oz - cur.z) / dt;
  }
  cur.set(ox, oy, oz);
  return cur;
}

export const CAMERA_MODES = ['chase', 'hood', 'orbit'];

export const CHASE_PRESETS = {
  // distance/height at rest -> at top speed. Tuned against a 1.2m-tall kart.
  chase: { dist: 5.5, distFast: 6.4, height: 3.25, heightFast: 3.05, look: 0.15, fov: 58, fovFast: 68, fovBoost: 7 },
  // A tighter, more "in it" variant the player can toggle to.
  close: { dist: 4.4, distFast: 5.2, height: 2.85, heightFast: 2.7, look: 0.1, fov: 60, fovFast: 72, fovBoost: 8 },
};

export class ChaseCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {object} o
   *   spline   TrackSpline — enables spline look-ahead (optional but recommended)
   *   mode     'chase' | 'hood' | 'orbit'
   *   preset   key of CHASE_PRESETS
   *   seed     deterministic shake seed (screenshots must be reproducible)
   */
  constructor(camera, o = {}) {
    this.camera = camera;
    this.spline = o.spline || null;
    this.mode = o.mode || 'chase';
    this.preset = CHASE_PRESETS[o.preset || 'chase'];

    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this._posVel = new THREE.Vector3();
    this._lookVel = new THREE.Vector3();
    this.fov = this.preset.fov;
    this.roll = 0;
    this.lead = 0;             // smoothed lateral drift lead, -1..1
    this.yawFollow = 0;        // smoothed heading the rig sits behind
    this._yawInit = false;
    this._airTime = 0;
    this._groundY = 0;

    // Shake: sum of decaying impulses, evaluated from a deterministic hash so
    // the screenshot harness is frame-for-frame reproducible.
    this._shakeAmp = 0;
    this._shakeT = 0;
    this._shakeDur = 0;
    this._seed = o.seed ?? 1337;
    this._t = 0;

    // Orbit mode (menus, results screen).
    this.orbitTarget = new THREE.Vector3();
    this.orbitRadius = o.orbitRadius ?? 7.5;
    this.orbitHeight = o.orbitHeight ?? 2.6;
    this.orbitSpeed = o.orbitSpeed ?? 0.28;
    this.orbitAngle = o.orbitAngle ?? 0;

    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._targetPos = new THREE.Vector3();
    this._targetLook = new THREE.Vector3();
  }

  /** Kick the camera. intensity ~0..1 (1 = a hard wall hit). Additive, capped. */
  shake(intensity = 0.5, duration = 0.3) {
    const i = clamp(intensity, 0, 1.5);
    if (i * duration <= this._shakeAmp * Math.max(0, this._shakeDur - this._shakeT) * 0.9) return this;
    this._shakeAmp = Math.min(1.2, Math.max(this._shakeAmp, i));
    this._shakeDur = duration;
    this._shakeT = 0;
    return this;
  }

  /** Snap straight to the ideal pose — call on race start / after a respawn. */
  snap(body) {
    this._yawInit = false;
    this._posVel.set(0, 0, 0); this._lookVel.set(0, 0, 0);
    if (body) {
      this._computeChase(body, 1 / 60, true);
      this.pos.copy(this._targetPos);
      this.look.copy(this._targetLook);
      this.camera.position.copy(this.pos);
      this.camera.lookAt(this.look);
    }
    return this;
  }

  /**
   * @param {number} dt fixed step
   * @param {KartBody|{position,quaternion,...}} body  the kart to follow
   */
  update(dt, body) {
    this._t += dt;
    if (this.mode === 'orbit') return this._updateOrbit(dt, body);
    if (!body) return this.camera;

    const air = body.airborne ? 1 : 0;
    this._airTime = air ? this._airTime + dt : Math.max(0, this._airTime - dt * 1.6);

    if (this.mode === 'hood') this._updateHood(dt, body);
    else this._updateChase(dt, body);

    this._applyShakeAndFov(dt, body);
    return this.camera;
  }

  // -------------------------------------------------------------------------
  _computeChase(body, dt, instant = false) {
    const P = this.preset;
    const sp = this.spline;
    const speed01 = body.speed01 ?? 0;
    const boost = body.boosting ? 1 : 0;

    // The rig sits behind a *smoothed* heading rather than the instantaneous one,
    // so a drift lets the kart rotate visibly inside the frame instead of the
    // world spinning around it. Slower still in the air (no landing whip).
    let yaw = body.yaw ?? 0;
    if (!this._yawInit) { this.yawFollow = yaw; this._yawInit = true; }
    let d = yaw - this.yawFollow;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const yawRate = instant ? 999 : (this._airTime > 0.05 ? 2.4 : lerp(7.0, 4.4, speed01));
    this.yawFollow += d * (1 - Math.exp(-yawRate * dt));

    const fx = Math.sin(this.yawFollow), fz = Math.cos(this.yawFollow);
    const rx = -fz, rz = fx;                    // matches the body's lateral basis

    // Drift lead: swing to the OUTSIDE of the slide so the corner opens up.
    const driftLead = body.drifting ? -(body.driftDir || 0) : clamp(-(body.slipAngle || 0) * 1.6, -1, 1);
    this.lead = instant ? driftLead : damp(this.lead, driftLead * (body.drifting ? 1 : 0.55), 4.5, dt);

    const dist = lerp(P.dist, P.distFast, speed01) + boost * 0.55;
    const height = lerp(P.height, P.heightFast, speed01) + this._airTime * 1.4;

    // Vertical: follow the *ground* under the kart, not the kart's own y. That is
    // what stops a jump from dragging the camera into the sky and back.
    const bodyY = body.position.y;
    const gy = body.groundY ?? bodyY;
    this._groundY = instant ? gy : damp(this._groundY, gy, 5.0, dt);
    const baseY = lerp(this._groundY, bodyY, 0.42);

    this._targetPos.set(
      body.position.x - fx * dist + rx * this.lead * 1.9,
      baseY + height,
      body.position.z - fz * dist + rz * this.lead * 1.9);

    // Look target: ahead of the kart, blended with a point up the racing line so
    // blind corners are visible before you commit to them.
    const ahead = 4.5 + speed01 * 5.5;
    this._targetLook.set(
      body.position.x + fx * ahead - rx * this.lead * 3.4,
      baseY + P.look,
      body.position.z + fz * ahead - rz * this.lead * 3.4);
    if (sp && body.lapT != null && !body.airborne) {
      const t = (body.lapT + (14 + speed01 * 26) / sp.length) % 1;
      const q = sp.positionAt(t, this._tmp);
      // Only a third of the way — full spline look-ahead makes the horizon slide
      // sideways on straights, which is exactly the motion-sickness trigger.
      const w = 0.24 * (0.35 + 0.65 * speed01);
      this._targetLook.x = lerp(this._targetLook.x, q.x, w);
      this._targetLook.z = lerp(this._targetLook.z, q.z, w);
      this._targetLook.y = lerp(this._targetLook.y, q.y + P.look, w * 0.6);
    }
  }

  _updateChase(dt, body) {
    this._computeChase(body, dt);
    // Faster at speed (stay glued), slower in the air (no whip on landing).
    const air = clamp(this._airTime * 2.2, 0, 1);
    // NOTE: a critically damped follower sits a steady v*smoothTime BEHIND a
    // constant-velocity target — at 24 m/s that is metres, so these numbers are
    // part of the framing, not just the smoothing.
    const posT = lerp(lerp(0.12, 0.075, body.speed01 ?? 0), 0.3, air);
    const lookT = lerp(0.12, 0.26, air);
    smoothDampV3(this.pos, this._posVel, this._targetPos, posT, dt, 220);
    smoothDampV3(this.look, this._lookVel, this._targetLook, lookT, dt, 400);

    // Never clip through the ground.
    const floor = (this.spline ? this._floorAt(this.pos) : this._groundY) + 1.05;
    if (this.pos.y < floor) { this.pos.y = floor; if (this._posVel.y < 0) this._posVel.y = 0; }

    this.camera.position.copy(this.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    // A whisper of roll into the drift. More than this and it reads as a bug.
    this.roll = damp(this.roll, clamp(-this.lead * 0.055 + clamp(body.slipAngle || 0, -0.6, 0.6) * -0.035, -0.09, 0.09), 5, dt);
    this.camera.rotateZ(this.roll);
  }

  _updateHood(dt, body) {
    const fx = Math.sin(body.yaw), fz = Math.cos(body.yaw);
    this._targetPos.set(body.position.x + fx * 0.15, body.position.y + 1.12, body.position.z + fz * 0.15);
    const ahead = 12 + (body.speed01 ?? 0) * 16;
    this._targetLook.set(body.position.x + fx * ahead, body.position.y + 1.0, body.position.z + fz * ahead);
    if (this.spline && body.lapT != null) {
      const t = (body.lapT + (16 + (body.speed01 ?? 0) * 24) / this.spline.length) % 1;
      const q = this.spline.positionAt(t, this._tmp);
      this._targetLook.lerp(q, 0.28);
    }
    smoothDampV3(this.pos, this._posVel, this._targetPos, 0.04, dt, 400);
    smoothDampV3(this.look, this._lookVel, this._targetLook, 0.09, dt, 600);
    this.camera.position.copy(this.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    this.roll = damp(this.roll, clamp((body.slipAngle || 0) * -0.09, -0.11, 0.11), 6, dt);
    this.camera.rotateZ(this.roll);
  }

  _updateOrbit(dt, body) {
    if (body?.position) this.orbitTarget.lerp(body.position, 1 - Math.exp(-4 * dt));
    this.orbitAngle += this.orbitSpeed * dt;
    const r = this.orbitRadius;
    this._targetPos.set(
      this.orbitTarget.x + Math.sin(this.orbitAngle) * r,
      this.orbitTarget.y + this.orbitHeight,
      this.orbitTarget.z + Math.cos(this.orbitAngle) * r);
    this._targetLook.copy(this.orbitTarget).y += 0.7;
    smoothDampV3(this.pos, this._posVel, this._targetPos, 0.25, dt, 60);
    dampV3(this.look, this._targetLook, 6, dt);
    this.camera.position.copy(this.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    this.fov = damp(this.fov, 46, 4, dt);
    if (this.camera.isPerspectiveCamera) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
    return this.camera;
  }

  _floorAt(v) {
    const s = this.spline.closestT(v);
    return s.pos.y;
  }

  _applyShakeAndFov(dt, body) {
    const P = this.preset;
    // FOV: widens with speed, punches further on boost, pinches slightly off-road
    // so leaving the track *feels* like bogging down.
    let target = lerp(P.fov, P.fovFast, (body.speed01 ?? 0) ** 1.25);
    if (body.boosting) target += P.fovBoost * clamp((body.boostStrength - 1) * 5, 0.4, 1);
    if (body.offTrack) target -= 3;
    if (body.airborne) target -= 2.5;
    // Asymmetric: punch in fast, ease back slowly. Reads as acceleration.
    const rate = target > this.fov ? 5.5 : 2.6;
    this.fov = damp(this.fov, target, rate, dt);
    if (this.camera.isPerspectiveCamera) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // Shake: deterministic pseudo-noise, decaying, applied as a small positional
    // offset only (rotating the camera is far more nauseating for the same read).
    if (this._shakeT < this._shakeDur) {
      this._shakeT += dt;
      const k = 1 - this._shakeT / this._shakeDur;
      const a = this._shakeAmp * k * k * 0.42;
      const n = i => {
        const x = Math.sin((this._t * 47.3 + i * 12.9898 + this._seed) * 43758.5453);
        return x - Math.floor(x) - 0.5;
      };
      this.camera.position.x += n(1) * a;
      this.camera.position.y += n(2) * a * 0.7;
      this.camera.position.z += n(3) * a;
      this.camera.rotateZ(n(4) * a * 0.05);
    } else if (this._shakeAmp) { this._shakeAmp = 0; }

    // Auto-shake from the physics so callers get it for free; explicit shake()
    // still works for items, finish-line pops, etc.
    if (body.wallHit > 0.45) this.shake(body.wallHit * 0.9, 0.28);
    else if (body.kartHit > 0.4) this.shake(body.kartHit * 0.6, 0.22);
    if (body.landingSquash > 0.4) this.shake(body.landingSquash * 0.55, 0.2);
    // Continuous low rumble when off-track.
    if (body.rumble > 0.15 && this._shakeT >= this._shakeDur) this.shake(body.rumble * 0.28, 0.14);
  }

  resize(w, h) {
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }
}

// ---------------------------------------------------------------------------
// preview(engine) — three karts on stubs showing chase / hood / orbit framing.
// The real driving preview lives in kartphysics.js (it needs the simulation).
// ---------------------------------------------------------------------------
export function preview(engine) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b3350);
  scene.fog = new THREE.FogExp2(0xc99a63, 0.0035);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 900);
  scene.add(new THREE.DirectionalLight(0xffd9a0, 2.0).translateY(40),
    new THREE.HemisphereLight(0x8fa8dd, 0x6b4a2c, 0.9));

  const gg = new THREE.PlaneGeometry(900, 900);
  const gm = new THREE.MeshLambertMaterial({ color: 0xb07a49 });
  const ground = new THREE.Mesh(gg, gm); ground.rotation.x = -Math.PI / 2; scene.add(ground);

  const geo = new THREE.BoxGeometry(1.3, 0.9, 2.2);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffc247 });
  const kart = new THREE.Mesh(geo, mat); kart.position.y = 0.45; scene.add(kart);

  const cones = [];
  const cg = new THREE.ConeGeometry(0.5, 1.6, 8);
  const cm = new THREE.MeshLambertMaterial({ color: 0xef4436 });
  for (let i = 0; i < 40; i++) {
    const c = new THREE.Mesh(cg, cm);
    c.position.set(Math.sin(i * 1.7) * 22, 0.8, -i * 9);
    scene.add(c); cones.push(c);
  }

  const chase = new ChaseCamera(camera, {});
  const body = {
    position: kart.position, yaw: 0, groundY: 0, speed01: 0.75, boosting: false,
    airborne: false, offTrack: false, drifting: true, driftDir: 1, slipAngle: 0.3,
    wallHit: 0, kartHit: 0, landingSquash: 0, rumble: 0, lapT: null, boostStrength: 1,
  };
  let t = 0;
  return {
    scene, camera,
    update(dt) {
      t += dt;
      body.yaw = Math.sin(t * 0.4) * 0.6;
      kart.position.x += Math.sin(body.yaw) * 20 * dt;
      kart.position.z += Math.cos(body.yaw) * 20 * dt;
      kart.rotation.y = body.yaw;
      body.boosting = (t % 6) > 4;
      chase.update(dt, body);
    },
    dispose() { for (const d of [gg, gm, geo, mat, cg, cm]) d.dispose(); },
  };
}

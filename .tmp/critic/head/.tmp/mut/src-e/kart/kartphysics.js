// KartBody — the arcade kart simulation for מרוץ הפרומפטים.
//
// This is NOT a vehicle sim. It is a *feel* machine tuned for an 8-year-old:
// instant response, forgiving mistakes, and one real skill to learn (the drift
// mini-boost). Everything below is tuned by numbers measured in .tmp/feeltest.mjs,
// not by theory — see the header comments on each constant for the target.
//
// Conventions (IMPORTANT for whoever attaches a mesh):
//   * The kart's local **+Z is forward**. `quaternion` is a pure yaw rotation about
//     +Y, so `mesh.quaternion.copy(body.quaternion)` on a model built facing +Z is
//     correct. `body.forward` is also exposed if you'd rather build the basis.
//   * `lateral` sign matches TrackSpline.rightAt() exactly, so `offTrack` here and
//     off-track anywhere else in the game agree.
//   * update(dt) expects the engine's fixed 1/60 step. It is stable up to ~1/20.
import * as THREE from 'three';
import { getTrack, gridSlots } from '../track/trackdef.js';
import { ChaseCamera } from './camera.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential approach. `l` is a rate in 1/seconds.
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));

// ---------------------------------------------------------------------------
// Drift tiers. Charge is in "drift seconds" scaled by how hard you are sliding,
// so a lazy drift charges slower than a committed one.
// Measured with a fully committed drift at racing speed (see .tmp/feeltest.mjs):
//   blue   ~0.6s — reachable in almost any corner
//   orange ~1.3s — needs a proper sweeper
//   purple ~2.0s — the hairpin, or a drift held down the following straight
// ---------------------------------------------------------------------------
export const DRIFT_TIERS = [
  { charge: 0.95, strength: 1.10, duration: 0.75, impulse: 1.6, color: 0x59c8ff, name: 'blue' },
  { charge: 2.15, strength: 1.22, duration: 1.55, impulse: 4.2, color: 0xff9a2e, name: 'orange' },
  { charge: 3.45, strength: 1.38, duration: 2.60, impulse: 7.6, color: 0xc06bff, name: 'purple' },
];
export const MAX_DRIFT_CHARGE = DRIFT_TIERS[2].charge;

// Duration of the cosmetic pre-drift hop, seconds.
const HOP_TIME = 0.30;

// Lateral grip multiplier while drifting. The single most important balance
// number in the file: it is what makes a drift a *line* rather than a costume.
export const DRIFT_GRIP = 1.20;

// ---------------------------------------------------------------------------
// Garage parts. Tier 0 = stock, tier 3 = fully upgraded. Measured: a fully
// upgraded kart laps ~8% quicker than a stock one — clearly worth earning, never
// so much that a kid who has not upgraded cannot win a race.
// ---------------------------------------------------------------------------
export const PART_TIERS = {
  engine: { topSpeed: [1, 1.018, 1.036, 1.054], accel: [1, 1.05, 1.10, 1.15] },
  tyres: { grip: [1, 1.04, 1.08, 1.12], offRoad: [1, 1.04, 1.08, 1.12] },
  frame: { mass: [1, 1.03, 1.06, 1.09], stability: [1, 1.08, 1.16, 1.24] },
  turbo: { boost: [1, 1.04, 1.08, 1.12], driftRate: [1, 1.05, 1.10, 1.15] },
};

export const NEUTRAL_MODS = {
  topSpeed: 1, accel: 1, grip: 1, offRoad: 1, mass: 1, stability: 1, boost: 1, driftRate: 1,
};

/**
 * Fold garage part tiers into a multiplier set the physics reads.
 * @param {{speed,accel,handling,weight}} base   roster stats, 1..5
 * @param {object} parts  e.g. { engine: 2, tyres: 1, frame: 0, turbo: 3 } (0..3)
 * @returns {{speed,accel,handling,weight,mods:object}} — pass straight to KartBody
 */
export function applyPartStats(base, parts = {}) {
  const mods = { ...NEUTRAL_MODS };
  for (const kind of Object.keys(PART_TIERS)) {
    const tier = clamp(Math.round(parts[kind] ?? 0), 0, 3);
    for (const [key, table] of Object.entries(PART_TIERS[kind])) mods[key] *= table[tier];
  }
  return { ...base, mods };
}

/** Human-readable 0..1 bars for the garage screen, derived the same way as physics. */
export function statBars(stats) {
  const d = derive(stats);
  return {
    topSpeed: clamp((d.topSpeed - 20) / 12, 0, 1),
    accel: clamp((d.accelPower - 10) / 12, 0, 1),
    grip: clamp((d.grip - 12) / 10, 0, 1),
    weight: clamp((d.mass - 0.7) / 0.9, 0, 1),
  };
}

// Stats (1..5) + part mods -> physical constants.
function derive(stats = {}) {
  const mods = { ...NEUTRAL_MODS, ...(stats.mods || {}) };
  const s = clamp(stats.speed ?? 3, 1, 5);
  const a = clamp(stats.accel ?? 3, 1, 5);
  const h = clamp(stats.handling ?? 3, 1, 5);
  const w = clamp(stats.weight ?? 3, 1, 5);
  return {
    mods,
    // 22.6 .. 26.5 m/s stock, up to ~28.5 fully upgraded (81..103 km/h) — the
    // brief's 22-30 window, kept narrow so no racer is unplayably outclassed.
    // Widening this past ~1.1/point pushes the roster lap spread over 8%.
    topSpeed: (22.6 + (s - 1) * 0.98) * mods.topSpeed,
    // Peak longitudinal accel at v=0. 0->top in ~2.5-3.5s.
    accelPower: (14.2 + (a - 1) * 1.3) * mods.accel,
    // Lateral grip in m/s^2, ~0.78g..1.16g. Deliberately LOW for a kart: with
    // 1.3g nothing on these tracks was ever grip-limited, corner minimum speed
    // sat within 3% of top speed, and both the handling stat and the entire
    // drift mechanic were decoration. At this level a bad corner entry really
    // does cost you two seconds.
    grip: (7.6 + (h - 1) * 0.95) * mods.grip,
    // Heavier karts win bumps, turn a shade lazier, hold speed off-road better.
    mass: 0.72 + (w - 1) * 0.21,
    steerRate: 7.4 + (h - 1) * 0.55,          // how fast the wheels reach lock
    driftRate: (0.94 + (h - 1) * 0.06) * mods.driftRate,
    boostPower: mods.boost,
    offRoadKeep: clamp(0.58 + (w - 1) * 0.012, 0, 1) * mods.offRoad, // top-speed kept off-track
    stability: mods.stability,
  };
}

const DEFAULT_INPUT = { throttle: 0, brake: 0, steer: 0, drift: false, hop: false };

// ═══ RENDER ORIENTATION — READ BEFORE PUTTING A MESH ON A KartBody ═══════════
//
// The SIMULATION's local forward is +Z: `forward = (sin yaw, 0, cos yaw)`, and
// `quaternion` is the pure yaw that maps +Z onto it. That convention is load-bearing
// here — `_lat` is derived from it to agree with TrackSpline.rightAt, so the sign of
// `lateral` (and therefore off-track detection) depends on it. Do not change it.
//
// MESHES use the opposite convention. three.js treats -Z as forward (Object3D.lookAt,
// cameras), and src/kart/kartmodel.js is built that way — its header says
// "forward = -Z, right = +X, up = +Y". Copying `quaternion` straight onto such a mesh
// renders the kart 180° backwards, which also makes steering *look* inverted because
// you are then watching the kart's nose swing toward the camera.
//
// So: physics reads `quaternion`, ANYTHING THAT RENDERS reads `renderQuaternion`.
// One conversion, defined once, rather than a correction sprinkled at each call site.
export const MODEL_YAW_OFFSET = Math.PI;

// ── STEER SIGN ──────────────────────────────────────────────────────────────
// INTERNAL convention: a positive `steer` input increases yaw, which rotates the
// kart toward +X — i.e. toward its own LEFT (its right is `forward x UP` = -X when
// facing +Z). Every in-engine producer (AIDriver, autopilotInput) is written and
// tuned against this, and the drift path derives `driftLean`/`driftDir` from it too,
// so it is NOT safe to invert here — doing so breaks drift and costs the approved
// driving feel.
//
// The PLAYER-FACING convention ("right arrow turns right") is therefore established
// once, at the input boundary, in src/core/input.js. See PLAYER_STEER_SIGN there.
export const LEGACY_STEER_FLIP = -1;

export class KartBody {
  /**
   * @param {object} o
   *   spline     TrackSpline (required)
   *   stats      {speed,accel,handling,weight,mods?} 1..5 from the roster
   *   startSlot  a gridSlots() entry {t, lateral, pos, rot} — or omit for startT
   *   parts      optional garage parts object; folded via applyPartStats()
   *   surface    off-track surface label for FX/audio: 'sand' | 'grass' | 'cloud'
   *   radius     collision radius, metres
   */
  constructor(o = {}) {
    this.spline = o.spline;
    if (!this.spline) throw new Error('KartBody needs a spline');
    this.stats = o.parts ? applyPartStats(o.stats || {}, o.parts) : (o.stats || {});
    this.p = derive(this.stats);
    this.offSurface = o.surface || 'sand';
    this.radius = o.radius ?? 1.15;
    this.mass = this.p.mass;

    // --- pose -------------------------------------------------------------
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    // See MODEL_YAW_OFFSET below: the orientation to put on a rendered mesh.
    this.renderQuaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();      // world, y is the airborne component
    this.forward = new THREE.Vector3(0, 0, 1);
    this.yaw = 0;
    this.vy = 0;
    this.groundY = 0;

    // --- readable state ---------------------------------------------------
    this.speed = 0;         // planar speed, m/s
    this.speed01 = 0;       // 0..1 against this kart's top speed
    this.steerAngle = 0;    // -1..1, the *smoothed* wheel angle (for the model)
    this.slipAngle = 0;     // radians between heading and travel (drift visual)
    this.drifting = false;
    this.driftDir = 0;      // -1 left, +1 right
    this.driftTier = 0;     // 0..3
    this.driftCharge = 0;
    this.driftCharge01 = 0;
    this.driftLean = 0;     // rendered slip offset while drifting (radians)
    this.boosting = false;
    this.boostStrength = 1;
    this.airborne = false;
    this.landingSquash = 0; // 0..1, decays; the model squashes on landing
    this.hopOffset = 0;     // metres of RENDERED hop; add to the mesh, not the body
    this.offTrack = false;
    this.surfaceKind = 'asphalt';
    this.rumble = 0;        // 0..1 — controller/audio/camera rumble amount
    this.lapT = 0;
    this.lastValidT = 0;
    this.lateral = 0;
    this.trackWidth = this.spline.baseWidth;
    this.wallHit = 0;       // 0..1 impulse of the last wall contact, decays
    this.kartHit = 0;       // same for kart-vs-kart
    this.jumped = false;    // set true on the frame we launch off a crest

    // --- internals --------------------------------------------------------
    this._vLong = 0;
    this._vLat = 0;
    this._boostTime = 0;
    this._hopTime = 0;          // >0 while the pre-drift hop is in the air
    this._driftPending = false; // hop done, waiting for a steer commitment
    this._stuck = 0;
    this._recover = 0;          // post-collision assist window
    this._wallContact = 0;
    this._prevGroundY = 0;
    this._rampVy = 0;
    this._landLock = 0;
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._lat = new THREE.Vector3();   // lateral basis, matches spline.rightAt sign
    this._sample = null;
    this.time = 0;

    this.placeAt(o.startSlot);
  }

  // -------------------------------------------------------------------------
  // Placement
  // -------------------------------------------------------------------------
  placeAt(slot) {
    const sp = this.spline;
    let t = 0, lat = 0;
    if (slot) { t = slot.t ?? 0; lat = slot.lateral ?? 0; }
    const pos = sp.offsetPoint(t, lat);
    const tan = slot?.rot ? this._tmpA.copy(slot.rot) : sp.tangentAt(t);
    this.position.copy(pos);
    this.yaw = Math.atan2(tan.x, tan.z);
    this.groundY = this._prevGroundY = sp.positionAt(t).y;
    this.position.y = this.groundY;
    this._vLong = 0; this._vLat = 0; this.vy = 0;
    this.velocity.set(0, 0, 0);
    this.lapT = this.lastValidT = t;
    this._resetTransient();
    this._syncBasis();
  }

  _resetTransient() {
    this.drifting = false; this.driftDir = 0; this.driftTier = 0;
    this.driftCharge = 0; this.driftCharge01 = 0; this.driftLean = 0;
    this.boosting = false; this.boostStrength = 1; this._boostTime = 0;
    this._hopTime = 0; this._driftPending = false; this._stuck = 0;
    this._recover = 0; this._wallContact = 0; this.wallHit = 0; this.kartHit = 0;
    this.airborne = false; this.landingSquash = 0; this.steerAngle = 0; this.slipAngle = 0;
    this.hopOffset = 0;
  }

  /** Fall-off / reset-button case: back on the centreline, facing forward, rolling. */
  respawn(t = this.lastValidT) {
    const sp = this.spline;
    this.position.copy(sp.positionAt(t));
    const tan = sp.tangentAt(t);
    this.yaw = Math.atan2(tan.x, tan.z);
    this.groundY = this._prevGroundY = this.position.y;
    this._vLong = 6; this._vLat = 0; this.vy = 0;
    this.lapT = this.lastValidT = t;
    this._resetTransient();
    this._syncBasis();
    this._writeVelocity();
    return this;
  }

  _syncBasis() {
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // Matches TrackSpline.rightAt (tangent x UP) so `lateral` signs agree.
    this._lat.copy(this.forward).cross(UP).normalize();
    this.quaternion.setFromAxisAngle(UP, this.yaw);
    this.renderQuaternion.setFromAxisAngle(UP, this.yaw + MODEL_YAW_OFFSET);
  }

  _writeVelocity() {
    this.velocity.set(
      this.forward.x * this._vLong + this._lat.x * this._vLat, this.vy,
      this.forward.z * this._vLong + this._lat.z * this._vLat);
    this.speed = Math.hypot(this._vLong, this._vLat);
    this.speed01 = clamp(this.speed / this.p.topSpeed, 0, 1);
  }

  // -------------------------------------------------------------------------
  // Boost sources: mini-boosts, pads, pickups. Stacking takes the stronger one
  // and adds a little duration, so a pad during a mini-boost still feels good.
  // -------------------------------------------------------------------------
  applyBoost(strength = 1.2, duration = 1.0, impulse = 0) {
    const s = 1 + (strength - 1) * this.p.boostPower;
    if (s >= this.boostStrength) {
      this.boostStrength = s;
      this._boostTime = Math.max(this._boostTime, 0) + duration * (this._boostTime > 0 ? 0.45 : 1);
    } else {
      this._boostTime += duration * 0.35;
    }
    this._boostTime = Math.min(this._boostTime, 4.5);
    this.boosting = true;
    if (impulse) this._vLong = Math.min(this._vLong + impulse, this.p.topSpeed * s);
    return this;
  }

  /** Convenience for boost pads laid on the track. */
  hitBoostPad() { return this.applyBoost(1.24, 1.5, 4.0); }

  // -------------------------------------------------------------------------
  // Main step
  // -------------------------------------------------------------------------
  update(dt, input = DEFAULT_INPUT) {
    if (!(dt > 0)) return this;
    dt = Math.min(dt, 1 / 20);
    this.time += dt;

    const throttle = clamp(input.throttle ?? 0, 0, 1);
    const brake = clamp(input.brake ?? 0, 0, 1);
    const steerIn = clamp(input.steer ?? 0, -1, 1);
    const wantDrift = !!input.drift;
    const p = this.p;

    // ---- 1. where are we on the track ------------------------------------
    const s = this.spline.closestT(this.position);
    this._sample = s;
    this.lapT = s.t;
    this.lateral = s.lateral;
    const halfWidth = this.spline.widthAt(s.t);
    this.trackWidth = halfWidth;
    const over = Math.abs(s.lateral) - halfWidth;
    this.offTrack = over > 0;
    this.surfaceKind = this.offTrack ? this.offSurface : 'asphalt';
    if (!this.offTrack && !this.airborne) this.lastValidT = s.t;

    // ---- 2. ground / air --------------------------------------------------
    this.groundY = s.pos.y;
    const groundVel = (this.groundY - this._prevGroundY) / dt;
    this._prevGroundY = this.groundY;
    this.jumped = false;

    // ---- 3. surface coefficients -----------------------------------------
    let gripMul = 1, topMul = 1, dragAdd = 0;
    if (this._recover > 0) this._recover -= dt;
    if (this.offTrack) {
      // Meaningfully slower, but never a wall: you can still limp back on.
      // Right after a collision the penalty is halved for a moment — the runoff
      // must not turn a single mistake into a five-second sentence.
      const soften = this._recover > 0 ? 0.5 : 1;
      const depth = clamp(over / 3, 0, 1) * soften;
      topMul = lerp(1, p.offRoadKeep, depth);
      gripMul = lerp(1, 0.66, depth);
      dragAdd = 4.2 * depth;
      this.rumble = damp(this.rumble, 0.55 + 0.45 * this.speed01, 12, dt);
    } else {
      this.rumble = damp(this.rumble, 0, 9, dt);
    }
    if (this.airborne) { gripMul *= 0.12; }
    if (this._recover > 0) gripMul *= 1.22;                 // kid-friendly catch

    // ---- 4. boost ---------------------------------------------------------
    if (this._boostTime > 0) {
      this._boostTime -= dt;
      if (this._boostTime <= 0) { this.boosting = false; this.boostStrength = 1; }
    }
    const boost = this.boostStrength;
    const topSpeed = p.topSpeed * boost * topMul;

    // Re-project the *world* velocity onto the current basis. Keeping the world
    // vector as the single source of truth is what makes the slide maths honest:
    // rotating the body cannot invent or destroy speed, it only changes how much
    // of it is "sideways", which is exactly what a slide is.
    this._vLong = this.velocity.x * this.forward.x + this.velocity.z * this.forward.z;
    this._vLat = this.velocity.x * this._lat.x + this.velocity.z * this._lat.z;

    // ---- 5. longitudinal --------------------------------------------------
    let aLong = 0;
    const v = this._vLong;
    if (!this.airborne) {
      if (throttle > 0.01 && brake < 0.5) {
        // Taper toward top speed: strong off the line, gentle at the limit.
        const f = clamp(1 - Math.pow(clamp(v / Math.max(topSpeed, 1), 0, 1), 3.0), 0, 1);
        aLong += throttle * p.accelPower * (this.boosting ? 1.9 : 1) * f;
        if (v > topSpeed) aLong -= (v - topSpeed) * 3.5;   // pull back after a boost ends
      } else if (v > 0) {
        aLong -= 4.0;                                        // engine braking
      }
      if (brake > 0.5) {
        if (v > 0.4) aLong -= 17.0 * brake;                  // ~19m from 25 m/s
        else aLong -= 7.5 * brake * (v > -9 ? 1 : 0);        // reverse, capped at 9 m/s
      }
      // Speed scrubbed by sliding sideways. A third of it while drifting — this,
      // plus the mini-boost, is what makes a good drift genuinely FASTER.
      const scrub = this.drifting ? 0.038 : 0.44;
      aLong -= scrub * Math.abs(this._vLat) * (1 + this.speed01);
      aLong -= dragAdd * Math.min(1, Math.abs(v) / 3) * Math.sign(v || 1);
    }
    aLong -= 0.0013 * v * Math.abs(v);                       // aero
    this._vLong += aLong * dt;
    if (this._vLong > topSpeed * 1.25) this._vLong = topSpeed * 1.25;
    if (this._vLong < -9) this._vLong = -9;
    if (Math.abs(this._vLong) < 0.02 && throttle < 0.01 && brake < 0.01) this._vLong = 0;

    // ---- 6. lateral grip / slide -----------------------------------------
    const gripLat = p.grip * gripMul * (this.drifting ? DRIFT_GRIP : 1) * (this.boosting ? 1.05 : 1);
    const maxBite = gripLat * dt;
    if (Math.abs(this._vLat) <= maxBite) this._vLat = 0;
    else this._vLat -= Math.sign(this._vLat) * maxBite;
    // Hard clamp: a slide, never a pirouette. ~32 degrees of slip, maximum.
    const latCap = 0.62 * Math.max(Math.abs(this._vLong), 3);
    this._vLat = clamp(this._vLat, -latCap, latCap);
    this.slipAngle = Math.atan2(this._vLat, Math.max(Math.abs(this._vLong), 1.5));
    // Write the post-friction velocity back into world space *before* yawing, so
    // the yaw below leaves the velocity behind and opens the slip angle.
    this._writeVelocity();

    // ---- 7. steering ------------------------------------------------------
    // Speed-sensitive: full lock when parking, ~34% at top speed, so a panicked
    // full-lock input at speed cannot spin the kart.
    const lock = lerp(1.0, 0.34, clamp(this.speed / (p.topSpeed * 0.95), 0, 1) ** 0.85);
    this.steerLock = lock;                    // AI/autopilot invert this
    const bias = clamp(steerIn * (this.driftDir || 1), -1, 1);
    let target = steerIn * lock;
    if (this.drifting) {
      // In a drift the stick only *modulates* between a tight and a wide line;
      // you cannot turn the other way without letting go. That is the mechanic.
      // The floor is near zero so a drift can be held nearly straight down a
      // short straight to charge it up — with a floor of 0.10 every drift curved
      // hard enough that the driver had to bail out before the second tier.
      target = this.driftDir * lerp(0.02, 1.0, (bias + 1) * 0.5) * lock;
    }
    this.steerAngle = damp(this.steerAngle, target, p.steerRate * (this.airborne ? 0.4 : 1), dt);

    // Yaw demand from a bicycle-ish model, then capped by what grip can pay for.
    const speedAuth = clamp(Math.abs(this._vLong) / 5.5, 0, 1);
    const dirSign = this._vLong < -0.5 ? -1 : 1;
    let yawRate = this.steerAngle * 2.55 * speedAuth * dirSign;
    // Never demand more turn than the friction limit allows, plus a small slide
    // allowance. That ceiling is the difference between "controllable slide" and
    // "spun into the barrier".
    // Non-drift allowance is generous on purpose: entering a corner too fast has
    // to produce a real, scrubby understeer slide, otherwise the yaw cap silently
    // does the driver's braking for them and corners cost nothing.
    const yawCap = (gripLat * (this.drifting ? 1.30 : 1.55)) / Math.max(Math.abs(this._vLong), 4.5);
    yawRate = clamp(yawRate, -yawCap, yawCap);
    if (this.airborne) yawRate *= 0.28;                     // token air steering

    if (this.drifting) {
      // ARCADE DRIFT. A physically-honest slide saturates lateral friction, which
      // means a drifting kart is stuck at ONE corner radius and cannot be lined
      // up — unplayable for a child. So while drifting we steer the *path* with
      // the stick and hang the visible slip angle off it as a rendered offset.
      // Fully controllable, still looks and charges like a real slide.
      const phi = yawRate * dt;
      const c = Math.cos(phi), sn = Math.sin(phi);
      const vx = this.velocity.x, vz = this.velocity.z;
      this.velocity.x = vx * c + vz * sn;
      this.velocity.z = -vx * sn + vz * c;
      // Slip magnitude: deeper when you hold the stick into the corner. This is
      // the number the charge rate reads, so committing harder charges faster.
      const slipMag = lerp(0.22, 0.45, (bias + 1) * 0.5) * clamp(speedAuth * 1.2, 0, 1);
      this.driftLean = damp(this.driftLean, this.driftDir * slipMag, 7, dt);
      this.yaw = Math.atan2(this.velocity.x, this.velocity.z) + this.driftLean;
    } else {
      // Counter-steer assist: quietly rotates the nose back toward the direction
      // of travel so a slide self-recovers. Backs off if the player is steering.
      const assist = (1.35 + 0.5 * p.stability) * (1 - Math.abs(steerIn) * 0.55);
      this.yaw += (yawRate - clamp(this.slipAngle, -0.8, 0.8) * assist * speedAuth) * dt;
      this.driftLean = damp(this.driftLean, 0, 6, dt);
    }
    this._syncBasis();
    // Re-project onto the new basis: the difference IS this frame's slip.
    this._vLong = this.velocity.x * this.forward.x + this.velocity.z * this.forward.z;
    this._vLat = this.velocity.x * this._lat.x + this.velocity.z * this._lat.z;
    this.slipAngle = Math.atan2(this._vLat, Math.max(Math.abs(this._vLong), 1.5));

    // ---- 8. drift state machine ------------------------------------------
    this._updateDrift(dt, wantDrift, steerIn, input.hop);

    // ---- 9. vertical ------------------------------------------------------
    if (this.airborne) {
      this.vy -= 23.5 * dt;
      this.position.y += this.vy * dt;
      if (this.position.y <= this.groundY) {
        this.position.y = this.groundY;
        if (this.vy < -4) {
          this.landingSquash = clamp(-this.vy / 16, 0, 1);
          this._vLong *= clamp(1 + this.vy * 0.006, 0.86, 1);  // small landing scrub
          this._recover = Math.max(this._recover, 0.25);
          this._writeVelocity();
        }
        this.vy = 0;
        this.airborne = false;
        this._rampVy = 0;
        // Coyote lock: refuse to re-launch for a moment after touching down, so
        // a bumpy crest cannot machine-gun the kart in and out of the air.
        this._landLock = 0.18;
      }
    } else {
      // Glued to the ground. Snapping (rather than letting gravity chase a
      // descending surface) is what keeps a kart from micro-hopping down every
      // gentle slope, which would spam the landing FX and kill air control.
      this.position.y = this.groundY;
      this.vy = 0;
      // Ramp launch: remember the fastest the ground was lifting us, and let go
      // the moment it stops lifting. That is a jump, and track 3 has several.
      if (groundVel > this._rampVy) this._rampVy = groundVel;
      else if (this._rampVy > 6.5 && groundVel < this._rampVy * 0.5 && this._vLong > 10 &&
               this._landLock <= 0) {
        this.airborne = true;
        this.vy = clamp(this._rampVy * 0.95, 0, 14);
        this.jumped = true;
        this._rampVy = 0;
      }
      if (groundVel < 0.5) this._rampVy = 0;
      if (this._landLock > 0) this._landLock -= dt;
    }
    this.landingSquash = damp(this.landingSquash, 0, 7, dt);

    // ---- 10. integrate ----------------------------------------------------
    this._writeVelocity();
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // ---- 11. walls, stuck, sanity ----------------------------------------
    this._walls(dt);
    this._antiStuck(dt, throttle);
    this.wallHit = damp(this.wallHit, 0, 8, dt);
    this.kartHit = damp(this.kartHit, 0, 8, dt);

    if (!Number.isFinite(this.position.x) || !Number.isFinite(this.position.z) ||
        !Number.isFinite(this.yaw) || !Number.isFinite(this._vLong)) {
      console.warn('kart physics went non-finite; respawning');
      this.respawn();
    }
    return this;
  }

  // -------------------------------------------------------------------------
  _updateDrift(dt, wantDrift, steerIn, wantHop) {
    const p = this.p;
    const fast = this._vLong > 7.5;

    // The pre-drift hop is a RENDERED pop, not a real ballistic launch. Making it
    // physical cost the kart ~0.26s of airborne time per drift entry — 12s of a
    // 47s lap with 52 drifts — and airborne means no grip and no steering by
    // design, so it was quietly destroying control everywhere. `hopOffset` is
    // for the mesh; the tyres never actually leave the road.
    if (this._hopTime > 0) {
      this._hopTime -= dt;
      const u = clamp(1 - this._hopTime / HOP_TIME, 0, 1);
      this.hopOffset = Math.sin(u * Math.PI) * 0.34;
    } else if (this.hopOffset) {
      this.hopOffset = damp(this.hopOffset, 0, 14, dt);
      if (this.hopOffset < 0.002) this.hopOffset = 0;
    }

    if ((wantDrift || wantHop) && !this.drifting && !this.airborne && this._hopTime <= 0 && !this._driftPending) {
      this._hopTime = HOP_TIME;
      this._driftPending = wantDrift && fast;
      this._vLat += steerIn * 1.4;             // the hop kicks the tail out a touch
    }

    if (!wantDrift) {
      if (this.drifting) this._releaseDrift();
      this._driftPending = false;
      return;
    }

    // Commit to a direction once the hop peaks and we're actually steering.
    if (!this.drifting && this._driftPending && !this.airborne && fast && this._hopTime < HOP_TIME * 0.55) {
      if (Math.abs(steerIn) > 0.12) {
        this.drifting = true;
        this.driftDir = Math.sign(steerIn);
        this.driftCharge = 0;
        this._driftPending = false;
      }
    }

    if (this.drifting) {
      // Bail out if we're too slow or have straightened up completely.
      if (this._vLong < 5.5) { this._releaseDrift(); return; }
      // Charge faster the harder you're sliding — rewards commitment, not holding.
      // Mostly time-based with a commitment bonus: charging must not punish a
      // player for steering to hold their line mid-drift.
      const slide = clamp(0.72 + Math.abs(this.slipAngle) / 0.55, 0.72, 1.4);
      const spd = clamp(this.speed / (p.topSpeed * 0.6), 0.35, 1.15);
      this.driftCharge += dt * slide * spd * p.driftRate * (this.offTrack ? 0.45 : 1);
      this.driftCharge = Math.min(this.driftCharge, MAX_DRIFT_CHARGE + 0.4);
      let tier = 0;
      for (let i = 0; i < DRIFT_TIERS.length; i++) if (this.driftCharge >= DRIFT_TIERS[i].charge) tier = i + 1;
      this.driftTier = tier;
      this.driftCharge01 = clamp(this.driftCharge / MAX_DRIFT_CHARGE, 0, 1);
    }
  }

  _releaseDrift() {
    if (this.drifting && this.driftTier > 0) {
      const t = DRIFT_TIERS[this.driftTier - 1];
      this.applyBoost(t.strength, t.duration, t.impulse);
    }
    this.drifting = false;
    this.driftDir = 0;
    this.driftTier = 0;
    this.driftCharge = 0;
    this.driftCharge01 = 0;
  }

  /** Force-cancel a drift without a reward (used on hard collisions). */
  breakDrift() {
    this.drifting = false; this.driftDir = 0; this.driftTier = 0;
    this.driftCharge = 0; this.driftCharge01 = 0; this._driftPending = false;
  }

  // -------------------------------------------------------------------------
  // Barrier: sits `runoff` metres beyond the track edge, so there is real
  // off-road to make a mistake in before you touch anything solid.
  // -------------------------------------------------------------------------
  _walls(dt) {
    const sp = this.spline;
    const s = sp.closestT(this.position);
    const halfWidth = sp.widthAt(s.t);
    const runoff = 5.5;
    const limit = halfWidth + runoff - this.radius * 0.5;
    const a = Math.abs(s.lateral);
    if (a <= limit) { this._wallContact = Math.max(0, this._wallContact - dt * 2); return; }

    const sign = Math.sign(s.lateral) || 1;
    const right = sp.rightAt(s.t);
    const nx = right.x * sign, nz = right.z * sign;    // outward wall normal
    // Push straight back in along the track normal — cheap, and it can never
    // trap a kart in a corner of geometry the way a mesh collider can.
    const push = a - limit;
    this.position.x -= nx * push;
    this.position.z -= nz * push;

    // Decompose into normal + along-wall. Zero the normal part, KEEP most of the
    // along-wall part: sliding down a barrier must never stop a kid dead — that
    // is the single most rage-inducing thing an arcade racer can do.
    const outward = this.velocity.x * nx + this.velocity.z * nz;
    if (outward > 0) {
      const hit = clamp(outward / 11, 0, 1);
      const tx = this.velocity.x - nx * outward, tz = this.velocity.z - nz * outward;
      const keep = lerp(0.96, 0.74, hit);
      // Small inward restitution. Without it a head-on hit has no tangential
      // component at all, so the kart simply stops dead against the barrier —
      // the most demoralising thing that can happen to an eight-year-old.
      const bounce = Math.min(outward * 0.3, 6);
      this.velocity.x = tx * keep - nx * bounce;
      this.velocity.z = tz * keep - nz * bounce;
      // Point the nose along the barrier but angled slightly back INTO the track,
      // so the recovery drives itself instead of scraping down the wall forever.
      const tan = sp.tangentAt(s.t);
      const goal = Math.atan2(tan.x, tan.z) + sign * 0.55;
      let d = goal - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * clamp(hit * 0.8 + 0.12, 0, 0.45);
      this._syncBasis();
      this._vLong = this.velocity.x * this.forward.x + this.velocity.z * this.forward.z;
      this._vLat = this.velocity.x * this._lat.x + this.velocity.z * this._lat.z;
      // Never leave the kart with less than a crawl after a hit.
      this._vLong = Math.max(this._vLong, Math.min(outward * 0.35, 8));
      this.wallHit = Math.max(this.wallHit, hit);
      if (hit > 0.35) this.breakDrift();
      this._recover = 1.3;               // assist window so kids recover fast
      this._writeVelocity();
    }
    this._wallContact = Math.min(this._wallContact + dt, 3);
  }

  // -------------------------------------------------------------------------
  // Anti-stuck: shuffling against a barrier for 1.2s gets you a gentle,
  // non-punishing shove back toward the racing line, pointing the right way.
  // -------------------------------------------------------------------------
  _antiStuck(dt, throttle) {
    const crawling = this.speed < (this._wallContact > 0.05 ? 5.0 : 2.2);
    const trying = throttle > 0.15 || this._wallContact > 0.1;
    if (crawling && trying && !this.airborne) this._stuck += dt; else this._stuck = Math.max(0, this._stuck - dt * 1.6);
    if (this._stuck < 1.2) return;

    const sp = this.spline;
    const s = sp.closestT(this.position);
    const tan = sp.tangentAt(s.t);
    const goalYaw = Math.atan2(tan.x, tan.z);
    let d = goalYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * 0.5;
    const target = sp.offsetPoint(s.t, clamp(s.lateral, -sp.widthAt(s.t) * 0.55, sp.widthAt(s.t) * 0.55));
    this.position.lerp(target, 0.6);
    this.position.y = target.y;
    this._syncBasis();
    this._vLong = Math.max(this._vLong, 4.5);
    this._vLat = 0;
    this._stuck = 0;
    this._wallContact = 0;
    this._recover = 0.8;
    this.unstuckPulse = this.time;      // FX/audio can watch this
    this._writeVelocity();
  }

  // -------------------------------------------------------------------------
  // Kart vs kart: circle push-apart with a mass-weighted split and a bit of
  // bounce. Heavy racers shove, light racers get shoved — the `weight` stat's
  // whole personality lives here.
  // -------------------------------------------------------------------------
  collideWith(other) {
    const dx = other.position.x - this.position.x;
    const dz = other.position.z - this.position.z;
    const rr = this.radius + other.radius;
    let d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) return false;
    let d = Math.sqrt(d2);
    let nx, nz;
    if (d < 1e-4) { nx = 1; nz = 0; d = 1e-4; } else { nx = dx / d; nz = dz / d; }
    const pen = rr - d;
    const mA = this.mass, mB = other.mass, tot = mA + mB;
    this.position.x -= nx * pen * (mB / tot); this.position.z -= nz * pen * (mB / tot);
    other.position.x += nx * pen * (mA / tot); other.position.z += nz * pen * (mA / tot);

    // Relative closing speed along the normal -> a punchy but brief exchange.
    const rvx = other.velocity.x - this.velocity.x, rvz = other.velocity.z - this.velocity.z;
    const closing = rvx * nx + rvz * nz;
    if (closing < 0) {
      const j = -closing * 1.55;
      this._impulse(-nx * j * (mB / tot), -nz * j * (mB / tot));
      other._impulse(nx * j * (mA / tot), nz * j * (mA / tot));
      const hit = clamp(-closing / 10, 0, 1);
      this.kartHit = Math.max(this.kartHit, hit);
      other.kartHit = Math.max(other.kartHit, hit);
      this._recover = other._recover = 0.5;
      if (hit > 0.55) { this.breakDrift(); other.breakDrift(); }
    }
    this._writeVelocity(); other._writeVelocity();
    return true;
  }

  _impulse(ix, iz) {
    this.velocity.x += ix; this.velocity.z += iz;
    this._vLong = this.velocity.x * this.forward.x + this.velocity.z * this.forward.z;
    this._vLat = this.velocity.x * this._lat.x + this.velocity.z * this._lat.z;
  }

  /** O(n^2) over 8 karts is nothing; called once per step by the race scene. */
  static resolveCollisions(bodies) {
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) bodies[i].collideWith(bodies[j]);
  }

  /** Snapshot for HUD / FX / audio / AI. Cheap, allocation-free apart from vectors. */
  getState() {
    return {
      position: this.position, quaternion: this.quaternion,
      renderQuaternion: this.renderQuaternion, velocity: this.velocity,
      speed: this.speed, speed01: this.speed01, steerAngle: this.steerAngle,
      slipAngle: this.slipAngle, drifting: this.drifting, driftTier: this.driftTier,
      driftCharge01: this.driftCharge01, driftColor: this.driftTier ? DRIFT_TIERS[this.driftTier - 1].color : 0,
      boosting: this.boosting, boostStrength: this.boostStrength,
      airborne: this.airborne, landingSquash: this.landingSquash,
      offTrack: this.offTrack, surfaceKind: this.surfaceKind, rumble: this.rumble,
      lapT: this.lapT, lastValidT: this.lastValidT, lateral: this.lateral,
      wallHit: this.wallHit, kartHit: this.kartHit,
    };
  }
}

// ===========================================================================
// preview(engine) — stand-in boxes driving the oasis track on autopilot with
// the real ChaseCamera, over the centreline drawn as a ribbon.
// ===========================================================================

// Curvature in trackdef is the heading change over a +/-6 sample window, so the
// arc it spans is 12 * (length/N) metres. Radius = arc / angle.
const curveArc = spline => 12 * (spline.length / spline.N);

/** Corner radius in metres at t (capped — a straight is "infinitely" wide). */
export function radiusAt(spline, t, ahead = 0) {
  const c = ahead ? spline.maxCurvatureAhead(t, ahead) : Math.abs(spline.curvatureAt(t));
  return Math.min(2000, curveArc(spline) / Math.max(c, 1e-4));
}

/**
 * The "hold throttle, aim 15m up the spline" reference driver. Used by the
 * preview, by .tmp/feeltest.mjs, and as a sane starting point for src/kart/ai.js.
 */
export function autopilotInput(body, spline, opts = {}) {
  const v = Math.max(body.speed, 3);
  // Pure pursuit: aim at a point L metres up the centreline, take the arc that
  // reaches it, and invert the kart's own steering model to ask for that arc.
  // Inverting the model (rather than a hand-tuned P gain) is what stops the
  // classic autopilot slalom, which would poison every lap-time number here.
  const L = (opts.look ?? 15) + v * 0.42;
  const t0 = body.lapT;
  const aim = spline.positionAt((t0 + L / spline.length) % 1);
  const dx = aim.x - body.position.x, dz = aim.z - body.position.z;
  // yaw+ turns toward +X, and (f x d) = f.x*d.z - f.z*d.x is NEGATIVE for a
  // target on our +X side — hence the minus.
  // Steer relative to where we are actually TRAVELLING, not where the nose is
  // pointing: while drifting the nose carries a big rendered lean, and a
  // controller that chases the nose instead of the path fights its own drift.
  let fx = body.forward.x, fz = body.forward.z;
  if (body.drifting && body.speed > 4) {
    const m = Math.hypot(body.velocity.x, body.velocity.z) || 1;
    fx = body.velocity.x / m; fz = body.velocity.z / m;
  }
  const cross = fx * dz - fz * dx;
  const dot = fx * dx + fz * dz;
  const alpha = -Math.atan2(cross, dot);
  const dist = Math.max(Math.hypot(dx, dz), 1);
  const kappa = 2 * Math.sin(clamp(alpha, -1.4, 1.4)) / dist;   // pure-pursuit curvature
  const yawWanted = kappa * v;
  const lock = body.steerLock ?? 1;
  let steer = clamp(yawWanted / (2.55 * Math.max(lock, 0.08)), -1, 1);

  // Cornering speed from real grip: v = sqrt(mu * R), looked far enough ahead
  // that there is time to brake.
  let throttle = 1, brake = 0;
  const horizon = clamp((v * 1.5) / spline.length, 0.01, 0.05);
  const R = radiusAt(spline, t0, horizon);
  if (opts.corner !== false) {
    // Use the grip we will actually have: a drifting kart corners ~10% faster,
    // and an AI that ignores that just brakes away its own drift advantage.
    const mu = body.p.grip * (body.drifting ? DRIFT_GRIP : 1);
    const limit = Math.min(60, 0.96 * Math.sqrt(mu * R));
    if (body.speed > limit + 2.5) { throttle = 0; brake = 0.8; }
    else if (body.speed > limit) throttle = 0.3;
  }

  // Drift whenever the pursuit controller is already asking for a real corner,
  // in the direction it is already turning — deriving the direction from a
  // curvature lookahead instead gets S-bends wrong and drives into the wall.
  let wantDrift = false;
  if (opts.drift) {
    const dir = body.drifting ? body.driftDir : Math.sign(steer);
    // Hold the drift through the short straights too — charging down a straight
    // and releasing into the next corner is the real skill expression.
    if (body.drifting) {
      // Release as the corner opens out, so the boost lands on the straight
      // where it can actually be spent — that is most of the drift's value.
      // Hold for orange where possible: releasing at blue every time is what
      // made the upper tiers unreachable and the whole ladder decorative.
      const ripe = body.driftCharge >= DRIFT_TIERS[1].charge;
      wantDrift = body.speed > 9 && steer * dir > -0.68 &&
        !(ripe && R > 220) && body.driftCharge < DRIFT_TIERS[2].charge;
    }
    else wantDrift = R < 250 && body.speed > 13 && Math.abs(steer) > 0.14;
    if (wantDrift && body.drifting) {
      // Invert the drift steering map (see KartBody section 7) so a pursuit
      // command means the same arc whether we are drifting or not.
      const want = clamp(steer * dir, 0, 1);
      steer = dir * clamp(2 * (want - 0.02) / 0.98 - 1, -1, 1);
    }
  }
  return { throttle, brake, steer, drift: wantDrift, hop: false };
}

export function preview(engine) {
  const { def, spline } = getTrack('oasis');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b3350);
  scene.fog = new THREE.FogExp2(0xc99a63, 0.0022);

  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 1400);
  const chase = new ChaseCamera(camera, { spline });

  // Golden-hour-ish key so the preview isn't a grey blob.
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.1);
  sun.position.set(-90, 60, 40);
  scene.add(sun, new THREE.HemisphereLight(0x8fa8dd, 0x6b4a2c, 0.85));

  // Ground plane.
  const groundGeo = new THREE.PlaneGeometry(1600, 1600);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xb07a49 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  scene.add(ground);

  // Track ribbon straight off the spline, plus a centre stripe for motion cues.
  const ribbon = ribbonMesh(spline, 1.0, 0x4a4a52, 0.02);
  const stripe = ribbonMesh(spline, 0.06, 0xf3e6c8, 0.05);
  const edgeL = ribbonMesh(spline, 0.045, 0xffffff, 0.045, 0.94);
  const edgeR = ribbonMesh(spline, 0.045, 0xffffff, 0.045, -0.94);
  scene.add(ribbon, stripe, edgeL, edgeR);

  // Stand-in kart: chassis + fat rear tyres + a driver blob. Boxes only.
  const kartRoot = new THREE.Group();
  const disposables = [groundGeo, groundMat];
  const box = (w, h, d, col, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.MeshLambertMaterial({ color: col });
    const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z);
    disposables.push(g, m); kartRoot.add(mesh); return mesh;
  };
  box(1.3, 0.42, 2.2, 0xffc247, 0, 0.44, 0);
  box(1.05, 0.34, 0.62, 0xff7a2f, 0, 0.78, -0.35);   // driver
  box(0.62, 0.3, 0.3, 0xff7a2f, 0, 0.5, 1.25);       // nose
  const wheel = (x, z, r) => box(0.34, r * 2, r * 2, 0x22242e, x, r, z);
  wheel(0.78, -0.72, 0.44); wheel(-0.78, -0.72, 0.44);
  const fl = wheel(0.72, 0.78, 0.32), fr = wheel(-0.72, 0.78, 0.32);
  scene.add(kartRoot);

  // Sparse edge posts: without something passing the camera, speed is invisible.
  const postGeo = new THREE.BoxGeometry(0.45, 1.5, 0.45);
  const postMat = new THREE.MeshLambertMaterial({ color: 0xf0e2c4 });
  const nPosts = 2 * 96;
  const posts = new THREE.InstancedMesh(postGeo, postMat, nPosts);
  const m4 = new THREE.Matrix4(), pv = new THREE.Vector3(), rv = new THREE.Vector3();
  for (let i = 0; i < nPosts / 2; i++) {
    const t = i / (nPosts / 2);
    spline.positionAt(t, pv); spline.rightAt(t, rv);
    const w = spline.widthAt(t) + 1.6;
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      m4.makeTranslation(pv.x + rv.x * w * sgn, pv.y + 0.75, pv.z + rv.z * w * sgn);
      posts.setMatrixAt(i * 2 + (sgn > 0 ? 1 : 0), m4);
    }
  }
  posts.instanceMatrix.needsUpdate = true;
  scene.add(posts);
  disposables.push(postGeo, postMat);

  const slots = gridSlots(spline, def, 8);
  const body = new KartBody({
    spline, stats: { speed: 3, accel: 4, handling: 4, weight: 3 }, startSlot: slots[0],
  });
  body._vLong = 16;   // roll in already moving so the first screenshot has speed

  let t = 0;
  return {
    scene, camera,
    update(dt) {
      t += dt;
      const input = autopilotInput(body, spline, { drift: true });
      body.update(dt, input);
      kartRoot.position.copy(body.position);
      kartRoot.position.y += body.hopOffset;      // the hop is a rendered offset
      kartRoot.quaternion.copy(body.renderQuaternion);
      const squash = 1 - body.landingSquash * 0.3;
      kartRoot.scale.set(1 / squash, squash, 1 / squash);
      // Visible steering + drift lean so the stand-in reads as a kart.
      fl.rotation.y = fr.rotation.y = body.steerAngle * 0.5;
      kartRoot.rotateZ(-body.slipAngle * 0.22);
      chase.update(dt, body);
    },
    dispose() {
      posts.dispose();
      for (const d of disposables) d.dispose();
      for (const m of [ribbon, stripe, edgeL, edgeR]) { m.geometry.dispose(); m.material.dispose(); }
    },
  };
}


function ribbonMesh(spline, widthFrac, color, yOff, lateralFrac = 0) {
  const N = 600;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const idx = [];
  const p = new THREE.Vector3(), r = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = (i / N) % 1;
    spline.positionAt(t, p); spline.rightAt(t, r);
    const w = spline.widthAt(t);
    const c = w * lateralFrac, hw = Math.max(0.12, w * widthFrac);
    const k = i * 6;
    pos[k] = p.x + r.x * (c - hw); pos[k + 1] = p.y + yOff; pos[k + 2] = p.z + r.z * (c - hw);
    pos[k + 3] = p.x + r.x * (c + hw); pos[k + 4] = p.y + yOff; pos[k + 5] = p.z + r.z * (c + hw);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
}

// Keyboard/touch input → the neutral `{throttle, brake, steer, drift, hop}` shape
// that KartBody consumes. The AI produces the identical shape, so player and AI
// go through exactly the same physics (see DECISIONS: no cheating AI).
import { bus } from './bus.js';

const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  drift: ['ShiftLeft', 'ShiftRight', 'Space'],
  pause: ['Escape', 'KeyP'],
  look: ['KeyC'],
};

// ── PLAYER STEER SIGN (Wave 2, P0 #2) ────────────────────────────────────────
// The simulation's internal `steer` is positive-turns-LEFT: it feeds yaw directly,
// and the drift path derives driftLean/driftDir from the same sign, so inverting it
// inside kartphysics breaks drift and the approved driving feel. Every in-engine
// producer (AIDriver, autopilotInput) is tuned against that internal sign.
//
// The PLAYER-facing convention is the opposite and obvious one: the right arrow
// turns right. That translation belongs here, at the boundary between a human and
// the sim, and is applied exactly once — this is the only place a human's intent
// becomes a sim input.
export const PLAYER_STEER_SIGN = -1;

export class Input {
  constructor() {
    this.down = new Set();
    this.enabled = true;
    this._steer = 0;
    this.touch = { steer: 0, throttle: 0, drift: false, active: false };

    this._kd = e => {
      if (e.repeat) return;
      // Never swallow browser chrome shortcuts or accessibility keys.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (KEYS.pause.includes(e.code)) { bus.emit('input:pause'); e.preventDefault(); return; }
      if (!this.enabled) return;
      if (isGameKey(e.code)) { this.down.add(e.code); e.preventDefault(); }
    };
    this._ku = e => { this.down.delete(e.code); };
    this._blur = () => this.down.clear();   // alt-tab must not stick the throttle on

    addEventListener('keydown', this._kd, { passive: false });
    addEventListener('keyup', this._ku);
    addEventListener('blur', this._blur);
  }

  any(list) { for (const k of list) if (this.down.has(k)) return true; return false; }

  /**
   * @param {number} dt fixed step
   * @returns {{throttle:number, brake:number, steer:number, drift:boolean, hop:boolean}}
   */
  sample(dt) {
    if (!this.enabled) { this._steer = 0; return NEUTRAL; }
    const T = this.touch;
    let want = (this.any(KEYS.right) ? 1 : 0) - (this.any(KEYS.left) ? 1 : 0);
    if (T.active && T.steer) want = T.steer;
    want *= PLAYER_STEER_SIGN;   // human intent -> sim convention; see above

    // Ramp toward the target rather than snapping. Digital keys with instant
    // full lock feel twitchy and make the kart impossible for a young player to
    // hold straight; releasing snaps back fast so it still feels responsive.
    const rate = want === 0 ? 9.5 : 6.0;
    this._steer += (want - this._steer) * Math.min(1, rate * dt);
    if (Math.abs(this._steer) < 0.004) this._steer = 0;

    const fwd = this.any(KEYS.up) || T.throttle > 0;
    const rev = this.any(KEYS.down);
    return {
      throttle: fwd ? 1 : (T.active ? T.throttle : 0),
      brake: rev ? 1 : 0,
      steer: this._steer,
      drift: this.any(KEYS.drift) || T.drift,
      hop: this.any(KEYS.drift) || T.drift,
    };
  }

  reset() { this.down.clear(); this._steer = 0; }

  dispose() {
    removeEventListener('keydown', this._kd);
    removeEventListener('keyup', this._ku);
    removeEventListener('blur', this._blur);
    this.down.clear();
  }
}

const NEUTRAL = { throttle: 0, brake: 0, steer: 0, drift: false, hop: false };

function isGameKey(code) {
  for (const list of Object.values(KEYS)) if (list.includes(code)) return true;
  return false;
}

export { KEYS, NEUTRAL };

// Tiny synchronous event bus. Keeps subsystems (race <-> hud <-> audio) decoupled
// so the DOM shell can be swapped for React without touching game logic.
const map = new Map();

export const bus = {
  on(evt, fn) {
    if (!map.has(evt)) map.set(evt, new Set());
    map.get(evt).add(fn);
    return () => bus.off(evt, fn);
  },
  once(evt, fn) {
    const off = bus.on(evt, (...a) => { off(); fn(...a); });
    return off;
  },
  off(evt, fn) { map.get(evt)?.delete(fn); },
  emit(evt, payload) {
    const s = map.get(evt);
    if (!s) return;
    for (const fn of [...s]) {
      try { fn(payload); } catch (e) { console.error(`bus handler failed for "${evt}"`, e); }
    }
  },
  clear() { map.clear(); },
};

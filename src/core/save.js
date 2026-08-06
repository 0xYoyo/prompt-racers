// Progress persistence. localStorage ONLY, and deliberately nothing that could
// identify a child: no name, no id, no timestamps, no free-text except the
// player's own prompt drafts (kept locally so the garage can show their history).
const KEY = 'promptracers.v1';

const DEFAULTS = {
  lang: 'he',
  quality: 'auto',
  tokens: 0,
  championshipRace: 0,      // 0..2 — which race is next
  results: [],              // [{track, place, time}]
  parts: {},                // slot -> installed part {id, score, stats}
  tipsSeen: [],             // tip ids unlocked so far
  expertUnlocked: false,
  bestLap: {},              // trackId -> ms
  muted: false,
};

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    // Merge so a save from an older build never hard-crashes a newer one.
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export const save = {
  get: () => state,
  read: k => state[k],
  set(patch) {
    Object.assign(state, patch);
    save.flush();
    return state;
  },
  flush() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: run in-memory */ }
  },
  reset() {
    state = { ...DEFAULTS };
    save.flush();
    return state;
  },
  // Used by the screenshot harness to force a clean, deterministic starting point.
  _replace(s) { state = { ...DEFAULTS, ...s }; },
};

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
  volume: 0.75,             // master volume 0..1 — separate from `muted` (D31)
  championshipAsked: [],    // quiz question ids already asked THIS championship

  // ── האוסף שלי (Wave 4) ─────────────────────────────────────────────────
  // Deliberately OUTSIDE the championship reset. A badge is something the child
  // earned once and keeps; a glossary term is something they have been taught.
  // resetChampionship() in ui/menus.js clears the ledger and leaves these two
  // alone; only the settings screen's full wipe (save.reset()) removes them.
  badges: [],               // unlocked badge ids
  glossary: [],             // unlocked glossary term ids
  stats: {},                // lifetime counters the badges are measured against
  funTitle: null,           // certificate title, chosen from PRESETS only
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

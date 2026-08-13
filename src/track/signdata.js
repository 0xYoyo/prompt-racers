// ═══════════════════════════════════════════════════════════════════════════
// WORLD TEXT — the one authored phrase set, and the one path that draws it.
//
// WHY THIS FILE EXISTS (Wave 5). Before it, three independent pieces of code
// drew Hebrew into the 3D world and none of them shared a line:
//
//   1. trackbuild.js  TRACK_SIGNS + signLayout + signAtlas — the roadside
//      curriculum from D38. Measured, fitted, correct. The good one.
//   2. trackbuild.js  BRANDS + brandTexture — a fourth copy of the brand list,
//      drawn at a fixed font size with no fit step, and called by nobody.
//   3. props.js       BRANDS + brandAtlas, and holoTexture — square 2x2 tile
//      atlases drawn at a FIXED font size with NO measurement, then mapped onto
//      4.5:1 and 2:1 banner quads. Measured with the real font at 1024 px:
//      'מנוע פרומפט' came out 656 px wide inside a 512 px tile (+28%), so half
//      of it landed in the NEIGHBOURING tile — and the neighbour, drawn after
//      it, painted its own background over the spill. Every barrier board and
//      every holo billboard in the game therefore showed a truncated word glued
//      to a fragment of a different word: 'נוע פרומפטרבו־בינה'. That is the
//      "corrupted / non-words / random" the player reported, and no amount of
//      anti-mirroring work could ever have touched it.
//
// So: ONE phrase set, ONE fitter, ONE draw call. Everything lettered in the
// world — roadside signage, barrier sponsor boards, holo billboards and the
// start gantry — goes through `drawWorldText` below.
//
// ── THE GOVERNING LAW (D38), restated because everything here obeys it ──────
// While a line is width-limited,
//
//     inkMetres = TEXT_BODY_EM * TEXT_FIT_W * boardWidthMetres / characters
//               ≈ 0.3 * boardWidth / characters
//
// (D38 wrote this identity with a 0.70 "cap" and got ≈ 0.4; that constant was
// an ascender, not the letter body — see TEXT_BODY_EM. The law is unchanged,
// its coefficient was 34% too generous.)
//
// the tile aspect cancelling out entirely. Legibility is bought with METRES OF
// BOARD PER CHARACTER and with nothing else. Two consequences that this file
// enforces rather than hopes for:
//   * copy stays short (<= SIGN_MAX_CHARS) and the boards stay wide;
//   * a tile's ASPECT MUST MATCH ITS BOARD'S. A square tile stretched onto a
//     4.5:1 quad is not merely ugly, it is what let the overflow happen: the
//     fit budget the drawing code believed in had nothing to do with the metres
//     of board the text actually had. Every atlas here is now built from
//     cols/rows chosen so that `rows/cols` IS the board aspect.
//
// This module imports nothing. It is data plus arithmetic, so it can be pulled
// into a headless gate, and so props.js and trackbuild.js can both depend on it
// without depending on each other.
// ═══════════════════════════════════════════════════════════════════════════

/* ══════════════════════════════════════════════════ the shared text engine ══ */

/**
 * Average glyph advance of the bold Hebrew face, in em. Sizing is ANALYTIC —
 * `measureText` needs a real font and a real canvas, so anything that decides a
 * size inside a draw callback is invisible to a gate and can silently shrink to
 * nothing (D38) or silently overflow (this wave).
 *
 * THE MODEL MUST DESCRIBE THE FONT THAT ACTUALLY RENDERS, NOT THE ONE THIS
 * MACHINE HAPPENS TO HAVE. Measured in real Chrome at 1024 px over every phrase
 * in this file (bold; worst 'שכבה נסתרת' on Arial Hebrew, 'עבודה מתחלקת' on the fallback):
 *
 *     "Arial Hebrew"          0.555 em/char   ← macOS, the first name in the stack
 *     "Noto Sans Hebrew"      0.473 em/char   ← where it is installed
 *     generic `sans-serif`    0.605 em/char   ← Windows / Linux / Android / ChromeOS
 *
 * The generic fallback is what most judges and every school laptop will render,
 * and it is 9.1% wider than the face the old 0.55 was fitted to — so the model
 * was arithmetic about a font that was probably not the one on screen. 0.62
 * keeps it on the pessimistic side of the WIDEST fallback, not of the local one.
 * Nothing ever overflowed (drawWorldText clips and shrinks); what was wrong was
 * the number the legibility table was computed from. Board widths were bought
 * back by the same 12% in trackbuild so the metres-per-character stayed put.
 */
export const TEXT_ADV_EM = 0.62;
/**
 * TWO NUMBERS, BECAUSE ONE WAS ANSWERING TWO DIFFERENT QUESTIONS (Wave 5 r3).
 *
 * There used to be a single `TEXT_CAP_EM = 0.70`, used both to reserve vertical
 * room in the layout and to report how big the letters are. Measured in real
 * Chrome, bold, at 1000 px, per letter over every phrase in this file, the
 * LETTER BODY — the ink a child actually sees — is:
 *
 *     "Arial Hebrew"        0.518-0.524 em     <- macOS, first in the stack
 *     "Noto Sans Hebrew"    0.549-0.553 em
 *     generic `sans-serif`  0.584-0.596 em     <- Windows / Linux / ChromeOS
 *
 * 0.70 em is approximately the ASCENDER of ל — a letter that appears in only 14
 * of the 36 authored lines and carries none of the legibility of the other 22.
 * Running the shipping `drawWorldText` and measuring the ink it actually draws
 * gives a mean trueInk/0.70 of 0.85, and it is bimodal: 0.749 for lines with no
 * ל, 1.023 for lines with one. The honest single number is 0.749, i.e. every
 * legibility figure this project has published was ~34% too flattering.
 *
 * How that survived five waves: `TEXT_ADV_EM` IS pinned against real-Chrome
 * measurement in tests/signage.test.mjs, and `TEXT_CAP_EM` was asserted
 * nowhere. A constant nothing gates is a comment.
 *
 * So:
 *   TEXT_ASCENT_EM — LAYOUT. How much height a row of this face may need,
 *     ascender included. Pessimistic on purpose: reserving too little is how
 *     letters get clipped by a tile edge.
 *   TEXT_BODY_EM — LEGIBILITY REPORTING. The height of the letter body on the
 *     face that draws it SMALLEST, so a published px figure is the worst a
 *     child sees rather than the best. Pinned against the measurement above.
 */
export const TEXT_ASCENT_EM = 0.70;
export const TEXT_BODY_EM = 0.524;
/**
 * @deprecated The old single constant, kept only so nothing outside this module
 * breaks mid-wave. It is the LAYOUT number; anything reporting how readable a
 * board is wants TEXT_BODY_EM.
 */
export const TEXT_CAP_EM = TEXT_ASCENT_EM;
/** Fraction of the tile WIDTH the text may occupy. */
export const TEXT_FIT_W = 0.86;
/** Fraction of the tile HEIGHT the whole text block may occupy. */
export const TEXT_FIT_H = 0.88;
/** Font size ceiling, as a fraction of tile height. */
export const TEXT_MAX_EM = 0.52;
/** Line spacing, in multiples of the font size. */
export const TEXT_LEAD = 1.16;
/** The one world-text face, named once. */
export const TEXT_FONT = '"Arial Hebrew", "Noto Sans Hebrew", sans-serif';

/**
 * Live counters for the shared path, so a gate can assert on what the DRAWING
 * actually did rather than on what the source strings look like.
 *   drawn     — lines drawn through drawWorldText
 *   wrapped   — lines that needed a second row
 *   shrunk    — lines the real-font clamp had to shrink below the analytic size
 *   overflow  — lines that could NOT be made to fit (must stay 0)
 */
/**
 * Live record of the shared path, so a gate can assert on what the DRAWING
 * actually did rather than on what the source strings look like.
 *   drawn/wrapped/shrunk — counters
 *   overflow — lines that could NOT be made to fit (must stay 0)
 *   draws    — one entry per line drawn: {key, line, rows, px, widthPx, limit}.
 *              `rows` joined back together must equal `line`; that is the
 *              no-truncation, no-dropped-word proof, taken from the shipping
 *              code path rather than from a re-implementation of it.
 * Bounded at DRAW_LOG_MAX so a long session cannot grow it without limit.
 */
export const WORLD_TEXT_STATS = { drawn: 0, wrapped: 0, shrunk: 0, overflow: 0, worst: null, draws: [] };
const DRAW_LOG_MAX = 512;
export function resetWorldTextStats() {
  WORLD_TEXT_STATS.drawn = 0; WORLD_TEXT_STATS.wrapped = 0;
  WORLD_TEXT_STATS.shrunk = 0; WORLD_TEXT_STATS.overflow = 0;
  WORLD_TEXT_STATS.worst = null;
  WORLD_TEXT_STATS.draws.length = 0;
}

/** Split a line into `n` rows on word boundaries, balancing row lengths. */
function splitRows(line, n) {
  const words = String(line).trim().split(/\s+/);
  if (n <= 1 || words.length < n) return [String(line).trim()];
  // Only two rows are ever wanted on a banner; pick the split that minimises the
  // longest row, which is what decides the font size.
  let best = null;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
    const score = Math.max(a.length, b.length);
    if (!best || score < best.score) best = { rows: [a, b], score };
  }
  return best.rows;
}

/**
 * Lay a line out on a tile, deterministically and WITHOUT a canvas.
 *
 * @param {string} line
 * @param {number} aspect   tile width / tile height
 * @param {object} [opts]   {maxEm, fitW, fitH, maxRows}
 * @returns {{rows:string[], fontFrac:number, capFrac:number, chars:number}}
 *   fontFrac/capFrac are fractions of the TILE HEIGHT, which equals the board's
 *   world height — so `capFrac * boardHeightMetres` is the cap height a driver
 *   actually sees, and that is what the legibility gate projects.
 *
 * Shrink-to-fit first, wrap to a second row only if that buys a bigger glyph.
 * It NEVER truncates: the returned rows always contain every character of the
 * input, and the size is chosen so they fit.
 */
export function fitText(line, aspect, opts = {}) {
  const maxEm = opts.maxEm ?? TEXT_MAX_EM;
  const fitW = opts.fitW ?? TEXT_FIT_W;
  const fitH = opts.fitH ?? TEXT_FIT_H;
  const maxRows = opts.maxRows ?? 2;
  const text = String(line).trim();
  const sizeFor = (rows) => {
    const longest = Math.max(1, ...rows.map(r => r.length));
    const byWidth = (fitW * aspect) / (TEXT_ADV_EM * longest);
    // n rows at TEXT_LEAD spacing occupy (n-1)*LEAD + 1 em of tile height.
    const byHeight = fitH / ((rows.length - 1) * TEXT_LEAD + 1);
    return Math.min(maxEm, byWidth, byHeight);
  };
  let best = { rows: [text], fontFrac: sizeFor([text]) };
  for (let n = 2; n <= maxRows; n++) {
    const rows = splitRows(text, n);
    if (rows.length < n) break;
    const f = sizeFor(rows);
    if (f > best.fontFrac * 1.02) best = { rows, fontFrac: f };
  }
  return {
    rows: best.rows, fontFrac: best.fontFrac,
    // capFrac is the LAYOUT height (ascender included); inkFrac is the letter
    // body, which is what a legibility figure has to be computed from. Both are
    // fractions of the TILE HEIGHT = the board's world height.
    capFrac: best.fontFrac * TEXT_ASCENT_EM,
    inkFrac: best.fontFrac * TEXT_BODY_EM,
    chars: text.length,
  };
}

/**
 * THE ONE PLACE ANY HEBREW IS DRAWN INTO THE 3D WORLD.
 *
 * @param ctx     2D context
 * @param line    the phrase (never truncated, never mirrored — see `direction`)
 * @param box     {x, y, w, h} the tile, in canvas pixels
 * @param style   {fg, shadow, maxEm, fitW, fitH, maxRows, baseline, key}
 *
 * Guarantees, in order:
 *   1. RTL. `ctx.direction = 'rtl'` with ONE fillText per logical line — the
 *      canvas bidi pass is per-call, so a line split across calls reorders.
 *   2. WHOLE. The analytic size from `fitText`, then a real-font `measureText`
 *      clamp that may only SHRINK. If a line still cannot fit at the floor it
 *      is counted in WORLD_TEXT_STATS.overflow, which a gate pins at zero.
 *   3. CONTAINED. The tile is clipped, so even a font wilder than the model can
 *      never paint into a neighbouring tile. That containment is what the 2x2
 *      brand atlases lacked, and it is why their neighbours read as gibberish.
 */
export function drawWorldText(ctx, line, box, style = {}) {
  const { x, y, w, h } = box;
  const fitW = style.fitW ?? TEXT_FIT_W;
  const lay = fitText(line, w / h, style);
  const floor = Math.max(6, Math.round(h * 0.09));
  let px = Math.max(floor, Math.round(h * lay.fontFrac));
  const setFont = () => { ctx.font = `bold ${px}px ${TEXT_FONT}`; };
  const widest = () => {
    let m = 0;
    for (const r of lay.rows) m = Math.max(m, ctx.measureText(r)?.width || 0);
    return m;
  };
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont();
  const limit = w * fitW;
  let wpx = widest();
  const analytic = px;
  for (let g = 0; g < 6 && wpx > limit && px > floor; g++) {
    px = Math.max(floor, Math.floor(px * Math.min(0.97, limit / wpx)));
    setFont();
    wpx = widest();
  }
  WORLD_TEXT_STATS.drawn++;
  if (lay.rows.length > 1) WORLD_TEXT_STATS.wrapped++;
  if (px < analytic) WORLD_TEXT_STATS.shrunk++;
  if (wpx > limit) {
    WORLD_TEXT_STATS.overflow++;
    WORLD_TEXT_STATS.worst = { line: String(line), px, wpx, limit, key: style.key || '' };
  }
  // Containment. Never lets one tile's ink reach another tile's pixels.
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const painted = [];
  const cx = x + w / 2;
  const cy = y + h * (style.baseline ?? 0.52);
  const lead = px * TEXT_LEAD;
  lay.rows.forEach((row, r) => {
    const ry = cy + (r - (lay.rows.length - 1) / 2) * lead;
    if (style.shadow) {
      ctx.fillStyle = style.shadow;
      ctx.fillText(row, cx + w * 0.006, ry + h * 0.016);
    }
    if (style.glow) { ctx.shadowColor = style.glow; ctx.shadowBlur = h * 0.09; }
    ctx.fillStyle = style.fg || '#ffffff';
    ctx.fillText(row, cx, ry);
    ctx.shadowBlur = 0;
    painted.push(row);
  });
  ctx.restore();
  // Logged from the rows that were actually PAINTED, not from the rows the
  // fitter proposed — a gate that reads the proposal cannot see a draw step that
  // chops the line on its way to the canvas, which is the exact symptom the
  // player reported.
  if (WORLD_TEXT_STATS.draws.length < DRAW_LOG_MAX) {
    WORLD_TEXT_STATS.draws.push({
      key: style.key || '', line: String(line).trim(), rows: painted,
      px, widthPx: wpx, limit,
      capFrac: (px * TEXT_ASCENT_EM) / h, inkFrac: (px * TEXT_BODY_EM) / h,
    });
  }
  return { rows: lay.rows, px, widthPx: wpx, limit, capPx: px * TEXT_ASCENT_EM, inkPx: px * TEXT_BODY_EM };
}

/* ══════════════════════════════════════════════════ roadside curriculum ══ */

// --- atlas geometry, stated once so a gate can re-derive a tile from a UV ----
//
// 2 x 8 = 16 tiles of capacity against SIGN_LINES = 12 authored lines, so a lap
// never shows the same line twice and the atlas has headroom. Tiles are 4:1
// (rows/cols) and the boards are built to the same aspect — see the note on
// aspect matching at the top of this file.
export const SIGN_COLS = 2;
export const SIGN_ROWS = 8;
/** Tile aspect (width / height) — the board's aspect must match it. */
export const SIGN_TILE_ASPECT = SIGN_ROWS / SIGN_COLS;
/** Longest line the boards are designed to set at full size. */
export const SIGN_MAX_CHARS = 14;
/**
 * HOW MANY LINES A TRACK AUTHORS — and, because placement is now tied to it,
 * how many boards the high tier puts on the ground.
 *
 * It used to be 16 against a 14-board lap, and placement walked the list in
 * order and stopped when it ran out of boards. So the last two lines of every
 * track were never placed at the high tier, the last six never at medium and
 * the last ten never at LOW — and the tail is exactly where the glossary echoes
 * and the payoff live (see the note on the curriculum below). Nothing tied the
 * two numbers together and nothing gated it.
 *
 * Now: the list length IS the board budget, the brief's 8-12 per track is met
 * with room, and a tier that can only carry M < SIGN_LINES boards SAMPLES the
 * list evenly instead of truncating it (trackbuild's `placeSignage`), so the
 * first line, a middle line and the payoff reach the ground on every tier.
 *
 * PER-TRACK, NOT UNIFORM (Wave 5 r3). These are the bounds, not a quota. Cloud
 * Peak authors TEN: its lesson is ten steps long and the two lines that padded
 * it to twelve were filler in the place its arc should tighten. A track writes
 * as many steps as it has; the gate checks the range and the shape, and no
 * track is asked to invent a step to match another track's count.
 */
export const SIGN_LINES_MIN = 8;
export const SIGN_LINES_MAX = 12;
/** @deprecated the old uniform count; it is the MAXIMUM, and the atlas budget. */
export const SIGN_LINES = SIGN_LINES_MAX;
/** D38's name for the layout height. Kept because progress.html speaks of it. */
export const SIGN_CAP_EM = TEXT_ASCENT_EM;

/**
 * THE CURRICULUM, IN THE ORDER A CHILD MEETS IT.
 *
 * `lines[i]` is the i-th step of a track's lesson, and the boards on the ground
 * carry the list IN ORDER along the lap (placeSignage assigns tiles in
 * increasing order from the start line, and tests/signage.test.mjs re-derives
 * that order from the built UV buffer). So the list is a sequence, not a bag:
 *
 *   * the first few boards are concrete and need no vocabulary at all;
 *   * the middle ones name the idea the track is about;
 *   * the last ones echo words the game has already taught elsewhere — the
 *     glossary terms in core/badges.js (טוקן, אימון, נתונים, נוירון, מודל שפה,
 *     ענן) and the quiz topics in race/quizdata.js — so a board is a reminder
 *     of something met, not a new word thrown at speed.
 *
 * `payoff` names the word the last board exists to land: it is a word the
 * GLOSSARY teaches, it appears on exactly one board — the last one, no track
 * shares it with another track — and the placement rule guarantees that board
 * reaches the ground on every quality tier. `opens` names the line the lesson
 * has to START on, and it exists for one reason: a gate that only knows the
 * payoff is last stays green when lines 0..N-2 are reversed or shuffled. Two
 * anchors, one at each end (D42: gate the property, name at most one string —
 * here two, and they are the two the curriculum comment actually claims).
 *
 * WHAT IS DELIBERATELY NOT GATED, so nobody reads more into a green run than is
 * there: the order of the lines BETWEEN the opener and the payoff. Nothing
 * mechanical can tell that 'שכבה על שכבה' belongs after 'רשת נוירונים' rather
 * than before it; that is an author's judgement and it is reviewed by reading.
 *
 * Every line is 2–3 words and <= SIGN_MAX_CHARS characters. That is optics, not
 * style: see the identity at the top of this file. All original copy; no real
 * companies, no quotations.
 *
 * House voice (D27/D41): plural address, gender-neutral, no imperatives, and no
 * term whose everyday sense a child would read instead of the AI one — which is
 * why there is no משקל here (kilograms), no שדה (grass), and no calque of an
 * English IT phrase (חלוקת עומס, כוח לפי דרישה) that means nothing at eight.
 */
export const TRACK_SIGNS = {
  // ── נווה הנתונים — data ───────────────────────────────────────────────────
  // concrete ("what is data") → how a collection is judged → the glossary words
  // נתונים / טוקן / אימון / מודל שפה.
  oasis: {
    skin: { bg: '#efdcb8', edge: '#c4402f', fg: '#38200f', lit: 0 },
    // PAYOFF WAS 'מודל שפה' — the same sentence circuit ends on. The payoff gate
    // checked uniqueness only WITHIN a track, so finishing Data Oasis and
    // finishing Neuron City rewarded a child with the identical line. Data
    // Oasis ends on אימון (glos.training.term) instead, which is what its own
    // twelve boards have been building towards: examples, cleaning, tokens, and
    // then what they are FOR.
    payoff: 'אימון',
    opens: 'נתונים זה מידע',
    lines: [
      'נתונים זה מידע', 'אוספים דוגמאות', 'תמונות ומילים', 'מספרים וטבלאות',
      // 'דפוס חוזר' -> 'תבנית חוזרת' (D41's rule): to an eight-year-old דפוס is
      // printing, as in בית דפוס, exactly the everyday-sense trap that got שדה
      // rejected.
      'דוגמה טובה', 'פחות טעויות', 'תבנית חוזרת', 'נתונים נקיים',
      'מאגר נתונים', 'אוספים טוקנים', 'מודל לומד', 'נתונים לאימון',
    ],
  },
  // ── עיר הנוירונים — neural networks ───────────────────────────────────────
  // one neuron → many → layers → what travels between them → how the thing
  // learns → the glossary words נוירון / מודל שפה.
  circuit: {
    skin: { bg: '#0d1236', edge: '#ff5fae', fg: '#8ff6ff', lit: 1.25 },
    payoff: 'מודל שפה',
    opens: 'נוירון קטן',
    lines: [
      'נוירון קטן', 'הרבה נוירונים', 'רשת נוירונים', 'שכבה על שכבה',
      'מספרים נכנסים', 'דולק או כבוי', 'אות עובר הלאה', 'שכבה נסתרת',
      'החיבור משתנה', 'טעות מלמדת', 'רשת עמוקה', 'זה מודל שפה',
    ],
  },
  // ── פסגת הענן — cloud computing ───────────────────────────────────────────
  // a far-away computer → many of them → what that buys you → the glossary word
  // ענן, and the fact its definition ends on: the big models run there.
  cloud: {
    // DARK board, light letters — the reverse of the other two. Cloud Peak is a
    // white plateau under a pale dawn sky, and an ivory-on-ivory board was
    // invisible as a SHAPE before it was ever unreadable as text.
    skin: { bg: '#2c3350', edge: '#ffc247', fg: '#f7f1e6', lit: 0.5 },
    payoff: 'מודלים',
    opens: 'מחשב במקום אחר',
    // TEN LINES, NOT TWELVE PADDED TO MATCH. oasis and circuit are real
    // progressions; cloud's lines 8-9 were filler between 'תשובה מהירה' and
    // 'אימון בענן' and broke the arc exactly where it should tighten. Both are
    // gone, and each was independently wrong: 'חיבור מאובטח' is jargon of
    // 'סף הפעלה's class and teaches network security, which is not this track's
    // subject; 'רשת עולמית' uses רשת in a sense that collides with the
    // רשת נוירונים / רשת עמוקה a child met one race earlier.
    lines: [
      'מחשב במקום אחר', 'ענן זה מחשבים', 'שרת רחוק', 'אלפי מחשבים',
      'מרכז נתונים', 'עבודה מתחלקת', 'זמין מכל מקום', 'תשובה מהירה',
      'אימון בענן', 'שם רצים מודלים',
    ],
  },
};

/**
 * Lay a sign line out on its tile. Kept as a named wrapper because D38's gate,
 * the placement code and progress.html all speak of `signLayout`.
 */
export function signLayout(line, aspect = SIGN_TILE_ASPECT) {
  return fitText(line, aspect);
}

/** UV rect of sign `i` in the sign atlas. */
export function signUV(i) {
  const N = SIGN_COLS * SIGN_ROWS;
  const k = ((i % N) + N) % N;
  const col = k % SIGN_COLS, row = (k / SIGN_COLS) | 0;
  const du = 1 / SIGN_COLS, dv = 1 / SIGN_ROWS;
  return [col * du, 1 - (row + 1) * dv, du, dv];
}

/** Which tile index a UV origin belongs to — the inverse of `signUV`. */
export function signTileIndex(u0, v0) {
  const col = Math.round(u0 * SIGN_COLS);
  const row = SIGN_ROWS - 1 - Math.round(v0 * SIGN_ROWS);
  return row * SIGN_COLS + col;
}

/* ═══════════════════════════════════════════════════ invented brand boards ══ */
//
// All-original invented identities for a fictional racing series. No real
// company, no real product, nothing that could be mistaken for one — and short,
// because a barrier board is 4.5 m of world and a name is read in a blink.

/**
 * Barrier sponsor boards. FOUR entries in a 1 x 4 atlas: one tile per canvas
 * row, so a tile is the FULL canvas width and has no horizontal neighbour to
 * bleed into at all. Tile aspect 4:1 = the board's 4.48 m x 1.12 m.
 */
export const BRAND_BOARDS = [
  { he: 'טורבו־בינה', bg: '#c4402f', fg: '#ffe9c4' },
  { he: 'ברק אנרגיה', bg: '#e0a52c', fg: '#3a2410' },
  { he: 'נחל נתונים', bg: '#2f5f34', fg: '#f2f6d8' },
  { he: 'אלגו־גיר', bg: '#1f6f78', fg: '#fdf3dd' },
];
export const BRAND_COLS = 1;
export const BRAND_ROWS = 4;
export const BRAND_TILE_ASPECT = BRAND_ROWS / BRAND_COLS;   // 4:1
/** Board size in metres. Its aspect IS the tile aspect — that is the rule. */
export const BRAND_BOARD_W = 4.48;
export const BRAND_BOARD_H = BRAND_BOARD_W / BRAND_TILE_ASPECT;   // 1.12

/**
 * Neon-city holo billboards. EIGHT entries in a 2 x 4 atlas: tile aspect 2:1 =
 * the billboard's 9.0 m x 4.5 m. Eight rather than four because the boards come
 * round every 62 m and the old four repeated three times a lap.
 */
export const HOLO_BOARDS = [
  { he: 'טורבו־בינה', fg: '#7ff2ff', bg: '#0a1030' },
  { he: 'מנוע פרומפט', fg: '#ff86d6', bg: '#160a2e' },
  { he: 'אלגו־גיר', fg: '#a8ff9c', bg: '#07172a' },
  { he: 'ברק אנרגיה', fg: '#ffd76a', bg: '#231032' },
  { he: 'נוירון־טק', fg: '#8ff6ff', bg: '#0d1236' },
  { he: 'דאטה־סיטי', fg: '#ffb36a', bg: '#1a0f26' },
  { he: 'ענן־אקספרס', fg: '#9fd0ff', bg: '#08142c' },
  { he: 'פיקסל־אור', fg: '#ff9ec4', bg: '#200a24' },
];
export const HOLO_COLS = 2;
export const HOLO_ROWS = 4;
export const HOLO_TILE_ASPECT = HOLO_ROWS / HOLO_COLS;      // 2:1
export const HOLO_BOARD_W = 9.0;
export const HOLO_BOARD_H = HOLO_BOARD_W / HOLO_TILE_ASPECT;  // 4.5

/** UV rect of tile `i` in a cols x rows atlas, row 0 at the TOP of the canvas. */
export function tileUV(i, cols, rows) {
  const N = cols * rows;
  const k = ((i % N) + N) % N;
  const col = k % cols, row = (k / cols) | 0;
  return [col / cols, 1 - (row + 1) / rows, 1 / cols, 1 / rows];
}

/** Pixel box of tile `i` on a square canvas of side S. */
export function tileBox(i, cols, rows, S) {
  const N = cols * rows;
  const k = ((i % N) + N) % N;
  const w = S / cols, h = S / rows;
  return { x: (k % cols) * w, y: ((k / cols) | 0) * h, w, h };
}

/** Every phrase this file authors, as one flat list — for gates and audits. */
export function allWorldPhrases() {
  const out = [];
  for (const [theme, set] of Object.entries(TRACK_SIGNS)) {
    set.lines.forEach((l, i) => out.push({ source: 'signage:' + theme, index: i, line: l }));
  }
  BRAND_BOARDS.forEach((b, i) => out.push({ source: 'boards', index: i, line: b.he }));
  HOLO_BOARDS.forEach((b, i) => out.push({ source: 'holo-signs', index: i, line: b.he }));
  return out;
}

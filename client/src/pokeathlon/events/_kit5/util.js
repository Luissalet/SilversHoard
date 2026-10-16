// Small helpers shared by the Pokéathlon events Disc Catch, Lamp Jump, Ring Drop, Snow Throw and Goal Roll.
// Nothing here touches the DOM: the simulations import it too, and they run headless (node tests, CPU-only runs).

export const W = 960;
export const H = 540;
/** The Nintendo DS game logic runs at 30 steps per second; every event steps at this rate whatever the display does. */
export const STEP = 1 / 30;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sq = (v) => v * v;
export const dist = (ax, ay, bx, by) => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
export const len = (x, y) => Math.sqrt(x * x + y * y);
export function norm(x, y) {
  const l = Math.sqrt(x * x + y * y);
  return l > 0 ? [x / l, y / l] : [0, 0];
}
/** C-style integer division (truncates toward zero). */
export const idiv = (a, b) => Math.trunc(a / b);

/** The game's LCRandom() % n and friends, on top of the seeded rng the framework hands over. */
export function makeRand(rng) {
  const int = (n) => (n > 0 ? Math.min(n - 1, Math.floor(rng() * n)) : 0);
  return {
    float: () => rng(),
    int,
    /** inclusive integer range */
    range: (a, b) => a + int(b - a + 1),
    /** true with probability p percent (LCRandom() % 100 < p) */
    pct: (p) => int(100) < p,
    pick: (arr) => arr[int(arr.length)],
  };
}

// ---- colours (team colours arrive as any css string) -------------------------------------------------------------------
const NAMED = { red: [230, 57, 70], blue: [58, 110, 220], green: [60, 170, 90], yellow: [240, 200, 50], orange: [240, 140, 40],
  purple: [150, 90, 200], pink: [240, 130, 180], white: [250, 250, 250], black: [20, 20, 20], gray: [140, 140, 140], grey: [140, 140, 140],
  cyan: [60, 200, 220], teal: [40, 160, 160] };

export function parseColor(css) {
  const s = String(css || "").trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(s);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[ ,]+([\d.]+)%[ ,]+([\d.]+)%/.exec(s);
  if (m) {
    const h = (+m[1] % 360) / 360, sa = +m[2] / 100, l = +m[3] / 100;
    const q = l < 0.5 ? l * (1 + sa) : l + sa - l * sa, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
  }
  return NAMED[s] || [136, 136, 150];
}

/** amount in -1..1: toward black (negative) or white (positive) */
export function shade(css, amount) {
  const c = parseColor(css);
  const t = amount < 0 ? 0 : 255, a = Math.abs(amount);
  return `rgb(${c.map((v) => Math.round(v + (t - v) * a)).join(",")})`;
}
export function rgba(css, alpha) {
  const c = parseColor(css);
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
/** black or white, whichever reads on the colour */
export function inkOn(css) {
  const c = parseColor(css);
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 150 ? "#14161c" : "#ffffff";
}

export const easeOutBack = (t) => { const c = 1.70158; t = clamp(t, 0, 1) - 1; return 1 + (c + 1) * t * t * t + c * t * t; };
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/** Never let an optional ctx hook (sound, icons) break an event. */
export function safe(fn, ...args) {
  try { return typeof fn === "function" ? fn(...args) : undefined; } catch { return undefined; }
}

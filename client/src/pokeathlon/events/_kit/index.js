// Small helpers the Pokéathlon events of this half share: the fixed 30 fps step with edge latching (a click that lands between two
// steps is not lost), geometry and a few drawing bits. Nothing here touches the DOM, so every event can be simulated from node.

export const FPS = 30;
export const STEP = 1 / FPS;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => 1 - (1 - clamp(t, 0, 1)) * (1 - clamp(t, 0, 1));
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const stat = (mon, key) => clamp((Number(mon.stars && mon.stars[key]) || 1) - 1, 0, 4); // raw 0..4 = stars - 1

/** The simulation clock: update(dt) from the screen at any rate becomes whole 1/30 s steps. */
export class Clock {
  constructor() { this.acc = 0; this.frame = 0; this.alpha = 0; }
  advance(dt, step) {
    this.acc += Math.min(Math.max(dt, 0), 0.1);
    let n = 0;
    while (this.acc >= STEP - 1e-9 && n < 6) {
      this.acc -= STEP;
      n++;
      this.frame++;
      step(this.frame);
    }
    if (n === 6) this.acc = 0;
    this.alpha = Math.min(1, Math.max(0, this.acc / STEP));
  }
}

/**
 * What the person did since the last simulation step: absorb(input) every update() call, take() at each step. Presses and releases
 * keep their position; keys and pad buttons are the ones pressed (edges), `held` is read straight from the input when needed.
 */
export class Latch {
  constructor() { this.clear(); }
  clear() {
    this.presses = [];
    this.releases = [];
    this.keys = new Set();
    this.pad = new Set();
    this.path = [];
    this.flick = null;
    this.right = false;
    this.wheel = 0;
  }
  absorb(input) {
    const p = input.pointer;
    if (p.pressed) this.presses.push({ x: p.x, y: p.y });
    if (p.released) { this.releases.push({ x: p.x, y: p.y }); if (p.flick) this.flick = p.flick; }
    if (p.path && p.path.length) for (const q of p.path) this.path.push(q);
    if (p.rightPressed) this.right = true;
    if (p.wheel) this.wheel += p.wheel;
    for (const k of input.pressed) this.keys.add(k);
    for (const b of input.pad.pressed) this.pad.add(b);
  }
  take() {
    const out = { presses: this.presses, releases: this.releases, keys: this.keys, pad: this.pad, path: this.path, flick: this.flick, right: this.right, wheel: this.wheel };
    this.clear();
    return out;
  }
}

/** Keys that mean "lane / slot n" (0, 1, 2): 1 2 3 and A S D, numpad too. */
export const SLOT_KEYS = [["Digit1", "KeyA", "Numpad1"], ["Digit2", "KeyS", "Numpad2"], ["Digit3", "KeyD", "Numpad3"]];
export const slotOfKey = (code) => SLOT_KEYS.findIndex((list) => list.includes(code));

/** Draws a rounded checkered flag band (finish lines). */
export function checker(g, x, y, w, h, cell = 10) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  for (let r = 0; r * cell < h + cell; r++) {
    for (let c = 0; c * cell < w + cell; c++) {
      g.fillStyle = (r + c) % 2 ? "#fff" : "#1b2233";
      g.fillRect(x + c * cell, y + r * cell, cell, cell);
    }
  }
  g.restore();
}

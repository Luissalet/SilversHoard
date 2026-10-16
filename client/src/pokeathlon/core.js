// The Pokéathlon runtime without a screen: the seeded random numbers, the unified input (mouse, touch, keyboard, gamepad), the ctx
// every event module receives (see the event contract) and a headless runner the tests use. Nothing in here touches the DOM, so the
// events can be played from node with a scripted input.
import { makeUi } from "./draw.js";

export const W = 960;
export const H = 540;
export const FPS = 30;
export const STEP = 1 / FPS;

export const TEAM_COLORS = ["#e5483d", "#3b82e6", "#35b25c", "#f0b429"];
export const TEAM_COLORS_DARK = ["#9c2a22", "#1f56a8", "#1f7a3c", "#b0820f"];

/** A small seeded generator (mulberry32): the only source of randomness an event may use. */
export function makeRng(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit seed out of any numbers or strings. */
export function hashSeed(...parts) {
  let h = 2166136261;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Everything the person does, in one place. The DOM (or a test) feeds it with pointerDown / pointerMove / pointerUp / keyDown /
 * keyUp / setPad; the runner calls frame() once before each update, and the events read the public fields: `pointer`, `keys`,
 * `pressed`, `pad`. Edges (pressed, released, path, flick) last for exactly one frame, taps between two frames are never lost.
 */
export class Input {
  constructor() {
    this.pointer = { x: W / 2, y: H / 2, down: false, pressed: false, released: false, path: [], flick: null, rightPressed: false, wheel: 0, inside: false };
    this.keys = new Set();
    this.pressed = new Set();
    this.pad = { lx: 0, ly: 0, rx: 0, ry: 0, held: new Set(), pressed: new Set() };
    this.any = false; // something was pressed this frame (to wake up a paused screen)
    this._p = { x: W / 2, y: H / 2, down: false, pressed: false, released: false, path: [], trail: [], flick: null, rightPressed: false, wheel: 0, inside: false };
    this._keys = new Set();
    this._kp = new Set();
    this._pad = { lx: 0, ly: 0, rx: 0, ry: 0, held: new Set() };
    this._padPrev = new Set();
    this._padPressed = new Set();
  }

  pointerDown(x, y, t = now(), button = 0) {
    const p = this._p;
    p.x = x; p.y = y; p.inside = true;
    if (button === 2) { p.rightPressed = true; return; }
    p.down = true;
    p.pressed = true;
    p.path.push({ x, y, t });
    p.trail = [{ x, y, t }];
  }

  pointerMove(x, y, t = now()) {
    const p = this._p;
    p.x = x; p.y = y; p.inside = true;
    p.path.push({ x, y, t });
    if (p.down) {
      p.trail.push({ x, y, t });
      if (p.trail.length > 24) p.trail.shift();
    }
  }

  pointerUp(x, y, t = now()) {
    const p = this._p;
    p.x = x; p.y = y;
    if (!p.down) return;
    p.down = false;
    p.released = true;
    p.path.push({ x, y, t });
    p.trail.push({ x, y, t });
    // the flick: how far the pointer moved over the last ~120 ms before letting go
    let from = p.trail[0];
    for (const q of p.trail) if (t - q.t <= 120) { from = q; break; }
    const dx = x - from.x;
    const dy = y - from.y;
    const dt = Math.max(16, t - from.t);
    p.flick = { dx, dy, speed: (Math.hypot(dx, dy) / dt) * 1000 };
  }

  pointerLeave() { this._p.inside = false; }
  wheel(delta) { this._p.wheel += delta; }

  keyDown(code) {
    if (!this._keys.has(code)) this._kp.add(code);
    this._keys.add(code);
  }

  keyUp(code) { this._keys.delete(code); }

  /** A gamepad snapshot: sticks -1..1 and the set of held button indexes. */
  setPad(lx, ly, rx, ry, held) {
    this._pad.lx = lx; this._pad.ly = ly; this._pad.rx = rx; this._pad.ry = ry;
    this._pad.held = held || new Set();
    for (const b of this._pad.held) if (!this._padPrev.has(b)) this._padPressed.add(b);
    this._padPrev = new Set(this._pad.held);
  }

  releaseAll() {
    this._keys.clear();
    this._kp.clear();
    this._p.down = false;
    this._p.trail = [];
    this._pad.held = new Set();
    this._padPrev = new Set();
    this._padPressed.clear();
  }

  /** Publish what happened since the last frame. */
  frame() {
    const p = this._p;
    const o = this.pointer;
    o.x = p.x; o.y = p.y; o.down = p.down; o.pressed = p.pressed; o.released = p.released;
    o.path = p.path; o.flick = p.flick; o.rightPressed = p.rightPressed; o.wheel = p.wheel; o.inside = p.inside;
    p.pressed = false; p.released = false; p.path = []; p.flick = null; p.rightPressed = false; p.wheel = 0;
    this.keys.clear();
    for (const k of this._keys) this.keys.add(k);
    this.pressed.clear();
    for (const k of this._kp) this.pressed.add(k);
    this._kp.clear();
    const d = this.pad;
    d.lx = this._pad.lx; d.ly = this._pad.ly; d.rx = this._pad.rx; d.ry = this._pad.ry;
    d.held.clear();
    for (const b of this._pad.held) d.held.add(b);
    d.pressed.clear();
    for (const b of this._padPressed) d.pressed.add(b);
    this._padPressed.clear();
    this.any = o.pressed || o.rightPressed || this.pressed.size > 0 || d.pressed.size > 0;
  }
}

/** An animator that does nothing (headless runs, sprites that never loaded): every call is safe and draw() says "not drawn". */
export function nullAnimator() {
  return {
    meta: null, cur: "Idle", loopName: "Idle", frame: 0, speed: 1, done: true,
    has() { return false; }, name(a) { return a; }, loop() {}, play() {}, busy() { return false; }, update() {}, draw() { return false; },
    height() { return 30; },
  };
}

/** The result an event hands to finish(), cleaned: four numbers and four detail objects. */
export function cleanResult(r) {
  const raw = [0, 1, 2, 3].map((i) => {
    const v = Number(r && r.raw ? r.raw[i] : 0);
    return Number.isFinite(v) ? v : 0;
  });
  const detail = [0, 1, 2, 3].map((i) => (r && r.detail && r.detail[i] && typeof r.detail[i] === "object" ? r.detail[i] : {}));
  return { raw, detail };
}

/**
 * The ctx of the contract. `parts` brings what only the screen can give: animator(team, slot), icon(team, slot), sfx(name).
 * Besides the contract it carries `ui` (drawing helpers), `mode` ("play" | "watch" | "practice"), `supreme`, `seed` and `focus`
 * (the team the camera follows: the first human one, else team 0).
 */
export function makeCtx({ teams, seed = 1, lang = "es", input = new Input(), animator, icon, sfx, finish, mode = "play", supreme = false }) {
  const rng = makeRng(seed);
  const cache = new Map();
  const nulls = new Map();
  const ctx = {
    W, H, teams, rng, input, lang, mode, supreme, seed,
    focus: Math.max(0, teams.findIndex((t) => t.human)),
    t: (es, en) => (lang === "en" ? en : es),
    animator(team, slot) {
      const key = team * 3 + slot;
      if (animator) {
        if (!cache.has(key)) cache.set(key, animator(team, slot) || nullAnimator());
        return cache.get(key);
      }
      if (!nulls.has(key)) nulls.set(key, nullAnimator());
      return nulls.get(key);
    },
    icon(team, slot) { return icon ? icon(team, slot) : null; },
    sfx(name, opts) { if (sfx) { try { sfx(name, opts); } catch { /* sound is decoration */ } } },
    finished: false,
    result: null,
    finishCalls: 0,
    finish(r) {
      ctx.finishCalls++;
      if (ctx.finished) return;
      ctx.finished = true;
      ctx.result = cleanResult(r);
      if (finish) finish(ctx.result);
    },
  };
  ctx.ui = makeUi(ctx);
  return ctx;
}

/**
 * Play an event with no screen. `script(frame, input, ctx, inst)` may press things; the loop updates at `step` seconds until the
 * event finishes (or `maxSeconds` pass), then keeps updating a second more to check that finish() is not called twice.
 */
export function runHeadless(mod, { teams, seed = 1, lang = "es", script = null, maxSeconds = 600, step = 1 / 60, mode = "watch", supreme = false } = {}) {
  const input = new Input();
  const ctx = makeCtx({ teams, seed, lang, input, mode, supreme });
  const inst = mod.create(ctx);
  let frame = 0;
  const limit = Math.ceil(maxSeconds / step);
  while (!ctx.finished && frame < limit) {
    if (script) script(frame, input, ctx, inst);
    input.frame();
    inst.update(Math.min(step, 1 / 20));
    frame++;
  }
  const endFrame = frame;
  for (let i = 0; i < Math.ceil(1 / step); i++) {
    input.frame();
    inst.update(Math.min(step, 1 / 20));
  }
  if (inst.destroy) inst.destroy();
  return { result: ctx.result, finished: ctx.finished, finishCalls: ctx.finishCalls, frames: endFrame, seconds: endFrame * step, ctx };
}

// Plays Pokémon Showdown's battle animations (anims.gen.js: 934 moves, the status and the shared "other" animations) on the turn-based
// screen. A port of the scene half of Showdown's battle-animations.ts (MIT, Guangcong Luo and contributors): showEffect, animateEffect,
// backgroundEffect, wait, the pos/posT position maths with its easing curves, and the sprite moves (anim, delay, behind, leftof).
//
// Showdown animates <img> tags with jQuery on a fixed 640×360 stage. Here each effect becomes a list of timed segments painted on a
// canvas, the background flashes go on the canvas under the Pokémon, and the Pokémon themselves move through a callback (the stage turns
// it into a CSS transform on the sprite). Showdown's stage is mapped onto wherever Silver's arena draws its sprites: z = 0 is the near
// side, z = 200 the far side, and one Showdown pixel is `k` screen pixels, k taken from the distance between the two sides.
//
// No DOM here: the stage hands in centres and callbacks, so every animation can run in Node for the tests.
import { BattleEffects, BattleMoveAnims, BattleOtherAnims, BattleStatusAnims } from "./anims.gen.js";
import { fxUrl } from "./url.js";

export { SHOWDOWN, fxUrl } from "./url.js";

/** jQuery's easing curves as Showdown extends them. */
export const EASE = {
  linear: (x) => x,
  swing: (x) => 0.5 - Math.cos(x * Math.PI) / 2,
  ballisticUp: (x) => -3 * x * x + 4 * x,
  ballisticDown: (x) => { const y = 1 - x; return 1 - (-3 * y * y + 4 * y); },
  quadUp: (x) => { const y = 1 - x; return 1 - y * y; },
  quadDown: (x) => x * x,
};
const PROPS = ["left", "top", "width", "height", "opacity"];
const SHOWDOWN_SPAN = Math.hypot(410 - 210, 135 - 245);   // the distance between the two sides on Showdown's stage, in its pixels

/** True when Showdown has an animation of its own for this move id (otherwise it would play Tackle's). */
export const hasMoveAnim = (id) => !!(id && Object.prototype.hasOwnProperty.call(BattleMoveAnims, id));
export const hasStatusAnim = (id) => !!(id && Object.prototype.hasOwnProperty.call(BattleStatusAnims, id));
export const moveAnimCount = () => Object.keys(BattleMoveAnims).length;


/** A CSS background as Showdown's animations write them: a colour, a vertical linear-gradient(...) or url('...'). */
export function parseBackground(bg) {
  const s = String(bg || "").trim();
  const url = s.match(/^url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  if (url) return { kind: "image", src: url[1] };
  const grad = s.match(/^linear-gradient\((.*)\)$/i);
  if (grad) {
    const parts = grad[1].split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean);
    const stops = parts.map((p) => {
      const m = p.match(/^(.*?)\s+(-?[\d.]+)%$/);
      return m ? { color: m[1].trim(), at: Number(m[2]) / 100 } : { color: p, at: null };
    });
    // stops without a position spread evenly between their neighbours, as CSS does
    if (stops.length && stops[0].at == null) stops[0].at = 0;
    if (stops.length && stops[stops.length - 1].at == null) stops[stops.length - 1].at = 1;
    for (let i = 1; i < stops.length - 1; i++) {
      if (stops[i].at != null) continue;
      let j = i;
      while (stops[j].at == null) j++;
      const a = stops[i - 1].at, b = stops[j].at;
      for (let q = i; q < j; q++) stops[q].at = a + ((b - a) * (q - i + 1)) / (j - i + 1);
    }
    return { kind: "gradient", stops: stops.map((x) => ({ color: x.color, at: Math.max(0, Math.min(1, x.at)) })) };
  }
  return { kind: "color", color: s || "#000" };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** The easing of each property for a transition name, as posT builds it (`up`: the end is higher on screen than `old`). */
export function easingFor(transition, { endTop, oldTop, endZ }) {
  const m = { left: "linear", top: "linear", width: "linear", height: "linear", opacity: "linear" };
  const up = endTop < oldTop;
  if (transition === "ballistic") m.top = up ? "ballisticUp" : "ballisticDown";
  else if (transition === "ballisticUnder") m.top = up ? "ballisticDown" : "ballisticUp";
  else if (transition === "ballistic2") m.top = up ? "quadUp" : "quadDown";
  else if (transition === "ballistic2Back") m.top = endZ > 0 ? "quadUp" : "quadDown";
  else if (transition === "ballistic2Under") m.top = up ? "quadDown" : "quadUp";
  else if (transition === "swing") m.left = m.top = m.width = m.height = "swing";
  else if (transition === "accel") m.left = m.top = m.width = m.height = "quadDown";
  else if (transition === "decel") m.left = m.top = m.width = m.height = "quadUp";
  return m;
}

function lerpRect(a, b, p, ease) {
  const out = {};
  for (const k of PROPS) out[k] = a[k] + (b[k] - a[k]) * EASE[ease[k]](p);
  return out;
}

/** The state of a list of segments at time t (ms): null before the first one starts. */
function stateAt(segs, t) {
  if (!segs.length || t < segs[0].t0) return null;
  let seg = segs[0];
  for (const s of segs) {
    if (s.t0 <= t) seg = s;
    else break;
  }
  if (t >= seg.t1 || seg.t1 <= seg.t0) return seg.b;
  return lerpRect(seg.a, seg.b, (t - seg.t0) / (seg.t1 - seg.t0), seg.ease);
}

/**
 * A Pokémon as Showdown's animations see it: its place on Showdown's stage (x, y, z), the helpers they use, and a queue of moves.
 * `apply(rect | null)` receives where its picture should be drawn now (null: back at rest).
 */
class SpriteProxy {
  constructor(scene, { x, y, z, isFront, sp, apply, virtual = false }) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.z = z;
    this.isFrontSprite = isFront;
    this.sp = sp;
    this.apply = apply || null;
    this.virtual = virtual;
    this.segs = [];
    this.qEnd = 0;
    this.last = { x, y, z, scale: 1, opacity: virtual ? 0 : 1 };
    this.rest = scene.pos({ x, y, z }, sp);
  }

  behindx(offset) { return this.x + (this.isFrontSprite ? 1 : -1) * offset; }
  behindy(offset) { return this.y + (this.isFrontSprite ? -1 : 1) * offset; }
  leftof(offset) { return this.x + (this.isFrontSprite ? 1 : -1) * offset; }
  behind(offset) { return this.z + (this.isFrontSprite ? 1 : -1) * offset; }

  delay(time) {
    this.qEnd += Math.max(0, Number(time) || 0);
    return this;
  }

  anim(end, transition) {
    const e = { x: this.x, y: this.y, z: this.z, scale: 1, opacity: 1, time: 500, ...end };
    const a = this.segs.length ? this.segs[this.segs.length - 1].b : this.scene.pos(this.last, this.sp);
    const b = this.scene.pos(e, this.sp);
    const time = Math.max(0, Number(e.time) || 0);
    const ease = easingFor(transition, { endTop: b.top, oldTop: this.rest.top, endZ: e.z });
    this.segs.push({ t0: this.qEnd, t1: this.qEnd + time, a, b, ease });
    this.qEnd += time;
    this.last = e;
    return this;
  }

  /** Where the picture is at time t (ms), or null when nothing moves it. */
  at(t) {
    return this.segs.length ? stateAt(this.segs, t) : null;
  }
}

/**
 * One animation being played: the scene object Showdown's animation functions receive. `space` maps Showdown's stage to the screen:
 * {near: {x, y}, far: {x, y}, k} in CSS pixels (near is z = 0, far z = 200).
 */
export class PsScene {
  constructor({ space, images = null, resolve = (p) => fxUrl(p, { local: false }) }) {
    this.space = space;
    this.images = images;           // (src) => image or null (the stage's loader); none in tests
    this.resolve = resolve;
    this.timeOffset = 0;
    this.effects = [];
    this.backgrounds = [];
    this.sprites = [];
    this.battle = { mySide: { x: 0, y: 0, z: 0 } };
    this.animating = true;
    this.acceleration = 1;
    // Earthquake and its kin shake Showdown's backdrop with scene.$bg.animate({top, bottom}, ms): kept as a list of vertical offsets
    this.quake = [];
    let q = 0;
    const quake = this.quake;
    this.$bg = {
      animate(props, ms) {
        const d = Math.max(0, Number(ms) || 0);
        const top = Number(props && props.top);
        quake.push({ t0: q, t1: q + d, dy: Number.isFinite(top) ? top + 90 : 0 });
        q += d;
        return this;
      },
      delay(ms) { q += Math.max(0, Number(ms) || 0); return this; },
      css() { return this; },
      stop() { return this; },
    };
  }

  /** How far the backdrop is shaken at time t (ms), in CSS pixels (0 when nothing shakes it). */
  quakeAt(t) {
    let prev = 0;
    for (const s of this.quake) {
      if (t < s.t0) break;
      if (t <= s.t1) return (prev + (s.dy - prev) * (s.t1 > s.t0 ? (t - s.t0) / (s.t1 - s.t0) : 1)) * this.space.k;
      prev = s.dy;
    }
    return 0;
  }

  // ------------------------------------------------------------ positions
  /** Showdown's pos(): a location (x, y, z, scale, xscale, yscale, opacity) → the picture's rect on the screen, in CSS pixels. */
  pos(loc, obj) {
    const l = { x: 0, y: 0, z: 0, scale: 1, opacity: 1, ...loc };
    if (!l.xscale && l.xscale !== 0) l.xscale = l.scale;
    if (!l.yscale && l.yscale !== 0) l.yscale = l.scale;
    const o = obj || { w: 0, h: 0 };
    let scale = o.gen === 5 ? 2.0 - l.z / 200 : 1.5 - 0.5 * (l.z / 200);
    if (scale < 0.1) scale = 0.1;
    const { near, far, k } = this.space;
    const f = l.z / 200;
    const cx = near.x + (far.x - near.x) * f + l.x * scale * k;
    const cy = near.y + (far.y - near.y) * f - l.y * scale * k;
    const width = (o.w || 0) * scale * l.xscale * k;
    const height = (o.h || 0) * scale * l.yscale * k;
    const hoffset = ((o.h || 0) - (o.y || 0) * 2) * scale * l.yscale * k;
    return { left: cx - width / 2, top: cy - hoffset / 2, width, height, opacity: l.opacity };
  }

  /** Inverse for the sprites: the Showdown x, y that put a picture's centre at screen point c, at depth z. */
  locate(c, z) {
    const { near, far, k } = this.space;
    const f = z / 200;
    const scale = 1.5 - 0.5 * f;
    return { x: (c.x - (near.x + (far.x - near.x) * f)) / (scale * k), y: -(c.y - (near.y + (far.y - near.y) * f)) / (scale * k) };
  }

  /**
   * A participant: {center: {x, y}, near: bool, sp: {url, w, h}, apply}. Its x, y are worked out so Showdown's stage puts it exactly where
   * the arena draws it (so doubles and odd layouts line up).
   */
  sprite({ center, near, sp, apply }) {
    const z = near ? 0 : 200;
    const { x, y } = this.locate(center, z);
    const s = new SpriteProxy(this, { x, y, z, isFront: !near, sp: sp || { w: 96, h: 96, url: "" }, apply });
    this.sprites.push(s);
    return s;
  }

  /** Showdown's stand-in for a missed target: off to the side and invisible. */
  missed(of) {
    const s = new SpriteProxy(this, { x: of.leftof(-100), y: of.y, z: of.behind(10), isFront: of.isFrontSprite, sp: of.sp, virtual: true });
    this.sprites.push(s);
    return s;
  }

  // ------------------------------------------------------------ the API the animations call
  wait(time) {
    this.timeOffset += Math.max(0, Number(time) || 0);
  }

  showEffect(effect, start, end, transition, after) {
    const sp = typeof effect === "string" ? BattleEffects[effect] : effect;
    const h = { sp: sp || { w: 0, h: 0 }, segs: [], src: sp && sp.url ? sp.url : "" };
    this.effects.push(h);
    return this.animateEffect(h, sp, start, end, transition, after);
  }

  animateEffect(h, effect, start0, end0, transition, after) {
    const sp = (typeof effect === "string" ? BattleEffects[effect] : effect) || h.sp;
    const start = { ...(start0 || {}) };
    let end = { ...(end0 || {}) };
    if (!start.time) start.time = 0;
    if (!end.time) end.time = start.time + 500;
    start.time += this.timeOffset;
    end.time += this.timeOffset;
    if (!end.scale && end.scale !== 0 && start.scale) end.scale = start.scale;
    if (!end.xscale && end.xscale !== 0 && start.xscale) end.xscale = start.xscale;
    if (!end.yscale && end.yscale !== 0 && start.yscale) end.yscale = start.yscale;
    end = { ...start, ...end };
    const a = this.pos(start, sp);
    const b = this.pos(end, sp);
    const ease = easingFor(transition, { endTop: b.top, oldTop: a.top, endZ: end.z || 0 });
    // a second animateEffect on the same picture queues after the first one (jQuery's queue), its start time counted from there
    const prev = h.segs.length ? h.segs[h.segs.length - 1].t1 : 0;
    const t0 = h.segs.length ? prev + Math.max(0, start.time - this.timeOffset) : start.time;
    const t1 = t0 + Math.max(0, end.time - start.time);
    h.segs.push({ t0, t1, a, b, ease });
    let tail = t1;
    if (after === "fade") {
      h.segs.push({ t0: tail, t1: tail + 100, a: b, b: { ...b, opacity: 0 }, ease: easingFor("linear", { endTop: 0, oldTop: 0, endZ: 0 }) });
      tail += 100;
    } else if (after === "explode") {
      const big = { ...end, opacity: 0 };
      if (big.scale) big.scale *= 3;
      if (big.xscale) big.xscale *= 3;
      if (big.yscale) big.yscale *= 3;
      h.segs.push({ t0: tail, t1: tail + 200, a: b, b: this.pos(big, sp), ease: easingFor("linear", { endTop: 0, oldTop: 0, endZ: 0 }) });
      tail += 200;
    }
    return h;
  }

  backgroundEffect(bg, duration, opacity = 1, delay = 0) {
    const d = Math.max(0, Number(delay) || 0), dur = Math.max(250, Number(duration) || 0);
    this.backgrounds.push({ bg: parseBackground(bg), t0: d, t1: d + 250, t2: d + dur, t3: d + dur + 250, opacity: clamp01(Number(opacity) || 0) });
  }

  // ------------------------------------------------------------ timing
  /** When everything this animation started has finished, in ms. */
  duration() {
    let end = this.timeOffset;
    for (const e of this.effects) if (e.segs.length) end = Math.max(end, e.segs[e.segs.length - 1].t1);
    for (const b of this.backgrounds) end = Math.max(end, b.t3);
    for (const s of this.sprites) end = Math.max(end, s.qEnd);
    if (this.quake.length) end = Math.max(end, this.quake[this.quake.length - 1].t1);
    return end;
  }

  /** Moves the participants' pictures to where they are at time t (ms). */
  applySprites(t) {
    for (const s of this.sprites) if (s.apply) s.apply(s.at(t), s.rest);
  }

  /** Paints the animation at time t (ms): background flashes on `under`, effect pictures on `over`; both contexts in device pixels. */
  draw(t, ctxU, ctxO, { w, h, dpr = 1 }) {
    for (const b of this.backgrounds) {
      if (t < b.t0 || t > b.t3) continue;
      const a = t < b.t1 ? (t - b.t0) / 250 : t <= b.t2 ? 1 : 1 - (t - b.t2) / 250;
      const alpha = clamp01(a) * b.opacity;
      if (alpha <= 0.001) continue;
      ctxU.save();
      ctxU.globalAlpha = alpha;
      if (b.bg.kind === "color") {
        ctxU.fillStyle = b.bg.color;
        ctxU.fillRect(0, 0, w * dpr, h * dpr);
      } else if (b.bg.kind === "gradient") {
        const g = ctxU.createLinearGradient(0, 0, 0, h * dpr);
        for (const s of b.bg.stops) { try { g.addColorStop(s.at, s.color); } catch { /* an odd colour: skipped */ } }
        ctxU.fillStyle = g;
        ctxU.fillRect(0, 0, w * dpr, h * dpr);
      } else if (b.bg.kind === "image" && this.images) {
        const img = this.images(this.resolve(b.bg.src));
        if (img) {
          const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
          const sc = Math.max((w * dpr) / iw, (h * dpr) / ih);
          ctxU.drawImage(img, (w * dpr - iw * sc) / 2, (h * dpr - ih * sc) / 2, iw * sc, ih * sc);
        }
      }
      ctxU.restore();
    }
    if (!this.images) return;
    for (const e of this.effects) {
      if (!e.src) continue;
      const r = stateAt(e.segs, t);
      if (!r || r.opacity <= 0.001 || r.width <= 0.5 || r.height <= 0.5) continue;
      const img = this.images(this.resolve(e.src));
      if (!img) continue;
      ctxO.globalAlpha = clamp01(r.opacity);
      ctxO.drawImage(img, r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr);
    }
    ctxO.globalAlpha = 1;
  }

  /** Every picture name the animation will draw (to load them before it starts). */
  sources() {
    const out = new Set();
    for (const e of this.effects) if (e.src) out.add(this.resolve(e.src));
    for (const b of this.backgrounds) if (b.bg.kind === "image") out.add(this.resolve(b.bg.src));
    return [...out];
  }
}

/** The participants Showdown's move animations expect: [attacker, defender] (the defender is the attacker for self moves). */
function participants(scene, { attacker, defender, miss }) {
  const a = scene.sprite(attacker);
  let d = defender && defender !== attacker ? scene.sprite(defender) : a;
  if (miss && d !== a) d = scene.missed(d);
  return [a, d];
}

/**
 * Builds the animation of a move: `attacker` / `defender` are {center, near, sp, apply}. Returns the scene (with its duration()), or
 * null when Showdown has no animation for that move or the animation throws.
 */
export function buildMove(move, { space, attacker, defender = null, miss = false, images = null, resolve, fallback = false }) {
  const entry = hasMoveAnim(move) ? BattleMoveAnims[move] : fallback ? BattleMoveAnims.tackle : null;
  if (!entry) return null;
  const scene = new PsScene({ space, images, resolve });
  try {
    entry.anim(scene, participants(scene, { attacker, defender, miss }));
  } catch {
    return null;
  }
  return scene;
}

/** The animation of a status (brn, psn, slp, par, frz, confused, attracted, cursed, flinch…) on one Pokémon, or null. */
export function buildStatus(status, { space, target, images = null, resolve }) {
  if (!hasStatusAnim(status)) return null;
  const scene = new PsScene({ space, images, resolve });
  try {
    BattleStatusAnims[status].anim(scene, [scene.sprite(target)]);
  } catch {
    return null;
  }
  return scene;
}

/** One of the shared animations (megaevo, zpower, shiny, heal, drain…) on [attacker, defender], or null. */
export function buildOther(name, { space, attacker, defender = null, images = null, resolve }) {
  if (!Object.prototype.hasOwnProperty.call(BattleOtherAnims, name)) return null;
  const scene = new PsScene({ space, images, resolve });
  try {
    BattleOtherAnims[name].anim(scene, participants(scene, { attacker, defender }));
  } catch {
    return null;
  }
  return scene;
}

/** The effect pictures Showdown's tables name (to warm the cache). */
export function effectFiles() {
  return Object.values(BattleEffects).map((e) => e.url).filter(Boolean);
}

/**
 * The mapping from Showdown's stage to the screen, from the centres of the near-side and far-side Pokémon. When one side is missing,
 * Showdown's own proportions are used around the other, scaled to the arena's width.
 */
export function spaceFrom({ near, far, width }) {
  const k0 = Math.max(0.3, (width || 640) / 640);
  if (near && far) {
    const d = Math.hypot(far.x - near.x, far.y - near.y);
    if (d > 20) return { near, far, k: d / SHOWDOWN_SPAN };
  }
  if (near) return { near, far: { x: near.x + 200 * k0, y: near.y - 110 * k0 }, k: k0 };
  if (far) return { near: { x: far.x - 200 * k0, y: far.y + 110 * k0 }, far, k: k0 };
  return { near: { x: 210 * k0, y: 245 * k0 }, far: { x: 410 * k0, y: 135 * k0 }, k: k0 };
}

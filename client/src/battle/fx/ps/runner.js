// The browser side of Showdown's animations on the turn-based screen: finds the sprites the arena draws (data-fx-pos), measures where
// they are, loads the effect pictures, builds the animation with scene.js and, while it plays, moves the sprites with CSS transforms.
// The effect stage (../stage.js) drives it from its own clock and paints it on its two canvases.
import { buildMove, buildStatus, effectFiles, fxUrl, hasMoveAnim, hasStatusAnim, spaceFrom } from "./scene.js";

export class PsRunner {
  /** host: the arena element holding the sprites. */
  constructor(host) {
    this.host = host;
    // the friends' playable page has no app behind it: pictures come straight from Showdown there
    this.local = typeof document === "undefined" || !document.getElementById("silver-data");
    this.resolve = (p) => fxUrl(p, { local: this.local });
    this.cache = new Map();
    this.images = (src) => this.image(src);
    this.scene = null;
    this.t = 0;
    this.total = 0;
    this.moved = [];
    for (const f of effectFiles()) this.image(this.resolve(f));
  }

  image(src) {
    if (!src) return null;
    let rec = this.cache.get(src);
    if (!rec) {
      rec = { img: null, ok: false };
      if (typeof Image !== "undefined") {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => { rec.ok = true; };
        img.onerror = () => { rec.ok = false; };
        img.src = src;
        rec.img = img;
      }
      this.cache.set(src, rec);
    }
    return rec.ok ? rec.img : null;
  }

  has(move) { return hasMoveAnim(move); }
  hasStatus(status) { return hasStatusAnim(status); }

  /** The Pokémon at side + slot as scene.js wants it, or null when it is not on the screen. */
  who(side, slot) {
    const box = this.host.querySelector(`[data-fx-pos="${side}${slot}"]`);
    if (!box || box.classList.contains("is-fainted")) return null;
    const img = box.querySelector("img");
    const wrap = box.querySelector(".b-sprite-img") || box;
    const target = img || wrap;
    const r = target.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const h = this.host.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const center = { x: r.left - h.left + r.width / 2, y: r.top - h.top + r.height / 2 };
    const near = box.classList.contains("is-back");
    const sp = img ? { url: img.currentSrc || img.src, w: img.naturalWidth || r.width, h: img.naturalHeight || r.height } : { url: "", w: r.width, h: r.height };
    const origin = `${(r.left - w.left + r.width / 2).toFixed(1)}px ${(r.top - w.top + r.height / 2).toFixed(1)}px`;
    const apply = (rect, rest) => {
      if (!rect) { this.reset(wrap); return; }
      const dx = rect.left + rect.width / 2 - (rest.left + rest.width / 2);
      const dy = rect.top + rect.height / 2 - (rest.top + rest.height / 2);
      const sx = rest.width ? rect.width / rest.width : 1, sy = rest.height ? rect.height / rest.height : 1;
      if (!this.moved.includes(wrap)) this.moved.push(wrap);
      wrap.style.transformOrigin = origin;
      wrap.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
      wrap.style.opacity = String(Math.max(0, Math.min(1, rect.opacity)));
    };
    return { center, near, sp, apply, side, slot };
  }

  space() {
    const near = [], far = [];
    for (const box of this.host.querySelectorAll("[data-fx-pos]")) {
      const id = box.getAttribute("data-fx-pos");
      const w = this.who(id.slice(0, 2), Number(id.slice(2)));
      if (w) (w.near ? near : far).push(w.center);
    }
    const mean = (l) => (l.length ? { x: l.reduce((s, p) => s + p.x, 0) / l.length, y: l.reduce((s, p) => s + p.y, 0) / l.length } : null);
    return spaceFrom({ near: mean(near), far: mean(far), width: this.host.getBoundingClientRect().width });
  }

  /** Starts a move's animation; returns its length in ms at normal speed (0: none, the caller plays its own effect). */
  playMove({ move, user, target, miss = false }) {
    this.finish();
    const attacker = this.who(user.side, user.slot);
    if (!attacker || !this.has(move)) return 0;
    const defender = target ? this.who(target.side, target.slot) : null;
    const scene = buildMove(move, { space: this.space(), attacker, defender: defender || attacker, miss, images: this.images, resolve: this.resolve });
    return this.start(scene);
  }

  /** A status animation (brn, par, slp, confused…) on one Pokémon; length in ms or 0. */
  playStatus({ status, side, slot }) {
    this.finish();
    const target = this.who(side, slot);
    if (!target || !this.hasStatus(status)) return 0;
    return this.start(buildStatus(status, { space: this.space(), target, images: this.images, resolve: this.resolve }));
  }

  start(scene) {
    if (!scene) return 0;
    for (const src of scene.sources()) this.image(src);
    this.scene = scene;
    this.t = 0;
    this.total = scene.duration();
    return this.total;
  }

  busy() { return !!this.scene; }

  /** Moves the animation on by `ms` (already scaled by the stage's speed). */
  advance(ms) {
    if (!this.scene) return;
    this.t += ms;
    if (this.t >= this.total + 30) { this.finish(); return; }
    this.scene.applySprites(this.t);
  }

  /** Vertical shake of the field (Earthquake and kin), in CSS pixels. */
  quake() { return this.scene ? this.scene.quakeAt(this.t) : 0; }

  draw(ctxU, ctxO, dims) {
    if (this.scene) this.scene.draw(this.t, ctxU, ctxO, dims);
  }

  reset(el) {
    el.style.transform = "";
    el.style.transformOrigin = "";
    el.style.opacity = "";
  }

  /** Ends the animation at once and puts every sprite back. */
  finish() {
    for (const el of this.moved) this.reset(el);
    this.moved = [];
    this.scene = null;
    this.t = 0;
    this.total = 0;
  }
}

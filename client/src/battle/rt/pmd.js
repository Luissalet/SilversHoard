// Walking sprites for the real-time arena: PMDCollab's SpriteCollab sheets (eight directions, Idle/Walk/Attack/Shoot/Charge/Hurt/
// Faint/Sleep), fetched through the app (which downloads and caches them) and drawn frame by frame. Frames of different
// animations have different sizes, so they line up by the ground anchor the app works out from each sheet's shadow.
// The animator follows PokéSurvivor's js/core/sprites.js (MIT): a looping base animation (Idle or Walk) and one-shot animations
// (Attack, Shoot, Hurt...) that cover it until they end.

const metas = new Map();   // "base|num|form|shiny" -> Promise<meta|null>
const images = new Map();  // url -> {img, ready, failed, loaded}

export function loadMeta(num, { form = "", shiny = false, base = "" } = {}) {
  const key = `${base}|${num}|${form}|${shiny ? 1 : 0}`;
  if (!metas.has(key)) {
    const url = `${base}/api/sprites/pmd/${num}?form=${encodeURIComponent(form || "")}&shiny=${shiny ? "true" : "false"}`;
    metas.set(key, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return metas.get(key);
}

export function image(url) {
  let s = images.get(url);
  if (!s) {
    let settle;
    s = { img: new Image(), ready: false, failed: false, loaded: new Promise(resolve => { settle = resolve; }) };
    const ready = () => { s.ready = true; settle(true); };
    const failed = () => { s.failed = true; settle(false); };
    s.img.onload = () => {
      if (typeof s.img.decode === "function") s.img.decode().then(ready, failed);
      else ready();
    };
    s.img.onerror = failed;
    images.set(url, s);
    s.img.src = url;
  }
  return s;
}

export function sheetUrl(meta, anim, base = "") {
  return `${base}/api/sprites/pmd-sheet/${meta.key}/${anim}.png`;
}

/** Screen angle -> sheet row: 0 down, 1 down-right, 2 right, 3 up-right, 4 up, 5 up-left, 6 left, 7 down-left. */
export function dirRow(fx, fy) {
  const a = Math.atan2(fy, fx);
  return ((Math.round((Math.PI / 2 - a) / (Math.PI / 4)) % 8) + 8) % 8;
}

export class Animator {
  constructor(meta, base = "") {
    this.meta = meta;
    this.base = base;
    this.loopName = "Idle";
    this.cur = "Idle";
    this.frame = 0;
    this.t = 0;
    this.once = false;
    this.hold = false;
    this.done = false;
    this.speed = 1;
  }

  has(anim) { return !!this.meta?.a?.[anim]; }
  name(anim) { return this.has(anim) ? anim : this.has("Idle") ? "Idle" : "Walk"; }

  loop(anim, speed = 1) {
    this.loopName = anim;
    if (!this.once && this.cur !== this.name(anim)) this.start(anim, false);
    if (!this.once) this.speed = speed;
  }

  play(anim, { hold = false, speed = 1 } = {}) {
    this.start(anim, true);
    this.hold = hold;
    this.speed = speed;
  }

  busy() { return this.once && !this.done; }

  start(anim, once) {
    this.cur = this.name(anim);
    this.frame = 0;
    this.t = 0;
    this.once = once;
    this.done = false;
  }

  update(dt) {
    const m = this.meta?.a?.[this.cur];
    if (!m || this.done) return;
    this.t += dt * 60 * this.speed;
    let guard = 0;
    while (this.t >= (m.d[this.frame] || 1) && guard++ < 64) {
      this.t -= m.d[this.frame] || 1;
      this.frame++;
      if (this.frame >= m.n) {
        if (this.once) {
          if (this.hold) { this.frame = m.n - 1; this.done = true; return; }
          this.start(this.loopName, false);
          this.speed = 1;
          return;
        }
        this.frame = 0;
      }
    }
  }

  /** Draw with the feet at (x, y), `k` screen pixels per sprite pixel. */
  draw(ctx, x, y, row, k, { alpha = 1, flash = 0 } = {}) {
    const m = this.meta?.a?.[this.cur];
    if (!m) return false;
    const s = image(sheetUrl(this.meta, this.cur, this.base));
    if (!s.ready) return false;
    const r = Math.min(row, m.r - 1);
    const sx = this.frame * m.w;
    const sy = r * m.h;
    const dx = Math.round(x - m.ax * k);
    const dy = Math.round(y - m.ay * k);
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * alpha;
    ctx.drawImage(s.img, sx, sy, m.w, m.h, dx, dy, m.w * k, m.h * k);
    if (flash > 0) {
      ctx.globalAlpha = prev * alpha * flash;
      ctx.drawImage(white(s.img), sx, sy, m.w, m.h, dx, dy, m.w * k, m.h * k);
    }
    ctx.globalAlpha = prev;
    return true;
  }

  height(k) {
    const m = this.meta?.a?.Idle || this.meta?.a?.Walk;
    return m ? m.ay * k : 30;
  }
}

const whites = new WeakMap();
function white(img) {
  let c = whites.get(img);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, c.width, c.height);
  whites.set(img, c);
  return c;
}

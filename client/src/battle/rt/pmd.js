// Walking sprites for the real-time arena: PMDCollab's SpriteCollab sheets (eight directions, Idle/Walk/Attack/Shoot/Charge/Hurt/
// Faint/Sleep), fetched through the app (which downloads and caches them) and drawn frame by frame. Frames of different
// animations have different sizes, so they line up by the ground anchor the app works out from each sheet's shadow.
// The animator follows PokéSurvivor's js/core/sprites.js (MIT): a looping base animation (Idle or Walk) and one-shot animations
// (Attack, Shoot, Hurt...) that cover it until they end.
import { portableAsset, portablePmd } from "../../portable-assets.js";

const metas = new Map();   // "base|num|form|shiny" -> Promise<meta|null>
const images = new Map();  // url -> {img, ready, failed, loaded}

export function loadMeta(num, { form = "", shiny = false, base = "" } = {}) {
  const embedded = portablePmd(num, { form, shiny });
  if (embedded !== undefined) return Promise.resolve(embedded);
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
  return portableAsset(`${base}/api/sprites/pmd-sheet/${meta.key}/${anim}.png`, { missing: "" });
}

/** Screen angle -> sheet row: 0 down, 1 down-right, 2 right, 3 up-right, 4 up, 5 up-left, 6 left, 7 down-left. */
export function dirRow(fx, fy) {
  const a = Math.atan2(fy, fx);
  return ((Math.round((Math.PI / 2 - a) / (Math.PI / 4)) % 8) + 8) % 8;
}

export class Animator {
  constructor(meta, base = "") {
    const a = {...meta.a};
    for (const [name, source, reaction] of [["Pain", a.Hurt ? "Hurt" : "Idle", "pain"], ["HitGround", "Idle", "ground"]]) {
      if (!a[name] && a[source]) a[name] = {...a[source], reaction};
    }
    this.meta = {...meta, a};
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

  play(anim, { hold = false, speed = 1, duration = 0 } = {}) {
    this.start(anim, true);
    this.hold = hold;
    const d = this.meta.a[this.cur]?.d || [];
    this.speed = duration > 0 ? d.reduce((sum, n) => sum + n, 0) / (60 * duration) : speed;
  }

  busy() { return this.once && !this.done; }

  start(anim, once) {
    this.cur = this.name(anim);
    this.frame = 0;
    this.t = 0;
    this.once = once;
    this.done = false;
    this.hold = false;
  }

  progress() {
    const m = this.meta.a[this.cur];
    return this.done ? 1 : Math.min(1, ((m?.d || []).slice(0, this.frame).reduce((a, b) => a + b, 0) + this.t)
      / Math.max(1, (m?.d || []).reduce((a, b) => a + b, 0)));
  }

  /** Derived poses act with the same artwork; they never borrow another species. */
  pose(ctx, x, y, row, k, reduced = false, bounds = null, geometry = null) {
    const m = geometry || this.meta.a[this.cur];
    if (!m?.reaction) return;
    const sign = row >= 4 ? -1 : 1;
    if (m.reaction === "pain") {
      const p = this.progress(), brace = reduced ? .5 : Math.sin(p * Math.PI);
      ctx.translate(x, y); ctx.rotate(sign * -.2 * brace); ctx.translate(-x, -y);
    } else {
      const p = reduced ? 1 : Math.min(1, this.progress() * 3);
      const turn = 1 - (1 - p) ** 3;
      const [left, top, right, bottom] = bounds || m.pose_bounds?.[Math.min(row, m.r - 1)] || [0, 0, m.w, m.ay];
      const cx = x + ((left + right) / 2 - m.ax) * k;
      const cy = y + ((top + bottom) / 2 - m.ay) * k;
      const targetY = y - (right - left) * k / 2;
      ctx.translate(x + (cx - x) * (1 - turn), cy + (targetY - cy) * turn);
      ctx.rotate(sign * Math.PI / 2 * turn);
      ctx.translate(-cx, -cy);
    }
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
  draw(ctx, x, y, row, k, { alpha = 1, flash = 0, reduced = false } = {}) {
    k *= this.meta.display_scale || 1;
    let m = this.meta?.a?.[this.cur];
    if (!m) return false;
    let s = image(sheetUrl(this.meta, this.cur, this.base)), frame = this.frame, pose = m;
    if (!s.ready) {
      // A late Attack/Hurt sheet must not replace a loaded PMD fighter with a Showdown image.
      const idle = ["Idle", "Walk"].find(name => this.has(name) && image(sheetUrl(this.meta, name, this.base)).ready);
      if (!idle) return false;
      m = this.meta.a[idle]; s = image(sheetUrl(this.meta, idle, this.base)); frame = 0;
      if (["Pain", "HitGround"].includes(this.cur)) pose = {...m, reaction:this.cur === "Pain" ? "pain" : "ground"};
    }
    const r = Math.min(m.row_map?.[row] ?? row, m.r - 1);
    if (m.reaction === "ground") frame = 0;
    if (reduced && ["Pain", "HitGround"].includes(this.cur) && !m.reaction) frame = m.n - 1;
    if (this.cur === "HitGround" && m.ground_frames) frame = Math.min(frame,m.ground_frames[r] ?? frame);
    const sx = frame * m.w;
    const sy = r * m.h;
    const dx = Math.round(x - m.ax * k);
    const dy = Math.round(y - m.ay * k);
    const prev = ctx.globalAlpha;
    const acting = !!pose.reaction;
    if (acting) { ctx.save(); this.pose(ctx, x, y, r, k, reduced, null, pose); }
    ctx.globalAlpha = prev * alpha;
    ctx.drawImage(s.img, sx, sy, m.w, m.h, dx, dy, m.w * k, m.h * k);
    if (flash > 0) {
      ctx.globalAlpha = prev * alpha * flash;
      ctx.drawImage(white(s.img), sx, sy, m.w, m.h, dx, dy, m.w * k, m.h * k);
    }
    ctx.globalAlpha = prev;
    if (acting) ctx.restore();
    return true;
  }

  height(k) {
    const m = this.meta?.a?.Idle || this.meta?.a?.Walk;
    return m ? m.ay * k * (this.meta.display_scale || 1) : 30;
  }
}

const whites = new WeakMap();
export function white(img) {
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

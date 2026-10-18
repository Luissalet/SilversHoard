// The "reborn" animation style of the turn-based screen: Pokémon Reborn's move animations (The Pokémon Reborn Team, rebornevo.com:
// «credit… borrow whatever you need»), as pagefaultgames/pokerogue-assets keeps them, played by our own player. Each animation is a
// list of frames (20 a second) of cells: the user's and the target's sprites (moved with CSS transforms, as the Showdown runner does)
// and pieces of a 96 px sheet placed in a 320 px wide field where the near Pokémon stands at (0, 0) and the far one at (128, -64),
// relative to one of them (focus 1 target, 2 user), between both (3) or on the screen (4); plus timed sounds and backgrounds.
// Files load on first use (the app's /api/reborn cache, or the repository itself on the friends' playable page): a move whose
// animation is not loaded yet plays Silver's effect while it loads. Same interface as ps/runner.js, so the stage drives either.
import { sample } from "../../../audio.js";
import { REBORN_MOVES, REBORN_REF, REBORN_STATUS } from "./index.gen.js";
import { portableAsset } from "../../../portable-assets.js";

const FRAME_MS = 50;
const CELL = 96;
const NEAR = { x: 0, y: 0 };
const FAR = { x: 128, y: -64 };
const REPO = `https://raw.githubusercontent.com/pagefaultgames/pokerogue-assets/${REBORN_REF}`;
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export class RebornRunner {
  constructor(host) {
    this.host = host;
    this.local = typeof document === "undefined" || !document.getElementById("silver-data");
    this.anims = new Map();      // file -> {state: "loading"|"ok"|"bad", list}
    this.images = new Map();     // sheet name -> {img, ok}
    this.play = null;
    this.t = 0;
    this.moved = [];
  }

  url(kind, name) {
    if (!this.local) {
      const path = { anim: `battle-anims/${name}.json`, sheet: `images/battle_anims/${name}.png`, sound: `audio/battle_anims/${name}` }[kind];
      return portableAsset(`${REPO}/${path.split("/").map(encodeURIComponent).join("/")}`, { missing: "" });
    }
    return `/api/reborn/${kind}/${encodeURIComponent(name)}`;
  }

  image(name) {
    if (!name) return null;
    let rec = this.images.get(name);
    if (!rec) {
      rec = { img: null, ok: false };
      const src = this.url("sheet", name);
      if (src && typeof Image !== "undefined") {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => { rec.ok = true; };
        img.src = src;
        rec.img = img;
      }
      this.images.set(name, rec);
    }
    return rec.ok ? rec.img : null;
  }

  /** The animation file's frames once loaded (it starts loading on the first ask), else null. */
  load(file) {
    if (!file) return null;
    let rec = this.anims.get(file);
    if (!rec) {
      rec = { state: "loading", list: null };
      this.anims.set(file, rec);
      const url = this.url("anim", file);
      if (url && typeof fetch === "function") {
        fetch(url).then((r) => (r.ok ? r.json() : null)).then((data) => {
          const list = (Array.isArray(data) ? data : data ? [data] : []).filter((a) => a && Array.isArray(a.frames));
          rec.list = list;
          rec.state = list.length ? "ok" : "bad";
          for (const a of list) {
            this.image(a.graphic);
            for (const events of Object.values(a.frameTimedEvents || {})) for (const e of events) if (e.eventType === "AnimTimedAddBgEvent") this.image(e.resourceName);
          }
        }).catch(() => { rec.state = "bad"; });
      } else rec.state = "bad";
    }
    return rec.state === "ok" && rec.list.every((a) => this.image(a.graphic)) ? rec.list : null;
  }

  has(move) { return !!this.load(REBORN_MOVES[key(move)]); }
  hasStatus(status) { return !!this.load(REBORN_STATUS[key(status)]); }
  /** Starts loading these moves' animations (a team's moves), so their first use already plays. */
  preload(moves) { for (const m of moves || []) this.load(REBORN_MOVES[key(m)]); }

  /** The Pokémon at side + slot: its centre in the arena, whether it is the near one, and its sprite's wrapper. */
  who(side, slot) {
    const box = this.host.querySelector(`[data-fx-pos="${side}${slot}"]`);
    if (!box || box.classList.contains("is-fainted")) return null;
    const img = box.querySelector("img");
    const wrap = box.querySelector(".b-sprite-img") || box;
    const r = (img || wrap).getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const h = this.host.getBoundingClientRect();
    return { x: r.left - h.left + r.width / 2, y: r.top - h.top + r.height / 2, near: box.classList.contains("is-back"), wrap,
      origin: `${(r.left - wrap.getBoundingClientRect().left + r.width / 2).toFixed(1)}px ${(r.top - wrap.getBoundingClientRect().top + r.height / 2).toFixed(1)}px` };
  }

  playMove({ move, user, target }) {
    this.finish();
    const list = this.load(REBORN_MOVES[key(move)]);
    const u = this.who(user.side, user.slot);
    if (!list || !u) return 0;
    const t = target ? this.who(target.side, target.slot) : null;
    return this.start(list, u, t && t.wrap !== u.wrap ? t : null);
  }

  playStatus({ status, side, slot }) {
    this.finish();
    const list = this.load(REBORN_STATUS[key(status)]);
    const u = this.who(side, slot);
    if (!list || !u) return 0;
    return this.start(list, u, null);
  }

  start(list, user, target) {
    // two versions: the first for a move from the near side, the second from the far side (both drawn with the near Pokémon at (0, 0))
    const flip = !user.near && list.length > 1;
    const anim = list[flip ? 1 : 0];
    if (!anim.frames.length) return 0;
    const w = this.host.getBoundingClientRect().width || 640;
    const k = Math.max(1, Math.min(3.2, w / 320));
    const cu = flip ? FAR : NEAR, ct = flip ? NEAR : FAR;     // where the user and the target stand in the animation's field
    const tgt = target || { x: user.x + (ct.x - cu.x) * k, y: user.y + (ct.y - cu.y) * k, wrap: null };
    // between both (focus 3): the similarity that takes the animation's user and target to theirs on the screen
    const cv = { x: ct.x - cu.x, y: ct.y - cu.y }, av = { x: tgt.x - user.x, y: tgt.y - user.y };
    const cl = Math.hypot(cv.x, cv.y), al = Math.hypot(av.x, av.y) || cl * k;
    const ang = Math.atan2(av.y, av.x) - Math.atan2(cv.y, cv.x);
    const s3 = al / cl, cos = Math.cos(ang), sin = Math.sin(ang);
    const h = this.host.getBoundingClientRect().height || 360;
    const place = (c) => {
      const f = c.focus || 3;
      if (f === 1) return { x: tgt.x + (c.x - ct.x) * k, y: tgt.y + (c.y - ct.y) * k, s: k };
      if (f === 2) return { x: user.x + (c.x - cu.x) * k, y: user.y + (c.y - cu.y) * k, s: k };
      if (f === 4) return { x: w / 2 + (c.x - 64) * k, y: h / 2 + (c.y + 32) * k, s: k };
      const dx = c.x - cu.x, dy = c.y - cu.y;
      return { x: user.x + (dx * cos - dy * sin) * s3, y: user.y + (dx * sin + dy * cos) * s3, s: Math.max(k * 0.8, Math.min(k * 1.4, s3)) };
    };
    this.play = { anim, user, target: target || null, place, k, total: anim.frames.length * FRAME_MS, frame: -1, bg: null, w, h };
    this.t = 0;
    return this.play.total;
  }

  busy() { return !!this.play; }
  quake() { return 0; }

  advance(ms) {
    const p = this.play;
    if (!p) return;
    this.t += ms;
    if (this.t >= p.total + 30) { this.finish(); return; }
    const f = Math.min(p.anim.frames.length - 1, Math.floor(this.t / FRAME_MS));
    while (p.frame < f) {
      p.frame++;
      for (const e of (p.anim.frameTimedEvents || {})[p.frame] || []) this.event(e);
    }
    this.sprites(p.anim.frames[f] || []);
  }

  event(e) {
    const p = this.play;
    const name = String(e.resourceName || "");
    if (e.eventType === "AnimTimedSoundEvent") {
      if (name.startsWith("PRSFX-")) sample(this.url("sound", name), { vol: (Number(e.volume) || 100) / 100, rate: (Number(e.pitch) || 100) / 100 });
    } else if (e.eventType === "AnimTimedAddBgEvent" || e.eventType === "AnimTimedUpdateBgEvent") {
      if (e.eventType === "AnimTimedAddBgEvent") {
        if (!name.startsWith("PRAS-")) return;
        p.bg = { name, from: { x: 0, y: 0, o: 0 }, to: null, t0: this.t, dur: 0 };
      }
      if (!p.bg) return;
      const now = this.bgAt(this.t);
      p.bg.from = now;
      p.bg.to = { x: Number(e.bgX) || 0, y: Number(e.bgY) || 0, o: e.opacity === undefined ? now.o : Number(e.opacity) || 0 };
      p.bg.t0 = this.t;
      p.bg.dur = Math.max(1, Number(e.duration) || 1) * FRAME_MS;
    }
  }

  bgAt(t) {
    const b = this.play?.bg;
    if (!b) return { x: 0, y: 0, o: 0 };
    if (!b.to) return b.from;
    const q = Math.max(0, Math.min(1, (t - b.t0) / b.dur));
    return { x: b.from.x + (b.to.x - b.from.x) * q, y: b.from.y + (b.to.y - b.from.y) * q, o: b.from.o + (b.to.o - b.from.o) * q };
  }

  /** The user's and the target's sprites as this frame has them (cells 0 and 1: moved from where they stand, scaled, faded). */
  sprites(cells) {
    const p = this.play;
    for (const c of cells) {
      if (c.target !== 0 && c.target !== 1) continue;
      const who = c.target === 0 ? p.user : p.target;
      if (!who?.wrap) continue;
      // cell 0 stands at (0, 0) and cell 1 at (128, -64) when nothing moves them, in both versions
      const dx = (c.x - (c.target === 0 ? NEAR.x : FAR.x)) * p.k, dy = (c.y - (c.target === 0 ? NEAR.y : FAR.y)) * p.k;
      const sx = (Number(c.zoomX) || 100) / 100, sy = (Number(c.zoomY) || 100) / 100;
      const op = c.visible === false ? 0 : (c.opacity ?? 255) / 255;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && sx === 1 && sy === 1 && op === 1 && !this.moved.includes(who.wrap)) continue;
      if (!this.moved.includes(who.wrap)) this.moved.push(who.wrap);
      who.wrap.style.transformOrigin = who.origin;
      who.wrap.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
      who.wrap.style.opacity = String(op);
    }
  }

  draw(ctxU, ctxO, { dpr = 1 } = {}) {
    const p = this.play;
    if (!p) return;
    const f = Math.min(p.anim.frames.length - 1, Math.max(0, Math.floor(this.t / FRAME_MS)));
    const sheet = this.image(p.anim.graphic);
    const hue = Number(p.anim.hue) || 0;
    // the background (Black BG, Fire BG…) behind the Pokémon
    if (p.bg) {
      const img = this.image(p.bg.name);
      const at = this.bgAt(this.t);
      if (img && at.o > 0) {
        ctxU.save();
        ctxU.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctxU.globalAlpha = Math.max(0, Math.min(1, at.o / 255));
        const scale = Math.max(p.w / img.naturalWidth, p.h / img.naturalHeight);
        ctxU.drawImage(img, at.x * p.k, at.y * p.k, img.naturalWidth * scale, img.naturalHeight * scale);
        ctxU.restore();
      }
    }
    if (!sheet) return;
    const cols = Math.max(1, Math.floor(sheet.naturalWidth / CELL));
    for (const c of p.anim.frames[f] || []) {
      if (c.target !== 2 || c.visible === false || !(c.opacity ?? 255)) continue;
      const ctx = c.priority === 0 || c.priority === 2 ? ctxU : ctxO;
      const at = p.place(c);
      const gf = Math.max(0, Number(c.graphicFrame) || 0);
      const size = CELL * at.s;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = Math.max(0, Math.min(1, (c.opacity ?? 255) / 255));
      ctx.globalCompositeOperation = c.blendType === 1 ? "lighter" : c.blendType === 2 ? "multiply" : "source-over";
      if (hue) ctx.filter = `hue-rotate(${hue}deg)`;
      ctx.imageSmoothingEnabled = false;
      ctx.translate(at.x, at.y);
      if (c.angle) ctx.rotate((-Number(c.angle) * Math.PI) / 180);
      ctx.scale(((Number(c.zoomX) || 100) / 100) * (c.mirror ? -1 : 1), (Number(c.zoomY) || 100) / 100);
      ctx.drawImage(sheet, (gf % cols) * CELL, Math.floor(gf / cols) * CELL, CELL, CELL, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }

  reset(el) {
    el.style.transform = "";
    el.style.transformOrigin = "";
    el.style.opacity = "";
  }

  finish() {
    for (const el of this.moved) this.reset(el);
    this.moved = [];
    this.play = null;
    this.t = 0;
  }
}

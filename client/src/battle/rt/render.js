// Draws a real-time battle on a canvas: the court, the trainers at each end, the Pokémon (walking sprites lined up by their feet,
// depth-sorted), projectiles, telegraphed areas, effects and floating numbers. It reads the battle's view each frame and its new
// events to start animations; it never changes the battle.
import { TYPE_COLORS } from "../dex.js";
import { Animator, dirRow, image, loadMeta } from "./pmd.js";
import { Vfx } from "./vfx.js";

const ARENA = { w: 28, h: 17 };
const MARGIN_X = 2.6;
const MARGIN_Y = 0.9;
const WORLD = { x0: -MARGIN_X, y0: -MARGIN_Y, w: ARENA.w + MARGIN_X * 2, h: ARENA.h + MARGIN_Y * 2 };
const TRAINER = [{ x: -1.2, y: ARENA.h / 2 }, { x: ARENA.w + 1.2, y: ARENA.h / 2 }];

export const WORLD_RATIO = WORLD.w / WORLD.h;

function shade(hex, a) {
  const c = hex || "#cccccc";
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class ArenaRenderer {
  /** sides: [{mons: [{num, forme, shiny, species, sprite_id}], avatarUrl, name}] */
  constructor(canvas, { sides, sprites, base = "", texts }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sides = sides;
    this.sprites = sprites;
    this.base = base;
    this.texts = texts;
    this.anims = sides.map((s) => s.mons.map(() => null));
    this.fallbacks = sides.map((s) => s.mons.map((m) => image(sprites.fallback(m.species, { spriteid: m.sprite_id }))));
    this.trainers = sides.map((s) => (s.avatarUrl ? image(s.avatarUrl) : null));
    this.floats = [];
    this.effects = [];
    this.flash = [0, 0];
    this.labels = [null, null];
    this.fade = [{ slot: -1, t: 0 }, { slot: -1, t: 0 }];
    this.lastActive = [-1, -1];
    this.eventIndex = 0;
    this.time = 0;
    this.court = null;
    this.vfx = new Vfx(this);
    this.resize(canvas.clientWidth || 900);
  }

  /** Load every walking sprite (resolves when all are in or after `timeout`), reporting progress. */
  async preload(onProgress = () => {}, timeout = 15000) {
    const jobs = [];
    this.sides.forEach((s, si) => s.mons.forEach((m, mi) => jobs.push([si, mi, m])));
    let done = 0;
    const one = async ([si, mi, m]) => {
      const meta = await loadMeta(m.num, { form: m.forme, shiny: m.shiny, base: this.base });
      if (meta) {
        this.anims[si][mi] = new Animator(meta, this.base);
        for (const a of Object.keys(meta.a)) image(`${this.base}/api/sprites/pmd-sheet/${meta.key}/${a}.png`);
      }
      done++;
      onProgress(done, jobs.length);
    };
    await Promise.race([Promise.all(jobs.map(one)), new Promise((r) => setTimeout(r, timeout))]);
  }

  resize(width) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // the whole court fits on the screen with the bars above and the moves below it
    const maxH = Math.max(260, (window.innerHeight || 800) - 330);
    const w = Math.max(320, Math.floor(Math.min(width, maxH * WORLD_RATIO)));
    // a scrollbar coming and going changes the width by a few pixels: ignore that, or the page and the canvas chase each other
    if (this.cssWidth && Math.abs(this.cssWidth - w) < 24 && this.dpr === dpr) return;
    this.cssWidth = w;
    this.dpr = dpr;
    const h = Math.floor(w / WORLD_RATIO);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.height = `${h}px`;
    this.canvas.style.width = `${w}px`;
    this.scale = (w / WORLD.w) * dpr;          // canvas pixels per meter
    this.k = Math.max(1, Math.round((this.scale / 17) * 2) / 2); // canvas pixels per sprite pixel
    this.court = null;
  }

  px(x) { return (x - WORLD.x0) * this.scale; }
  py(y) { return (y - WORLD.y0) * this.scale; }

  drawCourt(view) {
    if (!this.court || this.court.w !== this.canvas.width) {
      const c = document.createElement("canvas");
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const x = c.getContext("2d");
      const s = this.scale;
      x.fillStyle = "#1d2a22";
      x.fillRect(0, 0, c.width, c.height);
      // grass in stripes
      for (let i = 0; i < ARENA.w; i += 2) {
        x.fillStyle = i % 4 === 0 ? "#4f8a4a" : "#4a8345";
        x.fillRect(this.px(i), this.py(0), 2 * s, ARENA.h * s);
      }
      // speckles
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      x.fillStyle = "rgba(255,255,255,0.05)";
      for (let i = 0; i < 900; i++) x.fillRect(this.px(rnd() * ARENA.w), this.py(rnd() * ARENA.h), s * 0.06, s * 0.06);
      // lines
      x.strokeStyle = "rgba(255,255,255,0.55)";
      x.lineWidth = Math.max(2, s * 0.08);
      x.strokeRect(this.px(0), this.py(0), ARENA.w * s, ARENA.h * s);
      x.beginPath();
      x.moveTo(this.px(ARENA.w / 2), this.py(0));
      x.lineTo(this.px(ARENA.w / 2), this.py(ARENA.h));
      x.stroke();
      x.beginPath();
      x.arc(this.px(ARENA.w / 2), this.py(ARENA.h / 2), 2.6 * s, 0, Math.PI * 2);
      x.stroke();
      // trainer boxes
      x.fillStyle = "rgba(0,0,0,0.18)";
      x.fillRect(this.px(-2.3), this.py(ARENA.h / 2 - 2.2), 2.1 * s, 4.4 * s);
      x.fillRect(this.px(ARENA.w + 0.2), this.py(ARENA.h / 2 - 2.2), 2.1 * s, 4.4 * s);
      this.court = { w: c.width, canvas: c };
    }
    this.ctx.drawImage(this.court.canvas, 0, 0);
    const w = view.weather?.id;
    const tint = { sunnyday: "rgba(255,190,90,0.13)", desolateland: "rgba(255,150,60,0.18)", raindance: "rgba(60,90,160,0.18)", primordialsea: "rgba(40,70,150,0.22)",
      sandstorm: "rgba(190,150,80,0.22)", snow: "rgba(220,235,255,0.2)", hail: "rgba(220,235,255,0.2)" }[w];
    if (tint) { this.ctx.fillStyle = tint; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    const tr = view.terrain?.id;
    const ttint = { electricterrain: "rgba(247,208,44,0.12)", grassyterrain: "rgba(122,199,76,0.14)", psychicterrain: "rgba(249,85,135,0.12)", mistyterrain: "rgba(243,182,216,0.14)" }[tr];
    if (ttint) { this.ctx.fillStyle = ttint; this.ctx.fillRect(this.px(0), this.py(0), ARENA.w * this.scale, ARENA.h * this.scale); }
  }

  /** New events since the last frame start animations and floating texts. */
  consume(battle) {
    const ev = battle.events;
    for (; this.eventIndex < ev.length; this.eventIndex++) this.onEvent(ev[this.eventIndex], battle);
  }

  posOf(battle, si) {
    const s = battle.sides[si];
    return { x: s.x, y: s.y };
  }

  float(battle, si, text, color, { size = 1, dy = 0 } = {}) {
    const p = this.posOf(battle, si);
    this.floats.push({ x: p.x, y: p.y, text, color, t: 0, life: 1.1, size, dy });
  }

  onEvent(e, battle) {
    const T = this.texts;
    const anim = (si) => this.anims[si]?.[battle.sides[si].active];
    const s = e.s;
    this.vfx.onEvent(e, battle);
    switch (e.k) {
      case "windup": {
        const a = anim(s);
        if (a) a.play(["strike", "dash"].includes(e.shape) ? "Attack" : ["self", "field"].includes(e.shape) ? "Charge" : "Shoot", { speed: e.ticks ? 1 : 1.6 });
        this.labels[s] = { text: T.move(e.name), type: e.type, t: 0 };
        break;
      }
      case "hit": {
        this.flash[s] = 1;
        const a = anim(s);
        if (a && e.hp > 0) a.play("Hurt");
        const pct = Math.max(1, Math.round((e.dmg / Math.max(1, e.maxhp)) * 100));
        this.float(battle, s, `−${pct}%`, e.eff > 1 ? "#ffd54a" : e.eff < 1 ? "#c9d2dc" : "#ffffff", { size: e.crit || e.eff > 1 ? 1.3 : 1 });
        if (e.crit) this.float(battle, s, T.crit, "#ff8a65", { size: 0.8, dy: -0.7 });
        else if (e.eff > 1 && e.hit === 0) this.float(battle, s, T.super, "#ffd54a", { size: 0.8, dy: -0.7 });
        else if (e.eff < 1 && e.eff > 0 && e.hit === 0) this.float(battle, s, T.weak, "#c9d2dc", { size: 0.75, dy: -0.7 });
        break;
      }
      case "chip": this.float(battle, s, `−${Math.max(1, Math.round((e.amount / Math.max(1, e.maxhp)) * 100))}%`, "#e8a0a0", { size: 0.75 }); break;
      case "heal": this.float(battle, s, `+${Math.max(1, Math.round((e.amount / Math.max(1, e.maxhp)) * 100))}%`, "#7ee08f", { size: 0.9 }); break;
      case "miss": this.float(battle, 1 - s, T.dodged, "#bfe3ff", { size: 0.85 }); break;
      case "protected": {
        this.float(battle, s, T.blocked, "#9fd3ff", { size: 0.85 });
        const p = this.posOf(battle, s);
        this.effects.push({ kind: "shield", x: p.x, y: p.y, t: 0, life: 0.45 });
        break;
      }
      case "immune": this.float(battle, s, T.immune, "#c9d2dc", { size: 0.8 }); break;
      case "flinch": this.float(battle, s, T.flinch, "#ffcf7a", { size: 0.85 }); break;
      case "status": this.float(battle, s, T.status(e.status), T.statusColor(e.status), { size: 0.85 }); break;
      case "boost": if (!e.same) this.float(battle, s, `${T.stat(e.stat)} ${e.stage > 0 ? "↑" : e.stage < 0 ? "↓" : "="}`, e.stage > 0 ? "#ffb15c" : "#7fb2ff", { size: 0.8, dy: -0.4 }); break;
      case "faint": {
        const a = this.anims[s]?.[e.slot];
        if (a) a.play("Faint", { hold: true });
        this.fade[s] = { slot: e.slot, t: 0 };
        break;
      }
      case "switch": {
        const p = this.posOf(battle, s);
        this.effects.push({ kind: "beam", x: p.x, y: p.y, from: TRAINER[s], t: 0, life: 0.4 });
        this.fade[s] = { slot: -1, t: 0 };
        break;
      }
      case "recall": {
        const p = this.posOf(battle, s);
        this.effects.push({ kind: "beam", x: p.x, y: p.y, from: TRAINER[s], t: 0, life: 0.5, red: true });
        break;
      }
      case "fizzle": this.effects.push({ kind: "spark", x: e.x, y: e.y, color: "#ffffff", t: 0, life: 0.25, small: true }); break;
      case "roll": {
        const p = this.posOf(battle, s);
        this.effects.push({ kind: "dust", x: p.x, y: p.y, t: 0, life: 0.35 });
        break;
      }
      default: break;
    }
  }

  draw(battle, dt) {
    const ctx = this.ctx;
    const view = battle.view();
    this.time += dt;
    this.consume(battle);
    this.vfx.update(dt, view);
    ctx.imageSmoothingEnabled = false;
    const [shx, shy] = this.vfx.shakeOffset();
    ctx.save();
    ctx.translate(shx, shy);
    this.drawCourt(view);
    const s = this.scale;
    // trainers
    view.sides.forEach((side, si) => {
      const img = this.trainers[si];
      const p = TRAINER[si];
      if (img?.ready) {
        const h = 2.6 * s;
        const w = (img.img.width / img.img.height) * h;
        ctx.save();
        if (si === 0) { ctx.translate(this.px(p.x) + w / 2, 0); ctx.scale(-1, 1); ctx.translate(-(this.px(p.x) + w / 2), 0); }
        ctx.drawImage(img.img, this.px(p.x) - w / 2, this.py(p.y) - h * 0.85, w, h);
        ctx.restore();
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.beginPath();
        ctx.arc(this.px(p.x), this.py(p.y) - 0.8 * s, 0.6 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // telegraphed areas
    for (const m of view.marks) {
      const left = Math.max(0, (m.at - view.t) / 18);
      ctx.save();
      ctx.strokeStyle = "rgba(255,80,80,0.85)";
      ctx.setLineDash([s * 0.25, s * 0.18]);
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.beginPath();
      ctx.arc(this.px(m.x), this.py(m.y), m.r * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,70,70,${0.12 + 0.3 * (1 - Math.min(1, left))})`;
      ctx.fill();
      ctx.restore();
    }
    // area effects under the Pokémon
    this.drawEffects(dt, true);
    this.vfx.drawUnder(ctx);
    // Pokémon, sorted by depth
    const order = view.sides.map((side, si) => ({ side, si })).sort((a, b) => a.side.y - b.side.y);
    for (const { side, si } of order) this.drawMon(view, side, si, dt);
    // lock-on (ZL / Shift held): a turning reticle on the opponent, as in Legends: Z-A
    (this.focus || []).forEach((on, si) => { if (on && view.sides[1 - si]) this.drawReticle(view.sides[1 - si], si); });
    // projectiles, rays, melee marks, particles
    this.vfx.drawOver(ctx, view, battle);
    this.drawEffects(dt, false);
    // floating texts
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.floats = this.floats.filter((f) => (f.t += dt) < f.life);
    for (const f of this.floats) {
      const a = 1 - f.t / f.life;
      const y = f.y - 1.9 + f.dy - f.t * 1.2;
      ctx.font = `800 ${Math.round(0.62 * s * f.size)}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, s * 0.09);
      ctx.strokeStyle = `rgba(0,0,0,${0.75 * a})`;
      ctx.strokeText(f.text, this.px(f.x), this.py(y));
      ctx.fillStyle = f.color;
      ctx.globalAlpha = a;
      ctx.fillText(f.text, this.px(f.x), this.py(y));
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    this.flash = this.flash.map((v) => Math.max(0, v - dt * 5));
  }

  drawReticle(side, by) {
    const ctx = this.ctx;
    const s = this.scale;
    const x = this.px(side.x);
    const y = this.py(side.y) - 0.7 * s;
    const r = 1.25 * s;
    const t = this.time * 2.2;
    ctx.save();
    ctx.strokeStyle = by === 0 ? "rgba(120,200,255,0.95)" : "rgba(255,120,120,0.95)";
    ctx.lineWidth = Math.max(2, s * 0.08);
    for (let i = 0; i < 4; i++) {
      const a = t + (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(x, y, r, a, a + 0.9);
      ctx.stroke();
    }
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    for (let i = 0; i < 4; i++) {
      const a = -t * 0.6 + (i * Math.PI) / 2 + Math.PI / 4;
      const cx = x + Math.cos(a) * r * 1.25;
      const cy = y + Math.sin(a) * r * 1.25;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x + Math.cos(a) * r * 1.02, y + Math.sin(a) * r * 1.02);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMon(view, side, si, dt) {
    const ctx = this.ctx;
    const s = this.scale;
    const mon = side.mons[side.active];
    if (!mon) return;
    if (this.lastActive[si] !== side.active) {
      this.lastActive[si] = side.active;
      const a = this.anims[si]?.[side.active];
      if (a) a.start("Idle", false);
    }
    const recalling = side.act?.kind === "switch";
    const fade = this.fade[si];
    let alpha = 1;
    if (mon.fainted) {
      fade.t += dt;
      alpha = Math.max(0, 1 - fade.t / 1.2);
      if (alpha <= 0) return;
    }
    if (recalling) alpha = Math.max(0.15, (side.act.left || 0) / 27);
    if (side.need && !mon.fainted) alpha = 0.15;
    if (side.invulnerable && side.act?.kind === "windup") alpha *= 0.35;
    const x = this.px(side.x);
    const y = this.py(side.y);
    // shadow
    ctx.fillStyle = `rgba(0,0,0,${0.32 * alpha})`;
    ctx.beginPath();
    ctx.ellipse(x, y, side.r * s * 0.9, side.r * s * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    // ring under the feet: blue for p1, red for p2
    ctx.strokeStyle = si === 0 ? `rgba(90,170,255,${0.8 * alpha})` : `rgba(255,95,95,${0.8 * alpha})`;
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.beginPath();
    ctx.ellipse(x, y, side.r * s * 1.05, side.r * s * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
    const a = this.anims[si]?.[side.active];
    let headY = y - 1.6 * s;
    let drawn = false;
    if (a) {
      const act = side.act?.kind;
      if (mon.fainted) { /* holds the faint frame */ } else if (mon.status === "slp" && !a.busy()) a.loop("Sleep");
      else if (act === "roll" || act === "dash" || act === "approach") a.loop("Walk", 1.8);
      else if (side.moving) a.loop("Walk");
      else a.loop("Idle");
      a.update(dt);
      const row = dirRow(side.fx, side.fy);
      drawn = a.draw(ctx, x, y, row, this.k, { alpha, flash: this.flash[si] });
      headY = y - a.height(this.k) - 0.3 * s;
    }
    if (!drawn) {
      const img = this.fallbacks[si]?.[side.active];
      if (img?.ready) {
        const h = 2.2 * s;
        const w = (img.img.width / img.img.height) * h;
        ctx.save();
        ctx.globalAlpha = alpha;
        if (side.fx > 0) { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); }
        ctx.drawImage(img.img, x - w / 2, y - h * 0.92, w, h);
        ctx.restore();
        headY = y - h * 0.95;
      } else {
        ctx.fillStyle = `rgba(255,255,255,${0.7 * alpha})`;
        ctx.beginPath();
        ctx.arc(x, y - 0.6 * s, 0.55 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (side.protect) {
      ctx.strokeStyle = "rgba(140,210,255,0.9)";
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.arc(x, y - 0.7 * s, 1.15 * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(140,210,255,0.15)";
      ctx.fill();
    }
    if (mon.fainted) return;
    // HP bar and wind-up bar over the head
    const bw = 1.7 * s;
    const bh = Math.max(4, 0.16 * s);
    const frac = mon.maxhp ? mon.hp / mon.maxhp : 0;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - bw / 2 - 1, headY - bh - 1, bw + 2, bh + 2);
    ctx.fillStyle = frac > 0.5 ? "#4cc46a" : frac > 0.2 ? "#e7b52c" : "#e2473f";
    ctx.fillRect(x - bw / 2, headY - bh, bw * frac, bh);
    if (side.act?.kind === "windup") {
      const label = this.labels[si];
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - bw / 2 - 1, headY + 2, bw + 2, bh * 0.7 + 2);
      ctx.fillStyle = TYPE_COLORS[label?.type] || "#fff";
      const total = Math.max(1, side.act.total || 1);
      ctx.fillRect(x - bw / 2, headY + 3, bw * Math.min(1, 1 - side.act.left / total), bh * 0.7);
    }
    const label = this.labels[si];
    if (label) {
      label.t += dt;
      if (label.t > 1.3) this.labels[si] = null;
      else {
        const a2 = Math.min(1, (1.3 - label.t) * 3);
        ctx.font = `700 ${Math.round(0.46 * s)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const tw = ctx.measureText(label.text).width + 0.4 * s;
        ctx.globalAlpha = a2;
        ctx.fillStyle = shade(TYPE_COLORS[label.type] || "#666666", 0.92);
        ctx.fillRect(x - tw / 2, headY - bh - 0.72 * s, tw, 0.6 * s);
        ctx.fillStyle = "#fff";
        ctx.fillText(label.text, x, headY - bh - 0.16 * s);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawEffects(dt, under) {
    const ctx = this.ctx;
    const s = this.scale;
    const keep = [];
    for (const e of this.effects) {
      const isUnder = e.kind === "ring" || e.kind === "cone" || e.kind === "dust";
      if (isUnder !== under) { keep.push(e); continue; }
      e.t += dt;
      if (e.t >= e.life) continue;
      keep.push(e);
      const p = e.t / e.life;
      const a = 1 - p;
      if (e.kind === "ring") {
        ctx.strokeStyle = shade(e.color, 0.9 * a);
        ctx.fillStyle = shade(e.color, 0.25 * a);
        ctx.lineWidth = Math.max(2, s * 0.12);
        ctx.beginPath();
        ctx.arc(this.px(e.x), this.py(e.y), e.r * s * (0.4 + 0.6 * p), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (e.kind === "cone") {
        const ang = Math.atan2(e.fy, e.fx);
        const half = Math.acos(Math.max(-1, Math.min(1, e.arc)));
        ctx.fillStyle = shade(e.color, 0.35 * a);
        ctx.beginPath();
        ctx.moveTo(this.px(e.x), this.py(e.y));
        ctx.arc(this.px(e.x), this.py(e.y), e.r * s * (0.5 + 0.5 * p), ang - half, ang + half);
        ctx.closePath();
        ctx.fill();
      } else if (e.kind === "spark") {
        const r = (e.small ? 0.3 : 0.7) * s * (0.5 + p);
        ctx.strokeStyle = shade(e.color, a);
        ctx.lineWidth = Math.max(1.5, s * 0.07);
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2 + e.x;
          ctx.beginPath();
          ctx.moveTo(this.px(e.x) + Math.cos(ang) * r * 0.4, this.py(e.y) - 0.6 * s + Math.sin(ang) * r * 0.4);
          ctx.lineTo(this.px(e.x) + Math.cos(ang) * r, this.py(e.y) - 0.6 * s + Math.sin(ang) * r);
          ctx.stroke();
        }
      } else if (e.kind === "shield") {
        ctx.strokeStyle = `rgba(160,220,255,${a})`;
        ctx.lineWidth = Math.max(2, s * 0.1);
        ctx.beginPath();
        ctx.arc(this.px(e.x), this.py(e.y) - 0.7 * s, 1.2 * s * (1 + p * 0.2), 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.kind === "beam") {
        ctx.strokeStyle = e.red ? `rgba(255,90,90,${a})` : `rgba(255,255,255,${a})`;
        ctx.lineWidth = Math.max(2, s * 0.14 * a);
        ctx.beginPath();
        ctx.moveTo(this.px(e.from.x), this.py(e.from.y) - 1.2 * s);
        ctx.lineTo(this.px(e.x), this.py(e.y) - 0.5 * s);
        ctx.stroke();
        ctx.fillStyle = e.red ? `rgba(255,90,90,${0.4 * a})` : `rgba(255,255,255,${0.5 * a})`;
        ctx.beginPath();
        ctx.arc(this.px(e.x), this.py(e.y) - 0.5 * s, 1.1 * s * (1 - p * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === "dust") {
        ctx.fillStyle = `rgba(230,230,210,${0.45 * a})`;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(this.px(e.x) + (i - 1.5) * 0.35 * s, this.py(e.y) - 0.1 * s - p * 0.4 * s, 0.22 * s * (1 + p), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    this.effects = keep;
  }
}

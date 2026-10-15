// Draws a real-time battle on a canvas: the court (with its rocks), the trainers at each end, the Pokémon (walking sprites lined up
// by their feet, depth-sorted, in their Mega forme while Mega Evolved, with an arrow for their facing when they are not locked
// on), projectiles, telegraphed areas, effects and floating numbers. It reads the battle's view each frame and its new events to
// start animations; it never changes the battle. In doubles there are four Pokémon: each has its HP bar with its slot (a / b),
// the one a person controls has a marker over its head and the foe it locks on a reticle (turning while the lock-on is held).
import { TYPE_COLORS } from "../dex.js";
import { Animator, dirRow, image, loadMeta } from "./pmd.js";
import { Vfx } from "./vfx.js";
import { playRtEvent } from "../sfx.js";
import { rtMove } from "../../../../engine/src/realtime/moves.mjs";

const ARENA = { w: 28, h: 17 };
const MARGIN_X = 2.6;
const MARGIN_Y = 0.9;
const WORLD = { x0: -MARGIN_X, y0: -MARGIN_Y, w: ARENA.w + MARGIN_X * 2, h: ARENA.h + MARGIN_Y * 2 };
const TRAINER = [{ x: -1.2, y: ARENA.h / 2 }, { x: ARENA.w + 1.2, y: ARENA.h / 2 }];
const TAU = Math.PI * 2;
const SIDE_RGB = ["90,170,255", "255,95,95"];

export const WORLD_RATIO = WORLD.w / WORLD.h;

function shade(hex, a) {
  const c = hex || "#cccccc";
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// The ground of a custom arena (the arena designer): stripes, speckles and a little detail. The rules are the same on every floor.
const FLOORS = {
  grass: { out: "#1d2a22", a: "#4f8a4a", b: "#4a8345", speck: "rgba(255,255,255,0.05)" },
  sand: { out: "#3a2f1e", a: "#d7bd86", b: "#cfb47c", speck: "rgba(90,60,20,0.12)" },
  ice: { out: "#1e2b33", a: "#cfe6f0", b: "#c4dfeb", speck: "rgba(255,255,255,0.4)", detail: "cracks" },
  cave: { out: "#17130f", a: "#4b4239", b: "#463e35", speck: "rgba(255,240,220,0.06)" },
  indoor: { out: "#20160e", a: "#b5875a", b: "#ad7f53", speck: "rgba(60,35,15,0.08)", detail: "planks" },
  water: { out: "#0f2233", a: "#4f8fbf", b: "#4a88b6", speck: "rgba(255,255,255,0.08)", detail: "ripples" },
};

export class ArenaRenderer {
  /** sides: [{mons: [{num, forme, shiny, species, sprite_id, base_look, mega_info}], avatarUrl, name}]; rocks: [{x, y, r}];
   * humans: which sides a person plays (doubles: their controlled Pokémon and locked foe get markers).
   * offline: there is no app behind the page (the friends' playable page), so no walking sprites are asked for: the static battle
   * sprites, or a white dot while they load, draw the Pokémon. */
  constructor(canvas, { sides, sprites, base = "", texts, rocks = [], humans = [false, false], offline = false }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sides = sides;
    this.sprites = sprites;
    this.audio = { speed: 1, cryUrl: null };
    this.base = base;
    this.offline = !!offline;
    this.texts = texts;
    this.rocks = rocks || [];
    this.humans = humans || [false, false];
    this.anims = sides.map((s) => s.mons.map(() => null));
    this.credits = new Set();    // the walking sprites' artists (SpriteCollab), for the credit line under the arena
    this.megaAnims = sides.map((s) => s.mons.map(() => null));
    const look = (m) => m.base_look || m;
    this.fallbacks = sides.map((s) => s.mons.map((m) => image(sprites.fallback(look(m).species, { spriteid: look(m).sprite_id }))));
    // Mega formes: their own sprites, or the base ones when there are none
    this.megaFallbacks = sides.map((s) => s.mons.map((m) => (m.mega_info ? image(sprites.fallback(m.mega_info.species, { spriteid: m.mega_info.sprite_id })) : null)));
    this.trainers = sides.map((s) => (s.avatarUrl ? image(s.avatarUrl) : null));
    this.floats = [];
    this.effects = [];
    // per Pokémon on the field: key = side in singles, side * 2 + slot in doubles
    this.flash = [0, 0, 0, 0];
    this.labels = [null, null, null, null];
    this.fade = [0, 1, 2, 3].map(() => ({ slot: -1, t: 0 }));
    this.lastActive = [-1, -1, -1, -1];
    this.heads = [];
    this.eventIndex = 0;
    this.time = 0;
    this.court = null;
    this.vfx = new Vfx(this);
    // hit feel: seconds the battle holds still after a big hit (the screen's loop reads and runs it down), the move each Pokémon
    // is winding up (its area is drawn on the ground while it charges) and the Mega Evolution cut-in
    this.hitstop = 0;
    this.winding = [null, null, null, null];
    this.cutin = null;
    this.resize(canvas.clientWidth || 900);
  }

  /** Load every walking sprite (resolves when all are in or after `timeout`), reporting progress. */
  async preload(onProgress = () => {}, timeout = 15000) {
    if (this.offline) return;
    const jobs = [];
    this.sides.forEach((s, si) => s.mons.forEach((m, mi) => {
      jobs.push([si, mi, m.num, (m.base_look || m).forme, m.shiny, this.anims]);
      if (m.mega_info) jobs.push([si, mi, m.mega_info.num, m.mega_info.forme, m.shiny, this.megaAnims]);
    }));
    let done = 0;
    const one = async ([si, mi, num, form, shiny, table]) => {
      const meta = await loadMeta(num, { form, shiny, base: this.base });
      for (const who of meta?.credit || []) this.credits.add(who);
      if (meta) {
        table[si][mi] = new Animator(meta, this.base);
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
    // (a video clip has no moves, log or replay bar: only the bars above)
    const reserve = typeof document !== "undefined" && document.body?.classList.contains("video-mode") ? 240 : 330;
    const maxH = Math.max(260, (window.innerHeight || 800) - reserve);
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
      const floor = FLOORS[view?.floor] || FLOORS.grass;
      x.fillStyle = floor.out;
      x.fillRect(0, 0, c.width, c.height);
      // the ground in stripes (planks indoors)
      for (let i = 0; i < ARENA.w; i += 2) {
        x.fillStyle = i % 4 === 0 ? floor.a : floor.b;
        x.fillRect(this.px(i), this.py(0), 2 * s, ARENA.h * s);
      }
      // speckles
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      x.fillStyle = floor.speck;
      for (let i = 0; i < 900; i++) x.fillRect(this.px(rnd() * ARENA.w), this.py(rnd() * ARENA.h), s * 0.06, s * 0.06);
      if (floor.detail === "planks") {
        x.strokeStyle = "rgba(60,35,15,0.35)";
        x.lineWidth = Math.max(1, s * 0.03);
        for (let j = 1; j < ARENA.h; j++) {
          x.beginPath(); x.moveTo(this.px(0), this.py(j)); x.lineTo(this.px(ARENA.w), this.py(j)); x.stroke();
        }
      } else if (floor.detail === "ripples" || floor.detail === "cracks") {
        x.strokeStyle = floor.detail === "ripples" ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.35)";
        x.lineWidth = Math.max(1, s * 0.035);
        for (let i = 0; i < 60; i++) {
          const cx = this.px(rnd() * ARENA.w), cy = this.py(rnd() * ARENA.h), w = s * (0.4 + rnd() * 1.1);
          x.beginPath();
          if (floor.detail === "ripples") x.ellipse(cx, cy, w, w * 0.35, 0, Math.PI * 1.1, Math.PI * 1.9);
          else { x.moveTo(cx, cy); x.lineTo(cx + w, cy + w * (rnd() - 0.5)); }
          x.stroke();
        }
      }
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
      for (const rk of this.rocks) this.drawRock(x, rk);
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

  /** A rock of the arena: a rounded boulder with a shadow, lit from the top left, some cracks and grass at its foot. */
  drawRock(x, rk) {
    const s = this.scale;
    const cx = this.px(rk.x), cy = this.py(rk.y), r = rk.r * s;
    let seed = Math.floor(rk.x * 7919 + rk.y * 104729 + rk.r * 1299709) % 2147483647 || 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // shadow on the grass
    x.fillStyle = "rgba(10,20,10,0.35)";
    x.beginPath();
    x.ellipse(cx + r * 0.22, cy + r * 0.3, r * 1.05, r * 0.82, 0, 0, TAU);
    x.fill();
    // the boulder: an irregular outline inside the circle that blocks
    const n = 11;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd() * 0.25;
      const k = 0.86 + rnd() * 0.14;
      pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
    }
    const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05);
    g.addColorStop(0, "#c9bf9f");
    g.addColorStop(0.55, "#958a6d");
    g.addColorStop(1, "#5f5846");
    x.fillStyle = g;
    x.strokeStyle = "#3b362b";
    x.lineWidth = Math.max(1.5, s * 0.06);
    x.beginPath();
    pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    x.closePath();
    x.fill();
    x.stroke();
    // a lit facet and a darker one
    x.fillStyle = "rgba(255,250,230,0.18)";
    x.beginPath();
    x.moveTo(pts[6][0], pts[6][1]);
    x.lineTo(pts[7][0], pts[7][1]);
    x.lineTo(pts[8][0], pts[8][1]);
    x.lineTo(cx - r * 0.1, cy - r * 0.05);
    x.closePath();
    x.fill();
    x.fillStyle = "rgba(30,25,15,0.22)";
    x.beginPath();
    x.moveTo(pts[1][0], pts[1][1]);
    x.lineTo(pts[2][0], pts[2][1]);
    x.lineTo(pts[3][0], pts[3][1]);
    x.lineTo(cx + r * 0.1, cy + r * 0.1);
    x.closePath();
    x.fill();
    // cracks
    x.strokeStyle = "rgba(40,34,24,0.7)";
    x.lineWidth = Math.max(1, s * 0.035);
    for (let i = 0; i < 2; i++) {
      let px = cx + (rnd() - 0.5) * r * 0.6, py = cy + (rnd() - 0.5) * r * 0.6;
      x.beginPath();
      x.moveTo(px, py);
      for (let j = 0; j < 3; j++) { px += (rnd() - 0.5) * r * 0.5; py += (rnd() - 0.2) * r * 0.35; x.lineTo(px, py); }
      x.stroke();
    }
    // grass tufts at its foot, in the pitch's greens
    x.strokeStyle = "#3f7a3a";
    x.lineWidth = Math.max(1, s * 0.04);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (0.15 + rnd() * 0.7);
      const bx = cx + Math.cos(a) * r * 0.95, by = cy + Math.sin(a) * r * 0.9;
      for (const d of [-1, 0, 1]) {
        x.beginPath();
        x.moveTo(bx, by);
        x.lineTo(bx + d * 0.08 * s, by - (0.14 + rnd() * 0.08) * s);
        x.stroke();
      }
    }
  }

  /** The walking sprite of a Pokémon: its Mega forme's while Mega Evolved (the base one when there is no Mega sprite). */
  animOf(si, slot, mega) {
    return (mega && this.megaAnims[si]?.[slot]) || this.anims[si]?.[slot] || null;
  }

  /** New events since the last frame start animations and floating texts. */
  consume(battle) {
    const ev = battle.events;
    for (; this.eventIndex < ev.length; this.eventIndex++) this.onEvent(ev[this.eventIndex], battle);
  }

  /** The Pokémon of side `si` (in doubles, of its slot `u`) in the battle itself. */
  unitOf(battle, si, u = 0) {
    return battle.doubles ? battle.sides[si].units[u || 0] : battle.sides[si];
  }

  posOf(battle, si, u = 0) {
    const s = this.unitOf(battle, si, u);
    return { x: s.x, y: s.y };
  }

  float(battle, si, text, color, { size = 1, dy = 0, u = 0 } = {}) {
    const p = this.posOf(battle, si, u);
    this.floats.push({ x: p.x, y: p.y, text, color, t: 0, life: 1.1, size, dy });
  }

  onEvent(e, battle) {
    const T = this.texts;
    const u = e.u || 0;
    const key = battle.doubles ? e.s * 2 + u : e.s;
    const anim = (si) => { const w = this.unitOf(battle, si, u); return this.animOf(si, w.active, !!w.mons[w.active]?.megaOn); };
    const s = e.s;
    const float = (si, text, color, opts = {}) => this.float(battle, si, text, color, { ...opts, u });
    this.vfx.onEvent(e, battle);
    playRtEvent(e, this.audio);
    switch (e.k) {
      case "windup": {
        if (["burst", "cone"].includes(e.shape)) {
          const prof = rtMove(e.move, battle.gen || 9);
          if (prof) this.winding[key] = { shape: e.shape, reach: prof.shape === "burst" ? prof.radius || prof.reach : prof.reach, arc: prof.arc, type: e.type, t: e.t };
        } else this.winding[key] = null;
        const a = anim(s);
        if (a) a.play(["strike", "dash"].includes(e.shape) ? "Attack" : ["self", "field"].includes(e.shape) ? "Charge" : "Shoot", { speed: e.ticks ? 1 : 1.6 });
        this.labels[key] = { text: T.move(e.name), type: e.type, t: 0 };
        break;
      }
      case "helping": float(s, T.helping || "+", "#ffd166", { size: 0.85, dy: -0.6 }); break;
      case "follow": float(s, T.follow || "!", "#ff9f43", { size: 0.85, dy: -0.6 }); break;
      case "hit": {
        this.flash[key] = 1;
        // a short freeze sells the blow: longest for a K.O., then a critical hit, then a super-effective one
        if (e.hit === 0 || e.hit === undefined) this.hitstop = Math.max(this.hitstop, e.hp <= 0 ? 0.22 : e.crit ? 0.12 : e.eff > 1 ? 0.07 : 0);
        const a = anim(s);
        if (a && e.hp > 0) a.play("Hurt");
        const pct = Math.max(1, Math.round((e.dmg / Math.max(1, e.maxhp)) * 100));
        float(s, `−${pct}%`, e.eff > 1 ? "#ffd54a" : e.eff < 1 ? "#c9d2dc" : "#ffffff", { size: e.crit || e.eff > 1 ? 1.3 : 1 });
        if (e.crit) float(s, T.crit, "#ff8a65", { size: 0.8, dy: -0.7 });
        else if (e.eff > 1 && e.hit === 0) float(s, T.super, "#ffd54a", { size: 0.8, dy: -0.7 });
        else if (e.eff < 1 && e.eff > 0 && e.hit === 0) float(s, T.weak, "#c9d2dc", { size: 0.75, dy: -0.7 });
        break;
      }
      case "chip": float(s, `−${Math.max(1, Math.round((e.amount / Math.max(1, e.maxhp)) * 100))}%`, "#e8a0a0", { size: 0.75 }); break;
      case "heal": float(s, `+${Math.max(1, Math.round((e.amount / Math.max(1, e.maxhp)) * 100))}%`, "#7ee08f", { size: 0.9 }); break;
      case "miss": {
        // over the one that got away: the other side's Pokémon (in doubles, the one the attacker aimed at)
        if (battle.doubles) { const t = battle.foe(this.unitOf(battle, s, u)); this.float(battle, t.index, T.dodged, "#bfe3ff", { size: 0.85, u: t.pos }); }
        else this.float(battle, 1 - s, T.dodged, "#bfe3ff", { size: 0.85 });
        break;
      }
      case "protected": {
        float(s, T.blocked, "#9fd3ff", { size: 0.85 });
        const p = this.posOf(battle, s, u);
        this.effects.push({ kind: "shield", x: p.x, y: p.y, t: 0, life: 0.45 });
        break;
      }
      case "immune": float(s, T.immune, "#c9d2dc", { size: 0.8 }); break;
      case "flinch": float(s, T.flinch, "#ffcf7a", { size: 0.85 }); break;
      case "status": float(s, T.status(e.status), T.statusColor(e.status), { size: 0.85 }); break;
      case "boost": if (!e.same) float(s, `${T.stat(e.stat)} ${e.stage > 0 ? "↑" : e.stage < 0 ? "↓" : "="}`, e.stage > 0 ? "#ffb15c" : "#7fb2ff", { size: 0.8, dy: -0.4 }); break;
      case "faint": {
        const a = this.animOf(s, e.slot, !!battle.sides[s].mons[e.slot]?.megaOn);
        if (a) a.play("Faint", { hold: true });
        this.fade[key] = { slot: e.slot, t: 0, at: e.t, mega: false };
        break;
      }
      case "mega": {
        this.flash[key] = 1;
        this.hitstop = Math.max(this.hitstop, 0.18);
        {
          const w = this.unitOf(battle, s, u);
          const m = w.mons[e.slot ?? w.active];
          const url = this.sprites.portrait?.(e.species || m?.species, "Determined", { num: m?.mega?.num || m?.num || 0 });
          this.cutin = { t: 0, life: 1.25, si: s, img: url ? image(url) : null, fall: url ? image(this.sprites.portrait(e.species || m?.species, "Normal", { num: m?.mega?.num || m?.num || 0 })) : null,
            text: T.mega, name: e.species || m?.species || "" };
        }
        float(s, T.mega, "#ffb3ea", { size: 1.1, dy: -0.5 });
        break;
      }
      case "mega_end": {
        // a Mega Pokémon that faints keeps its Mega look while it fades out
        if (this.fade[key].slot === e.slot && this.fade[key].at === e.t) {
          this.fade[key].mega = true;
          this.megaAnims[s]?.[e.slot]?.play("Faint", { hold: true });
        } else float(s, T.megaEnd, "#e6d3ff", { size: 0.8, dy: -0.5 });
        break;
      }
      case "plus": float(s, `${T.plus}!`, "#ff8fdc", { size: 0.85, dy: -0.9 }); break;
      case "switch": {
        const p = this.posOf(battle, s, u);
        this.effects.push({ kind: "beam", x: p.x, y: p.y, from: TRAINER[s], t: 0, life: 0.4 });
        this.fade[key] = { slot: -1, t: 0 };
        break;
      }
      case "recall": {
        const p = this.posOf(battle, s, u);
        this.effects.push({ kind: "beam", x: p.x, y: p.y, from: TRAINER[s], t: 0, life: 0.5, red: true });
        break;
      }
      case "fizzle":
        this.effects.push({ kind: "spark", x: e.x, y: e.y, color: e.rock ? "#e8dcc0" : "#ffffff", t: 0, life: e.rock ? 0.35 : 0.25, small: !e.rock });
        if (e.rock) this.effects.push({ kind: "dust", x: e.x, y: e.y, t: 0, life: 0.45 });
        break;
      case "roll": {
        const p = this.posOf(battle, s, u);
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
    // areas being charged (Earthquake, Surf, Explosion, cones like Heat Wave): the ground fills in as the move winds up, so you
    // know when to dodge-roll out of it
    this.drawWindups(view);
    // area effects under the Pokémon
    this.drawEffects(dt, true);
    this.vfx.drawUnder(ctx);
    // every Pokémon on the field: one per side in singles, a side's two slots in doubles (their own place and act, the side's party)
    const fighters = view.doubles
      ? view.sides.flatMap((sd, si) => sd.units.filter((w) => !w.vacant).map((w) => ({ side: { ...sd, ...w }, si, key: si * 2 + w.pos })))
      : view.sides.map((side, si) => ({ side, si, key: si }));
    // facing arrows of Pokémon that are not locked on: their moves go that way
    for (const { side, si } of fighters) if (!side.focus && view.version >= 2) this.drawFacing(side, si);
    // Pokémon, sorted by depth
    const order = fighters.slice().sort((a, b) => a.side.y - b.side.y);
    for (const { side, si, key } of order) this.drawMon(view, side, si, dt, key);
    if (view.doubles) {
      // doubles: a marker over the Pokémon a person controls and a reticle on the foe it locks on (turning while ZL / Shift is held)
      view.sides.forEach((sd, si) => {
        if (!this.humans[si]) return;
        const lead = sd.units[sd.ctl];
        const foe = view.sides[1 - si]?.units[lead?.aim ?? 0];
        if (lead && !lead.vacant) this.drawControlled({ ...sd, ...lead }, si);
        if (foe && !foe.vacant && !foe.need) this.drawReticle(foe, si, !!this.focus?.[si]);
      });
    } else {
      // lock-on (ZL / Shift held): a turning reticle on the opponent, as in Legends: Z-A
      (this.focus || []).forEach((on, si) => { if (on && view.sides[1 - si]) this.drawReticle(view.sides[1 - si], si); });
    }
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
    this.drawCutin(dt);
    this.flash = this.flash.map((v) => Math.max(0, v - dt * 5));
  }

  drawWindups(view) {
    const ctx = this.ctx;
    const s = this.scale;
    const units = view.doubles
      ? view.sides.flatMap((sd, si) => sd.units.filter((w) => !w.vacant).map((w) => ({ w, key: si * 2 + w.pos })))
      : view.sides.map((w, si) => ({ w, key: si }));
    for (const { w, key } of units) {
      const tele = this.winding[key];
      if (!tele || w.act?.kind !== "windup" || !w.act.total) continue;
      const p = Math.min(1, 1 - w.act.left / w.act.total);
      const x = this.px(w.x), y = this.py(w.y), r = tele.reach * s;
      const col = TYPE_COLORS[tele.type] || "#ff5050";
      ctx.save();
      ctx.beginPath();
      if (tele.shape === "cone") {
        const a = Math.atan2(w.fy, w.fx), half = Math.acos(Math.max(-1, Math.min(1, tele.arc || 0.55)));
        ctx.moveTo(x, y);
        ctx.arc(x, y, r, a - half, a + half);
        ctx.closePath();
      } else ctx.arc(x, y, r, 0, TAU);
      ctx.fillStyle = shade(col, 0.1);
      ctx.fill();
      ctx.strokeStyle = shade(col, 0.85);
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.setLineDash([s * 0.22, s * 0.16]);
      ctx.stroke();
      ctx.setLineDash([]);
      // the filling part: from the user outwards until the move goes off
      ctx.beginPath();
      if (tele.shape === "cone") {
        const a = Math.atan2(w.fy, w.fx), half = Math.acos(Math.max(-1, Math.min(1, tele.arc || 0.55)));
        ctx.moveTo(x, y);
        ctx.arc(x, y, r * p, a - half, a + half);
        ctx.closePath();
      } else ctx.arc(x, y, r * p, 0, TAU);
      ctx.fillStyle = shade(col, 0.28);
      ctx.fill();
      ctx.restore();
    }
  }

  /** Mega Evolution: a band crosses the screen with the Pokémon's determined face (its SpriteCollab portrait) and the word. */
  drawCutin(dt) {
    const c = this.cutin;
    if (!c) return;
    c.t += dt;
    if (c.t >= c.life) { this.cutin = null; return; }
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const p = c.t / c.life;
    const slide = p < 0.15 ? 1 - p / 0.15 : p > 0.82 ? -(p - 0.82) / 0.18 : 0;
    const dir = c.si === 0 ? -1 : 1;
    const bandH = Math.min(H * 0.26, 150);
    const y = H * 0.36;
    ctx.save();
    ctx.globalAlpha = 1 - Math.abs(slide);
    ctx.translate(dir * slide * W * 0.6, 0);
    ctx.fillStyle = "rgba(18,12,31,0.86)";
    ctx.beginPath();
    ctx.moveTo(0, y + bandH * 0.12);
    ctx.lineTo(W, y);
    ctx.lineTo(W, y + bandH * 0.88);
    ctx.lineTo(0, y + bandH);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgb(${SIDE_RGB[c.si]})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    const img = c.img?.ready ? c.img.img : c.fall?.ready ? c.fall.img : null;
    const size = bandH * 0.78;
    const ix = c.si === 0 ? W * 0.18 : W * 0.82 - size;
    if (img) {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#e9e1cc";
      ctx.fillRect(ix - 3, y + (bandH - size) / 2 - 3, size + 6, size + 6);
      ctx.drawImage(img, ix, y + (bandH - size) / 2, size, size);
    }
    ctx.font = `900 ${Math.round(bandH * 0.3)}px system-ui, sans-serif`;
    ctx.textAlign = c.si === 0 ? "left" : "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffd6f2";
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 4;
    const tx = c.si === 0 ? ix + size + 22 : ix - 22;
    ctx.strokeText(c.text, tx, y + bandH * 0.42);
    ctx.fillText(c.text, tx, y + bandH * 0.42);
    ctx.font = `700 ${Math.round(bandH * 0.16)}px system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(c.name, tx, y + bandH * 0.72);
    ctx.restore();
  }

  /** Not locked on: an arrow on the ground in front of the Pokémon and a faint aim line, so you see where a move will go. */
  drawFacing(side, si) {
    const mon = side.mons[side.active];
    if (!mon || mon.fainted || side.need || side.act?.kind === "switch") return;
    const ctx = this.ctx;
    const s = this.scale;
    const { fx, fy } = side;
    const d0 = side.r + 0.25;
    const tipX = side.x + fx * (d0 + 0.75), tipY = side.y + fy * (d0 + 0.75);
    const baseX = side.x + fx * d0, baseY = side.y + fy * d0;
    const w = 0.42;
    ctx.save();
    ctx.setLineDash([s * 0.22, s * 0.2]);
    ctx.strokeStyle = `rgba(${SIDE_RGB[si]},0.35)`;
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(this.px(tipX), this.py(tipY));
    ctx.lineTo(this.px(side.x + fx * (d0 + 4.5)), this.py(side.y + fy * (d0 + 4.5)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(${SIDE_RGB[si]},0.9)`;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.beginPath();
    ctx.moveTo(this.px(tipX), this.py(tipY));
    ctx.lineTo(this.px(baseX - fy * w), this.py(baseY + fx * w));
    ctx.lineTo(this.px(side.x + fx * (d0 + 0.25)), this.py(side.y + fy * (d0 + 0.25)));
    ctx.lineTo(this.px(baseX + fy * w), this.py(baseY - fx * w));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Doubles: the Pokémon a person moves gets a bobbing chevron in its side's colour over its head. */
  drawControlled(side, si) {
    const ctx = this.ctx;
    const s = this.scale;
    const x = this.px(side.x);
    const y = this.py(side.y) - (this.heads[si * 2 + (side.pos || 0)] ?? 2.6 * s) - (0.25 + Math.sin(this.time * 5) * 0.08) * s;
    const w = 0.42 * s;
    ctx.save();
    ctx.fillStyle = `rgba(${SIDE_RGB[si]},0.95)`;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - w, y - w * 1.1);
    ctx.lineTo(x, y - w * 0.6);
    ctx.lineTo(x + w, y - w * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawReticle(side, by, turning = true) {
    const ctx = this.ctx;
    const s = this.scale;
    const x = this.px(side.x);
    const y = this.py(side.y) - 0.7 * s;
    const r = 1.25 * s;
    const t = turning ? this.time * 2.2 : 0;
    ctx.save();
    if (!turning) { ctx.globalAlpha = 0.55; ctx.setLineDash([s * 0.18, s * 0.12]); }
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

  drawMon(view, side, si, dt, key = si) {
    const ctx = this.ctx;
    const s = this.scale;
    const mon = side.mons[side.active];
    if (!mon) return;
    const fade = this.fade[key];
    const mega = !!mon.is_mega || (mon.fainted && fade.slot === side.active && !!fade.mega);
    const lookKey = `${side.active}:${mega ? 1 : 0}`;
    if (this.lastActive[key] !== lookKey) {
      this.lastActive[key] = lookKey;
      const a = this.animOf(si, side.active, mega);
      if (a && !mon.fainted) a.start("Idle", false);
    }
    const recalling = side.act?.kind === "switch";
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
    if (mon.is_mega && !mon.fainted) {
      // Mega Evolved: a pulsing pink ring of energy at its feet
      const k = 1.25 + Math.sin(this.time * 6) * 0.08;
      ctx.strokeStyle = `rgba(255,95,200,${0.75 * alpha})`;
      ctx.lineWidth = Math.max(2, s * 0.08);
      ctx.beginPath();
      ctx.ellipse(x, y, side.r * s * k, side.r * s * 0.5 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const a = this.animOf(si, side.active, mega);
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
      drawn = a.draw(ctx, x, y, row, this.k, { alpha, flash: this.flash[key] });
      headY = y - a.height(this.k) - 0.3 * s;
    }
    if (!drawn) {
      const megaImg = mega ? this.megaFallbacks[si]?.[side.active] : null;
      const img = megaImg?.ready ? megaImg : this.fallbacks[si]?.[side.active];
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
    if (side.follow && !mon.fainted) {
      // Follow Me / Rage Powder: a pulsing orange ring that draws the foes' attacks
      const k = 1.4 + Math.sin(this.time * 8) * 0.12;
      ctx.strokeStyle = `rgba(255,159,67,${0.85 * alpha})`;
      ctx.lineWidth = Math.max(2, s * 0.09);
      ctx.beginPath();
      ctx.ellipse(x, y, side.r * s * k, side.r * s * 0.5 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
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
    if (view.doubles) {
      // doubles: the slot's letter next to its HP bar, in the side's colour
      const sz = Math.max(9, Math.round(0.42 * s));
      ctx.font = `800 ${sz}px system-ui, sans-serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(2, s * 0.07);
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      const letter = side.pos ? "b" : "a";
      ctx.strokeText(letter, x - bw / 2 - 3, headY - bh / 2);
      ctx.fillStyle = `rgb(${SIDE_RGB[si]})`;
      ctx.fillText(letter, x - bw / 2 - 3, headY - bh / 2);
    }
    this.heads[key] = y - headY;
    if (side.act?.kind === "windup") {
      const label = this.labels[key];
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - bw / 2 - 1, headY + 2, bw + 2, bh * 0.7 + 2);
      ctx.fillStyle = TYPE_COLORS[label?.type] || "#fff";
      const total = Math.max(1, side.act.total || 1);
      ctx.fillRect(x - bw / 2, headY + 3, bw * Math.min(1, 1 - side.act.left / total), bh * 0.7);
    }
    const label = this.labels[key];
    if (label) {
      label.t += dt;
      if (label.t > 1.3) this.labels[key] = null;
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

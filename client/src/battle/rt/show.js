// The show around a real-time battle, in the style of the pixel-art battle videos: a VS intro with both trainers, Poké Balls
// thrown in with "Go, X!", big callouts (K.O., fainted, last Pokémon, combos, clashes), a manga impact frame with the two
// fighters' silhouettes on the hardest blows, a red edge flash, a camera that pushes in on the big moments, the marks the fight
// leaves on the floor, a wave that sweeps the screen for Surf and the winner's banner. Drawing only: it reads the battle's view and
// events and never changes the battle (the screen holds the battle still while the intro and the ending play).
import { Animator, dirRow, image, loadMeta } from "./pmd.js";
import { crowdMembers } from "./crowd.js";
import { mixTrainerCrowd, drawCrowdTrainer, loadCrowdTrainerAtlas } from "./crowd-trainers.js";
import { drawBallFrame } from "../ball-art.js";

const TAU = Math.PI * 2;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);

// Side colours: blue for the first trainer, red for the second (as the rings under the Pokémon).
export const SIDE_COLORS = ["#3d8bfd", "#e5484d"];
const SIDE_DARK = ["#16336b", "#6b1619"];

// ------------------------------------------------------------ settings (this browser)
const KEY = "silver-rt-show";
const DEFAULTS = { style: "show", camera: true, impact: true, numbers: "pct", crowd: true, talk: true };
let cached = null;
export function showSettings() {
  if (cached) return cached;
  let v = {};
  try { v = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { v = {}; }
  cached = {
    style: v.style === "plain" ? "plain" : "show",
    camera: v.camera !== false,
    impact: v.impact !== false,
    numbers: v.numbers === "hp" ? "hp" : "pct",
    crowd: v.crowd !== false,
    talk: v.talk !== false,
  };
  return cached;
}
export function setShowSetting(key, value) {
  const next = { ...showSettings(), [key]: value };
  cached = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* the defaults stay */ }
  return next;
}
export const SHOW_DEFAULTS = DEFAULTS;

// moves that crack the ground, blow a crater or leave a scorch
const CRACKS = new Set(["earthquake", "magnitude", "bulldoze", "fissure", "precipiceblades", "earthpower", "stompingtantrum", "highhorsepower", "headlongrush", "heavyslam", "bodyslam", "hammerarm", "gigatonhammer"]);
const CRATERS = new Set(["explosion", "selfdestruct", "mistyexplosion", "mindblown", "dracometeor", "meteormash", "rockslide", "stoneedge", "thunder", "boltstrike", "hurricane", "doomdesire", "judgment"]);
const WAVES = new Set(["surf", "muddywater", "originpulse", "sparklingaria", "waterspout"]);
const CONTACT = new Set(["strike", "dash"]);

export class Show {
  constructor(renderer) {
    this.r = renderer;
    this.callouts = [];       // big words on the screen
    this.captions = [];       // "Go, X!" by the trainers (world space)
    this.balls = [];          // Poké Balls on their way
    this.pops = [];           // white bursts where a Pokémon comes out
    this.scars = [];          // marks on the floor
    this.impact = null;       // the manga frame
    this.vignette = 0;        // red edge flash
    this.wave = null;         // Surf sweeping the screen
    this.intro = null;
    this.end = null;
    this.hidden = new Set();  // Pokémon still inside their ball (keys as the renderer's)
    this.cam = { x: 0, y: 0, z: 1, ready: false };
    this.punch = null;
    this.combo = [{ n: 0, t: -99 }, { n: 0, t: -99 }];
    this.lastHit = [-99, -99];       // when each side last landed a blow (battle seconds)
    this.lastShape = ["", ""];       // the shape of each side's last move
    this.announcedLast = [false, false];
    this.announcedLow = [false, false];   // the last Pokémon fell to half its HP (said once per trainer)
    this.off = null;                  // offscreen canvas for the silhouettes
    this.crowd = null;                // the audience at the edges (by the place's floor)
    this.bubbles = [];                // what the trainers say
    this.talkAt = -99;
    this.faints = 0;
    this.supers = 0;
  }

  // ------------------------------------------------------------ the audience
  /** Trainers and Pokémon watch each battle from the edges, keeping their places on replay. */
  setupCrowd(battle) {
    this.crowd = [];
    if (!this.on || !showSettings().crowd) return;
    const pokemonOnline = !this.r.offline && typeof fetch !== "undefined";
    const seed = `${battle.seed}:${battle.id}:${battle.floor || "grass"}`;
    mixTrainerCrowd(crowdMembers(battle), seed).forEach((member) => {
      if (!member.trainer && !pokemonOnline) return;
      const one = { ...member, anim: null, hop: -1, delay: 0,
        fallback: member.trainer ? null : image(this.r.sprites.fallback(member.species)) };
      this.crowd.push(one);
      if (member.trainer) { loadCrowdTrainerAtlas(); return; }
      loadMeta(member.num, { base: this.r.base }).then((meta) => {
        if (!meta) return;
        one.anim = new Animator(meta, this.r.base);
        for (const who of meta.credit || []) this.r.credits?.add(who);
      }).catch(() => {});
    });
  }
  cheer(strength = 1) {
    for (const c of this.crowd || []) if (Math.random() < 0.5 + 0.4 * strength) { c.hop = 0; c.delay = Math.random() * 0.25; c.big = strength; }
  }
  drawCrowd(ctx, dt) {
    if (!this.crowd?.length) return;
    const r = this.r, s = r.scale;
    for (const c of this.crowd) {
      if (!c.trainer && !c.anim && !c.fallback?.ready) continue;
      c.anim?.loop("Idle");
      c.anim?.update(dt);
      let lift = 0;
      if (c.hop >= 0) {
        if (c.delay > 0) c.delay -= dt; else {
          c.hop += dt;
          lift = Math.abs(Math.sin(c.hop * Math.PI * 2.4)) * 0.45 * (c.big || 1);
          if (c.hop > 0.85) c.hop = -1;
        }
      }
      const size = 1.65 * s * (c.small ? 0.75 : 1);
      const frame = c.anim?.meta?.a?.Idle || c.anim?.meta?.a?.Walk;
      const zoom = Math.max(1, Math.round(r.k * (c.small ? 0.75 : 0.85) * 2) / 2);
      const k = frame ? Math.min(zoom, size / Math.max(frame.w, frame.h)) : zoom;
      const x = r.px(c.x), y = r.py(c.y);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(x, y, 0.35 * s, 0.13 * s, 0, 0, TAU); ctx.fill();
      if (c.trainer) {
        drawCrowdTrainer(ctx, c.trainer, x, y - lift * s, c.fx, c.fy, size);
        continue;
      }
      const drawn = c.anim?.draw(ctx, x, y - lift * s, dirRow(c.fx, c.fy), k, { alpha: 0.95 });
      if (!drawn && c.fallback?.ready) {
        const img = c.fallback.img;
        const scale = Math.min(size / img.width, size / img.height);
        ctx.drawImage(img, x - img.width * scale / 2, y - lift * s - img.height * scale, img.width * scale, img.height * scale);
      }
    }
  }

  // ------------------------------------------------------------ the trainers talk
  line(si, key) { return this.r.sides?.[si]?.dialogue?.[key] || ""; }
  talk(si, key, { force = false, life = 3.2 } = {}) {
    if (!this.on || !showSettings().talk) return false;
    const text = this.line(si, key);
    if (!text) return false;
    const now = this.r.time;
    if (!force && now - this.talkAt < 2.5) return false;
    this.talkAt = now;
    this.bubbles = this.bubbles.filter((b) => b.si !== si);
    this.bubbles.push({ si, text, t: 0, life: Math.min(6, Math.max(life, 1.6 + text.length * 0.045)) });
    return true;
  }
  drawBubbles(ctx, dt) {
    if (!this.bubbles.length) return;
    const r = this.r, s = r.scale;
    for (const b of this.bubbles) b.t += dt;
    this.bubbles = this.bubbles.filter((b) => b.t < b.life);
    for (const b of this.bubbles) {
      const a = Math.min(1, b.t * 6, (b.life - b.t) * 3);
      const tp = r.trainerPos(b.si);
      // on the screen (not in the world), so a camera push never cuts it: anchored over the trainer, kept inside the picture
      const W = r.canvas.width, Hh = r.canvas.height;
      const fs = Math.max(11, Math.round(Math.min(Hh * 0.03, 0.6 * s)));
      ctx.font = `700 ${fs}px system-ui, sans-serif`;
      // wrap to about seven metres
      const maxW = W * 0.3;
      const words = b.text.split(/\s+/);
      const rows = [];
      let cur = "";
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(next).width > maxW && cur) { rows.push(cur); cur = w; } else cur = next;
      }
      if (cur) rows.push(cur);
      const lines = rows.slice(0, 4);
      const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + fs * 1.2;
      const th = lines.length * fs * 1.25 + fs * 0.8;
      const anchor = this.toScreen(tp.x, tp.y, 2.4);
      const ax = Math.max(fs, Math.min(W - fs, anchor.x)), ay = Math.max(th + fs * 1.4, Math.min(Hh - fs, anchor.y));
      const bx = Math.max(6, Math.min(W - tw - 6, b.si === 0 ? ax - fs * 0.6 : ax - tw + fs * 0.6));
      const by = ay - th - fs * 0.6;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "#fffdf6";
      ctx.strokeStyle = "#141018";
      ctx.lineWidth = Math.max(2, fs * 0.12);
      const rad = fs * 0.5;
      ctx.beginPath();
      ctx.moveTo(bx + rad, by);
      ctx.arcTo(bx + tw, by, bx + tw, by + th, rad);
      ctx.arcTo(bx + tw, by + th, bx, by + th, rad);
      const tail = b.si === 0 ? bx + fs * 1.2 : bx + tw - fs * 1.2;
      ctx.lineTo(tail + fs * 0.4, by + th);
      ctx.lineTo(ax, ay);
      ctx.lineTo(tail - fs * 0.4, by + th);
      ctx.arcTo(bx, by + th, bx, by, rad);
      ctx.arcTo(bx, by, bx + tw, by, rad);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#141018";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      lines.forEach((l, i) => ctx.fillText(i === lines.length - 1 && rows.length > lines.length ? `${l}…` : l, bx + fs * 0.6, by + fs * 0.4 + i * fs * 1.25));
      ctx.restore();
    }
  }

  get on() { return showSettings().style === "show"; }
  get holding() { return !!this.intro && this.intro.t < this.intro.hold; }
  hides(key) { return this.hidden.has(key); }

  T(key, vars = {}) {
    const f = this.r.texts?.show?.[key];
    if (typeof f === "function") return f(vars);
    if (typeof f === "string") return f;
    return FALLBACK[key] ? FALLBACK[key](vars) : key;
  }

  // ------------------------------------------------------------ helpers
  units(battle, si) {
    return battle.doubles ? battle.sides[si].units.filter((u) => !u.vacant).map((u) => ({ u, key: si * 2 + u.pos, pos: u.pos })) : [{ u: battle.sides[si], key: si, pos: 0 }];
  }
  monName(battle, si, slot) {
    const m = battle.sides[si]?.mons?.[slot];
    return m?.name || m?.species || "";
  }
  /** World point (meters, height z) to canvas pixels, through the camera. */
  toScreen(x, y, z = 0) {
    const r = this.r;
    const px = r.px(x), py = r.py(y) - z * r.scale;
    const { tx, ty, z: k } = this.view || { tx: 0, ty: 0, z: 1 };
    return { x: (px - tx) * k + r.canvas.width / 2, y: (py - ty) * k + r.canvas.height / 2, k };
  }
  say(text, color, { size = 1, life = 1.4, y = 0.34, delay = 0, small = false } = {}) {
    if (!this.on) return;
    // the same words twice in a row are one callout
    if (this.callouts.some((c) => c.text === text && c.t < 0.4)) return;
    // callouts on the screen at the same time stack instead of covering each other, and keep above a cut-in band (Mega, ultimate)
    let at = this.r.cutin && y > 0.26 && y < 0.7 ? 0.2 : y;
    for (let i = 0; i < 4 && this.callouts.some((c) => c.t < c.life * 0.8 && Math.abs(c.y - at) < 0.1 * Math.max(c.size, size)); i++) at += 0.11 * size;
    this.callouts.push({ text, color, size, life, y: Math.min(0.85, at), t: -delay, small });
    if (this.callouts.length > 4) this.callouts.shift();
  }
  push(x, y, z, life, hold = false) {
    if (!showSettings().camera) return;
    if (this.punch && this.punch.z > z && this.punch.t < this.punch.life * 0.6) return;
    this.punch = { x, y, z, t: 0, life, hold };
  }
  scar(kind, x, y, extra = {}) {
    if (!this.on) return;
    this.scars.push({ kind, x, y, seed: Math.random() * 1e6, born: this.r.time, ...extra });
    if (this.scars.length > 48) this.scars.shift();
  }
  /** A trainer's line by their spot; lines said one after the other move up instead of overlapping. */
  caption(si, from, text, life, pos = 0, delay = 0) {
    const busy = this.captions.filter((c) => c.si === si && c.t < c.life - 0.2).length;
    this.captions.push({ si, x: from.x, y: from.y, text, t: -delay, life, pos: pos + busy });
  }
  throwBall(battle, si, u, pos, key, delay = 0) {
    const from = this.r.trainerPos(si);
    this.balls.push({ si, key, fx: from.x, fy: from.y, tx: u.x, ty: u.y, t: -delay, life: 0.42 });
    this.hidden.add(key);
    const name = this.monName(battle, si, u.active);
    if (name) this.caption(si, from, this.T("go", { name }), 1.7, pos, delay);
  }

  // ------------------------------------------------------------ the intro
  /** Called once when the battle starts from its first tick: the VS screen, then the balls and "Fight!". */
  startIntro(battle, {prepared = false} = {}) {
    if (!this.on) return false;
    const sides = battle.sides.map((sd, si) => {
      const lead = battle.doubles ? sd.units[0] : sd;
      const mon = sd.mons[lead.active];
      const portrait = mon && !this.r.offline && this.r.sprites?.portrait ? image(this.r.sprites.portrait(mon.species, "Determined", { num: mon.num || 0 })) : null;
      // The full match label stays in the video's header; the VS card gives the trainer's name room to read.
      const name = prepared ? String(sd.name || "").split(" (")[0] : sd.name || "";
      return { name, mon: mon?.name || "", portrait, fallback: this.r.fallbacks?.[si]?.[lead.active] || null, trainer: this.r.trainers?.[si] || null };
    });
    // A video prepares the fully visible card while paused, so even the first captured picture contains VS.
    this.intro = { t: prepared ? 0.7 : 0, hold: 2.35, life: 3.0, sides, thrown: false };
    for (let si = 0; si < 2; si++) for (const { key } of this.units(battle, si)) this.hidden.add(key);
    this.battle = battle;
    return true;
  }

  // ------------------------------------------------------------ the ending
  /** The battle is over: K.O. (or Time!), then the winner's banner. Returns how long the screen should wait, in seconds. */
  ending(battle) {
    if (!this.on || this.end) return this.end ? this.end.life : 0;
    const v = battle.view();
    const w = v.winner;
    const reason = v.reason || "ko";
    const name = w === 0 || w === 1 ? v.sides[w].name : "";
    this.callouts = [];
    this.end = { t: 0, life: 3.1, w, name, reason, color: w === 0 || w === 1 ? SIDE_COLORS[w] : "#8a8f98", dark: w === 0 || w === 1 ? SIDE_DARK[w] : "#3a3d44" };
    if (reason !== "forfeit") {
      this.say(reason === "time" ? this.T("time") : this.T("ko"), reason === "time" ? "#ffd54a" : "#ff4d4d", { size: 1.9, life: 1.2, y: 0.42 });
      this.flash = { t: 0, life: 0.35 };
    }
    // the winner says their line, or the loser theirs
    if (w === 0 || w === 1) { this.endTalk = this.line(w, "win") ? [w, "win"] : this.line(1 - w, "lose") ? [1 - w, "lose"] : null; this.cheer(1.4); }
    // the camera settles on the winner
    if (w === 0 || w === 1) {
      const u = this.units(battle, w).find(({ u: x }) => !battle.sides[w].mons[x.active]?.fainted) || this.units(battle, w)[0];
      if (u) this.push(u.u.x, u.u.y, 1.3, 3.1, true);
    }
    return this.end.life;
  }

  // ------------------------------------------------------------ events
  onEvent(e, battle) {
    if (!this.on && !showSettings().camera && !showSettings().impact) return;
    const r = this.r;
    const sec = battle.t / 30;
    const unit = (si, u = 0) => (battle.doubles ? battle.sides[si].units[u || 0] : battle.sides[si]);
    switch (e.k) {
      case "use":
        if (e.s === 0 || e.s === 1) this.lastShape[e.s] = e.shape || "";
        if (e.shape === "dash") { const a = unit(e.s, e.u); this.scar("skid", a.x, a.y, { fx: a.fx, fy: a.fy }); }
        break;
      case "hit": {
        const d = unit(e.s, e.u);
        const a = e.from === 0 || e.from === 1 ? e.from : 1 - e.s;
        const first = e.hit === 0 || e.hit === undefined;
        const ko = e.hp <= 0;
        const big = e.dmg / Math.max(1, e.maxhp) >= 0.3;
        // combos: blows in a row without being hit back
        if (first) {
          const c = this.combo[a];
          c.n = sec - c.t < 1.5 ? c.n + 1 : 1;
          c.t = sec;
          this.combo[e.s] = { n: 0, t: -99 };
          if (c.n >= 3 && !ko) this.say(this.T("combo", { n: c.n }), "#ffd54a", { size: 0.8, life: 1.0, y: 0.24 });
          // a clash: both sides landed a contact move at the same moment
          if (sec - this.lastHit[e.s] < 0.25 && CONTACT.has(this.lastShape[a]) && CONTACT.has(this.lastShape[e.s])) {
            this.say(this.T("clash"), "#ffe066", { size: 1.1, life: 0.9, y: 0.3 });
            const o = unit(a, 0);
            r.vfx.fx.push({ kind: "star", x: (o.x + d.x) / 2, y: (o.y + d.y) / 2, z: 0.6, t: 0, life: 0.35, color: "#ffe066" });
            r.vfx.shake = Math.max(r.vfx.shake, 0.16);
          }
          this.lastHit[a] = sec;
        }
        // the hardest blows: impact frame, camera push and the red edges
        if (first && (ko || (e.crit && big) || (e.eff > 1 && big) || e.dmg / Math.max(1, e.maxhp) >= 0.45)) {
          if (showSettings().impact) this.impact = { t: 0, life: ko ? 0.28 : 0.2, s: e.s, u: e.u || 0, a, dmg: e.dmg, maxhp: e.maxhp, ko, crit: e.crit,
            bg: ko ? "red" : e.crit ? "black" : "white", x: d.x, y: d.y, seed: Math.random() * 1e6 };
          this.push(d.x, d.y, ko ? 1.45 : 1.25, ko ? 1.1 : 0.7);
          this.vignette = 1;
          this.cheer(ko ? 1.3 : 1);
        } else if (first && (e.crit || e.eff > 1)) {
          this.push(d.x, d.y, 1.12, 0.45);
          this.vignette = Math.max(this.vignette, 0.5);
        }
        // a super-effective blow: every other one, the attacker's trainer says something about it
        if (first && e.eff > 1 && (this.supers++ % 2 === 0)) this.talk(a, "on_super");
        // a trainer's last Pokémon down to half its HP: the trainer says it once (the line last_low). The battle shown is the one at the
        // end of the tick, so the blows of a move that goes on to faint the Pokémon already find it down: those do not count
        const target = battle.sides[e.s].mons[d.active];
        if (!ko && target && !target.fainted && target.hp > 0 && !this.announcedLow[e.s] && e.maxhp > 0 && e.hp <= e.maxhp / 2
          && battle.sides[e.s].mons.filter((m) => !m.fainted && m.hp > 0).length === 1) {
          this.announcedLow[e.s] = true;
          this.talk(e.s, "last_low", { force: true });
        }
        // marks on the floor
        if (e.type === "Fire" && (big || e.crit)) this.scar("scorch", d.x + rnd(-0.3, 0.3), d.y + rnd(-0.2, 0.2), { r: rnd(0.6, 1) });
        else if (CONTACT.has(this.lastShape[a]) && first && Math.random() < 0.6) this.scar("slash", d.x + rnd(-0.4, 0.4), d.y + rnd(-0.2, 0.3), { ang: rnd(-0.9, 0.9) });
        break;
      }
      case "area": {
        if (CRACKS.has(e.move)) this.scar("crack", e.x, e.y, { r: Math.min(4, e.r || 2) });
        else if (CRATERS.has(e.move)) this.scar("crater", e.x, e.y, { r: Math.min(2.4, (e.r || 1.2) * 0.7) });
        else if (e.type === "Fire") this.scar("scorch", e.x, e.y, { r: Math.min(2.6, (e.r || 1.5) * 0.6) });
        if (WAVES.has(e.move) && this.on) this.wave = { t: 0, life: 1.25, color: e.move === "muddywater" ? "#8a6a3a" : "#3f7fe0" };
        if (["explosion", "selfdestruct", "mistyexplosion", "mindblown"].includes(e.move)) { this.push(e.x, e.y, 1.3, 0.9); this.vignette = 1; }
        break;
      }
      case "switch": {
        if (!this.on) break;
        const u = unit(e.s, e.u);
        const key = battle.doubles ? e.s * 2 + (e.u || 0) : e.s;
        this.throwBall(battle, e.s, u, e.u || 0, key);
        // the trainer's last Pokémon
        const left = battle.sides[e.s].mons.filter((m) => !m.fainted && m.hp > 0).length;
        if (left === 1 && battle.sides[e.s].mons.length > 1 && !this.announcedLast[e.s]) {
          this.announcedLast[e.s] = true;
          this.say(this.T("last", { name: battle.sides[e.s].name || "" }), SIDE_COLORS[e.s], { size: 0.95, life: 1.8, y: 0.3, delay: 0.3 });
          this.talk(e.s, "last", { force: true });
        }
        break;
      }
      case "recall": {
        if (!this.on) break;
        const from = r.trainerPos(e.s);
        const name = this.monName(battle, e.s, e.slot);
        if (name && !e.forced) { this.caption(e.s, from, this.T("back", { name }), 1.5, e.u || 0); this.talk(e.s, "on_switch"); }
        break;
      }
      case "faint": {
        const name = this.monName(battle, e.s, e.slot);
        if (!battle.ended && name) this.say(this.T("fainted", { name }), "#ffcf4a", { size: 1, life: 1.5, y: 0.4, delay: 0.15 });
        // the trainer whose Pokémon knocked it out, or the one who lost it, says their line (taking turns)
        if (!battle.ended) {
          const ko = e.by === 0 || e.by === 1 ? e.by : 1 - e.s;
          const order = this.faints++ % 2 ? [[e.s, "on_faint"], [ko, "on_ko"]] : [[ko, "on_ko"], [e.s, "on_faint"]];
          if (!this.talk(...order[0])) this.talk(...order[1]);
        }
        this.cheer(0.8);
        const d = unit(e.s, e.u);
        this.scar("crater", d.x, d.y, { r: 0.6, soft: true });
        break;
      }
      case "mega": {
        const d = unit(e.s, e.u);
        this.push(d.x, d.y, 1.35, 1.2);
        this.cheer(1);
        break;
      }
      case "ultimate": {
        const d = unit(e.s, e.u);
        this.push(d.x, d.y, 1.25, 1.0);
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------ per frame (real seconds, not slowed by the hit-stop)
  update(dt, battle) {
    this.battle = battle;
    const r = this.r;
    if (this.intro) {
      const it = this.intro;
      // Wait for a usable picture per side, including the fallback, at most a second and a half.
      if (!it.ready) {
        it.wait = (it.wait || 0) + dt;
        it.ready = it.wait > 1.5 || it.sides.every((sd) => {
          const pictures = [sd.trainer, sd.portrait, sd.fallback];
          return pictures.some((im) => im?.ready) || pictures.every((im) => !im || im.failed);
        });
      }
      if (it.ready) it.t += dt;
      if (!it.thrown && it.t >= 1.85) {
        it.thrown = true;
        for (let si = 0; si < 2; si++) for (const { u, key, pos } of this.units(battle, si)) this.throwBall(battle, si, u, pos, key, pos * 0.12);
      }
      if (it.t >= it.life) this.intro = null;
    }
    for (const b of this.balls) {
      b.t += dt;
      if (b.t >= b.life && !b.landed) {
        b.landed = true;
        this.hidden.delete(b.key);
        const unitNow = this.units(battle, b.si).find((x) => x.key === b.key)?.u;
        const x = unitNow ? unitNow.x : b.tx, y = unitNow ? unitNow.y : b.ty;
        this.pops.push({ x, y, t: 0, life: 0.45 });
        r.vfx.emit(14, () => ({ x: x + rnd(-0.3, 0.3), y: y + rnd(-0.15, 0.15), z: rnd(0.2, 0.8), vx: rnd(-2, 2), vy: rnd(-1, 1), vz: rnd(0.5, 2.5), drag: 2.5, life: rnd(0.3, 0.6),
          color: Math.random() < 0.5 ? "#ffffff" : "#ffe9a8", size: rnd(0.1, 0.2), kind: "glow" }));
      }
    }
    this.balls = this.balls.filter((b) => b.t < b.life + 0.05);
    // a Pokémon whose ball never landed (e.g. the setting changed) is shown anyway
    if (!this.balls.length && !this.intro) this.hidden.clear();
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < p.life);
    for (const c of this.captions) c.t += dt;
    this.captions = this.captions.filter((c) => c.t < c.life);
    for (const c of this.callouts) c.t += dt;
    this.callouts = this.callouts.filter((c) => c.t < c.life);
    if (this.impact) { this.impact.t += dt; if (this.impact.t >= this.impact.life) this.impact = null; }
    if (this.wave) { this.wave.t += dt; if (this.wave.t >= this.wave.life) this.wave = null; }
    if (this.flash) { this.flash.t += dt; if (this.flash.t >= this.flash.life) this.flash = null; }
    if (this.end) {
      this.end.t += dt;
      if (this.endTalk && this.end.t > 1.3) { this.talk(this.endTalk[0], this.endTalk[1], { force: true, life: 2.6 }); this.endTalk = null; }
    }
    if (this.crowd === null && battle) this.setupCrowd(battle);
    this.vignette = Math.max(0, this.vignette - dt * 2.4);
    // camera: the whole court, pushing in on the big moments
    const cx0 = r.worldCenter().x, cy0 = r.worldCenter().y;
    let tx = cx0, ty = cy0, tz = 1;
    if (this.punch && showSettings().camera) {
      const p = this.punch;
      p.t += dt;
      const k = p.t / p.life;
      const env = k < 0.18 ? ease(k / 0.18) : p.hold || k < 0.65 ? 1 : 1 - ease((k - 0.65) / 0.35);
      tz = 1 + (p.z - 1) * env;
      tx = cx0 + (p.x - cx0) * env;
      ty = cy0 + (p.y - cy0) * env;
      if (p.t >= p.life && !p.hold) this.punch = null;
    } else this.punch = null;
    if (!this.cam.ready) { this.cam = { x: cx0, y: cy0, z: 1, ready: true }; }
    const f = Math.min(1, dt * 9);
    this.cam.x += (tx - this.cam.x) * f;
    this.cam.y += (ty - this.cam.y) * f;
    this.cam.z += (tz - this.cam.z) * f;
  }

  /** Puts the camera on the context (world drawing goes after this). */
  applyCamera(ctx) {
    const r = this.r;
    const W = r.canvas.width, H = r.canvas.height;
    const z = Math.max(1, this.cam.z);
    let tx = r.px(this.cam.x), ty = r.py(this.cam.y);
    // never show past the edges of the picture
    const hw = W / (2 * z), hh = H / (2 * z);
    tx = clamp(tx, hw, W - hw);
    ty = clamp(ty, hh, H - hh);
    this.view = { tx, ty, z };
    if (z <= 1.001) { this.view = { tx: W / 2, ty: H / 2, z: 1 }; return; }
    ctx.translate(W / 2, H / 2);
    ctx.scale(z, z);
    ctx.translate(-tx, -ty);
  }

  // ------------------------------------------------------------ drawing in the world
  /** Marks on the floor, under everything that stands on it. */
  drawFloor(ctx) {
    if (!this.scars.length) return;
    const r = this.r, s = r.scale;
    for (const m of this.scars) {
      const age = r.time - m.born;
      const a = Math.min(1, age * 6) * (m.soft ? 0.25 : 0.42);
      let seed = Math.floor(m.seed) || 1;
      const r2 = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const x = r.px(m.x), y = r.py(m.y);
      ctx.save();
      if (m.kind === "crack") {
        ctx.strokeStyle = `rgba(40,28,18,${a})`;
        ctx.lineWidth = Math.max(1.2, s * 0.07);
        for (let i = 0; i < 8; i++) {
          let ang = (i / 8) * TAU + r2() * 0.5, cx = m.x, cy = m.y;
          ctx.beginPath();
          ctx.moveTo(r.px(cx), r.py(cy));
          for (let j = 0; j < 4; j++) { ang += (r2() - 0.5) * 0.9; cx += Math.cos(ang) * m.r / 4; cy += Math.sin(ang) * m.r / 4 * 0.6; ctx.lineTo(r.px(cx), r.py(cy)); }
          ctx.stroke();
        }
      } else if (m.kind === "crater" || m.kind === "scorch") {
        const rr = (m.r || 1) * s;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
        const col = m.kind === "scorch" ? "30,18,10" : "45,35,25";
        g.addColorStop(0, `rgba(${col},${a * 1.2})`);
        g.addColorStop(0.6, `rgba(${col},${a * 0.6})`);
        g.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * 0.55, 0, 0, TAU);
        ctx.fill();
        if (m.kind === "crater" && !m.soft) {
          ctx.strokeStyle = `rgba(255,255,255,${a * 0.35})`;
          ctx.lineWidth = Math.max(1, s * 0.04);
          ctx.beginPath();
          ctx.ellipse(x, y - rr * 0.06, rr * 0.7, rr * 0.36, 0, Math.PI * 1.05, Math.PI * 1.95);
          ctx.stroke();
        }
      } else if (m.kind === "slash") {
        ctx.translate(x, y);
        ctx.rotate(m.ang || 0);
        ctx.strokeStyle = `rgba(35,25,15,${a})`;
        ctx.lineWidth = Math.max(1, s * 0.05);
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-0.55 * s, i * 0.14 * s - 0.05 * s); ctx.lineTo(0.55 * s, i * 0.14 * s + 0.05 * s); ctx.stroke(); }
      } else if (m.kind === "skid") {
        ctx.strokeStyle = `rgba(35,25,15,${a * 0.8})`;
        ctx.lineWidth = Math.max(1, s * 0.045);
        const len = 1.1 * s, ang = Math.atan2(m.fy || 0, m.fx || 1);
        ctx.translate(x, y);
        ctx.rotate(ang);
        for (const off of [-0.16, 0.16]) { ctx.beginPath(); ctx.moveTo(-len, off * s); ctx.lineTo(-0.1 * s, off * s * 0.7); ctx.stroke(); }
      }
      ctx.restore();
    }
  }

  /** Poké Balls in the air, the bursts they open in and the trainers' lines. */
  drawWorld(ctx) {
    const r = this.r, s = r.scale;
    const reduced = !!r.reducedMotion?.matches;
    for (const b of this.balls) {
      if (b.t < 0) continue;
      const k = clamp(b.t / b.life, 0, 1);
      const x = b.fx + (b.tx - b.fx) * k, y = b.fy + (b.ty - b.fy) * k, z = 2.4 * Math.sin(Math.PI * k) + 0.5 * (1 - k);
      const cx = r.px(x), cy = r.py(y) - z * s, rad = 0.22 * s;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(r.px(x), r.py(y), rad, rad * 0.4, 0, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(reduced ? 0 : k * 9);
      if (drawBallFrame(ctx, 0, 0, rad * 8, k, false, reduced)) { ctx.restore(); continue; }
      ctx.fillStyle = "#e8433b";
      ctx.beginPath(); ctx.arc(0, 0, rad, Math.PI, TAU); ctx.fill();
      ctx.fillStyle = "#f4f4f4";
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI); ctx.fill();
      ctx.strokeStyle = "#1b1b1b";
      ctx.lineWidth = Math.max(1, rad * 0.22);
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.moveTo(-rad, 0); ctx.lineTo(rad, 0); ctx.stroke();
      ctx.fillStyle = "#f4f4f4";
      ctx.beginPath(); ctx.arc(0, 0, rad * 0.32, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    for (const p of this.pops) {
      const k = p.t / p.life, a = 1 - k;
      const cx = r.px(p.x), cy = r.py(p.y) - 0.6 * s;
      if (!reduced) drawBallFrame(ctx, cx, cy, 2.6 * s, k, true);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1.4 * s * (0.4 + k));
      g.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, 1.4 * s * (0.4 + k), 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.lineWidth = Math.max(1.5, s * 0.08 * a);
      ctx.beginPath(); ctx.ellipse(r.px(p.x), r.py(p.y), (0.4 + 1.6 * k) * s, (0.4 + 1.6 * k) * s * 0.45, 0, 0, TAU); ctx.stroke();
    }
    for (const c of this.captions) {
      if (c.t < 0) continue;
      const a = Math.min(1, c.t * 6, (c.life - c.t) * 3);
      const fs = Math.max(10, Math.round(0.5 * s));
      ctx.font = `italic 900 ${fs}px "Arial Black", system-ui, sans-serif`;
      ctx.textAlign = c.si === 0 ? "left" : "right";
      ctx.textBaseline = "middle";
      const x = r.px(c.x + (c.si === 0 ? -0.9 : 0.9));
      const y = r.py(c.y) - (2.9 + c.pos * 0.7 + c.t * 0.25) * s;
      ctx.globalAlpha = a;
      ctx.lineWidth = Math.max(2, fs * 0.22);
      ctx.strokeStyle = "rgba(10,10,20,0.85)";
      ctx.strokeText(c.text, x, y);
      ctx.fillStyle = c.si === 0 ? "#8fc2ff" : "#ff9a9a";
      ctx.fillText(c.text, x, y);
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------ drawing on the screen
  drawScreen(ctx, battle) {
    const r = this.r;
    const W = r.canvas.width, H = r.canvas.height;
    if (this.wave) this.drawWave(ctx, W, H);
    if (this.vignette > 0.01 && this.on) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
      g.addColorStop(0, "rgba(255,40,20,0)");
      g.addColorStop(1, `rgba(255,50,20,${0.55 * this.vignette})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.impact) this.drawImpact(ctx, battle, W, H);
    if (this.flash) {
      ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - this.flash.t / this.flash.life)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.end && this.end.t > 1.0) this.drawBanner(ctx, W, H);
    for (const c of this.callouts) if (c.t >= 0) this.drawCallout(ctx, c, W, H);
    if (this.intro) this.drawIntro(ctx, W, H);
  }

  font(px) { return `italic 900 ${Math.round(px)}px "Arial Black", "Segoe UI Black", system-ui, sans-serif`; }

  /** Big outlined words that pop in and leave a ghost behind as they go. */
  drawCallout(ctx, c, W, H) {
    const k = c.t / c.life;
    const pop = c.t < 0.14 ? 1.7 - 0.7 * ease(c.t / 0.14) : 1;
    const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    let fs = Math.min(H * 0.16, W * 0.075) * c.size;
    ctx.font = this.font(fs);
    while (fs > 12 && ctx.measureText(c.text).width > W * 0.9) { fs -= 2; ctx.font = this.font(fs); }
    const x = W / 2, y = H * c.y;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(x, y);
    ctx.scale(pop, pop);
    ctx.lineJoin = "round";
    if (k > 0.55) {
      // the ghost: a bigger, fainter copy drifting up
      ctx.globalAlpha = 0.25 * a;
      ctx.fillStyle = c.color;
      const g = 1 + (k - 0.55) * 0.5;
      ctx.save(); ctx.scale(g, g); ctx.fillText(c.text, 0, -fs * (k - 0.55)); ctx.restore();
    }
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillText(c.text, fs * 0.06, fs * 0.08);
    ctx.lineWidth = Math.max(3, fs * 0.17);
    ctx.strokeStyle = "#140c1c";
    ctx.strokeText(c.text, 0, 0);
    ctx.fillStyle = c.color;
    ctx.fillText(c.text, 0, 0);
    ctx.lineWidth = Math.max(1, fs * 0.035);
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.strokeText(c.text, 0, 0);
    ctx.restore();
  }

  /** The manga frame: a flat background, speed lines into the target, both fighters as silhouettes and the damage. */
  drawImpact(ctx, battle, W, H) {
    const im = this.impact;
    const r = this.r;
    const a = im.t > im.life - 0.06 ? (im.life - im.t) / 0.06 : 1;
    const t = this.toScreen(im.x, im.y, 0.6);
    const bg = im.bg === "red" ? "#2a0606" : im.bg === "black" ? "#07070a" : "#f6f3ea";
    const ink = im.bg === "white" ? "#101014" : "#fffaf0";
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // speed lines
    let seed = Math.floor(im.seed) || 1;
    const r2 = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const far = Math.hypot(W, H);
    ctx.fillStyle = ink;
    for (let i = 0; i < 72; i++) {
      const ang = (i / 72) * TAU + r2() * 0.05;
      const inner = Math.min(W, H) * (0.12 + r2() * 0.2);
      const wdt = 0.006 + r2() * 0.018;
      ctx.beginPath();
      ctx.moveTo(t.x + Math.cos(ang) * inner, t.y + Math.sin(ang) * inner);
      ctx.lineTo(t.x + Math.cos(ang - wdt) * far, t.y + Math.sin(ang - wdt) * far);
      ctx.lineTo(t.x + Math.cos(ang + wdt) * far, t.y + Math.sin(ang + wdt) * far);
      ctx.closePath();
      ctx.fill();
    }
    // silhouettes of the attacker and the one hit
    this.drawSilhouettes(ctx, battle, im, im.bg === "white" ? "#101014" : "#fffaf0", W, H);
    // a jagged burst where the blow lands
    ctx.fillStyle = im.bg === "white" ? "#101014" : "#fffaf0";
    ctx.beginPath();
    const R = Math.min(W, H) * 0.075;
    for (let i = 0; i <= 16; i++) {
      const ang = (i / 16) * TAU;
      const rr = i % 2 ? R * 0.45 : R * (0.9 + r2() * 0.4);
      ctx.lineTo(t.x + Math.cos(ang) * rr, t.y + Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fill();
    // the damage
    const txt = showSettings().numbers === "hp" ? String(im.dmg) : `${Math.max(1, Math.round((im.dmg / Math.max(1, im.maxhp)) * 100))}%`;
    const fs = Math.min(H * 0.13, W * 0.07);
    ctx.font = this.font(fs);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(3, fs * 0.18);
    ctx.strokeStyle = "#140c1c";
    ctx.strokeText(txt, t.x, t.y - R * 1.3);
    ctx.fillStyle = "#ffd54a";
    ctx.fillText(txt, t.x, t.y - R * 1.3);
    ctx.restore();
  }

  drawSilhouettes(ctx, battle, im, color, W, H) {
    const r = this.r;
    if (typeof document === "undefined") return;
    if (!this.off || this.off.width !== W || this.off.height !== H) {
      this.off = document.createElement("canvas");
      this.off.width = W;
      this.off.height = H;
    }
    const o = this.off.getContext("2d");
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = "source-over";
    o.clearRect(0, 0, W, H);
    o.imageSmoothingEnabled = false;
    const who = [[im.a, 0], [im.s, im.u]];
    if (battle.doubles) who[0] = [im.a, battle.sides[im.a].ctl ?? 0];
    for (const [si, u] of who) {
      const side = battle.doubles ? battle.sides[si]?.units?.[u] : battle.sides[si];
      if (!side) continue;
      const mon = battle.sides[si].mons[side.active];
      const anim = r.animOf(si, side.active, !!mon?.megaOn);
      const p = this.toScreen(side.x, side.y, 0);
      const k = Math.max(1, Math.round(r.k * p.k * 1.15));
      const row = dirRow(side.fx, side.fy);
      if (!anim || !anim.draw(o, p.x, p.y, row, k)) {
        o.fillStyle = "#000";
        o.beginPath(); o.ellipse(p.x, p.y - 0.7 * r.scale * p.k, 0.6 * r.scale * p.k, 0.8 * r.scale * p.k, 0, 0, TAU); o.fill();
      }
    }
    o.globalCompositeOperation = "source-in";
    o.fillStyle = color;
    o.fillRect(0, 0, W, H);
    ctx.drawImage(this.off, 0, 0);
  }

  /** Surf and friends: a wall of water crosses the screen from the bottom and leaves the floor wet for a moment. */
  drawWave(ctx, W, H) {
    const w = this.wave;
    const k = w.t / w.life;
    const front = H * (1.15 - 1.5 * ease(Math.min(1, k / 0.75)));
    const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    ctx.save();
    ctx.globalAlpha = 0.55 * a;
    const g = ctx.createLinearGradient(0, front, 0, front + H * 0.6);
    g.addColorStop(0, w.color);
    g.addColorStop(1, "rgba(20,60,140,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, front, W, H * 0.6);
    // the crest: foam made of overlapping round heads
    ctx.globalAlpha = 0.9 * a;
    ctx.fillStyle = "#e9f6ff";
    const step = Math.max(14, W / 26);
    for (let x = -step; x < W + step; x += step) {
      const y = front + Math.sin(x * 0.03 + w.t * 9) * step * 0.18;
      ctx.beginPath(); ctx.arc(x, y, step * 0.62, Math.PI, TAU); ctx.fill();
    }
    ctx.globalAlpha = 0.18 * a;
    ctx.fillStyle = w.color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /** The VS screen: two slanted panels in the trainers' colours, their pictures and names, "VS", then "Fight!". */
  drawIntro(ctx, W, H) {
    const it = this.intro;
    const t = it.t;
    const slideIn = ease(t / 0.35);
    const out = t > 1.75 ? ease((t - 1.75) / 0.35) : 0;
    ctx.save();
    if (t < 2.1) {
      // dim the field behind
      ctx.fillStyle = `rgba(8,8,16,${0.55 * (1 - out)})`;
      ctx.fillRect(0, 0, W, H);
      for (let si = 0; si < 2; si++) {
        const sd = it.sides[si];
        const dir = si === 0 ? -1 : 1;
        const off = (1 - slideIn) * W * 0.6 * dir + out * W * 0.7 * dir;
        const top = si === 0 ? H * 0.12 : H * 0.3;
        const ph = H * 0.5;
        const x0 = si === 0 ? 0 : W * 0.5, x1 = si === 0 ? W * 0.5 : W;
        const slant = W * 0.07;
        ctx.save();
        ctx.translate(off, 0);
        ctx.fillStyle = SIDE_COLORS[si];
        ctx.beginPath();
        if (si === 0) { ctx.moveTo(x0, top); ctx.lineTo(x1, top); ctx.lineTo(x1 - slant, top + ph); ctx.lineTo(x0, top + ph); }
        else { ctx.moveTo(x0 + slant, top); ctx.lineTo(x1, top); ctx.lineTo(x1, top + ph); ctx.lineTo(x0, top + ph); }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = Math.max(2, H * 0.006);
        ctx.stroke();
        // the picture: the trainer's own sprite, else the lead Pokémon's face
        const pic = sd.trainer?.ready ? sd.trainer.img : sd.portrait?.ready ? sd.portrait.img : sd.fallback?.ready ? sd.fallback.img : null;
        const box = ph * 0.52;
        const bx = si === 0 ? W * 0.07 : W - W * 0.07 - box;
        const by = top + ph * 0.1;
        ctx.fillStyle = SIDE_DARK[si];
        ctx.fillRect(bx - 4, by - 4, box + 8, box + 8);
        ctx.fillStyle = "#f2ead8";
        ctx.fillRect(bx, by, box, box);
        if (pic) {
          ctx.imageSmoothingEnabled = false;
          const ratio = pic.width / pic.height;
          const dw = ratio >= 1 ? box : box * ratio, dh = ratio >= 1 ? box / ratio : box;
          ctx.drawImage(pic, bx + (box - dw) / 2, by + (box - dh), dw, dh);
        }
        let fs = ph * 0.13;
        ctx.font = this.font(fs);
        ctx.textAlign = si === 0 ? "left" : "right";
        ctx.textBaseline = "middle";
        const name = (sd.name || "").toUpperCase();
        const nx = si === 0 ? bx + box + W * 0.025 : bx - W * 0.025;
        // room up to the "VS" in the middle of the screen
        const maxW = Math.max(W * 0.08, si === 0 ? W * 0.4 - nx : nx - W * 0.6);
        while (fs > 10 && ctx.measureText(name).width > maxW) { fs -= 1; ctx.font = this.font(fs); }
        ctx.lineWidth = Math.max(2, fs * 0.16);
        ctx.strokeStyle = "#140c1c";
        ctx.strokeText(name, nx, by + box * 0.45);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(name, nx, by + box * 0.45);
        if (sd.mon) {
          let ms = fs * 0.55;
          ctx.font = this.font(ms);
          while (ms > 9 && ctx.measureText(sd.mon).width > maxW) { ms -= 1; ctx.font = this.font(ms); }
          ctx.lineWidth = Math.max(2, fs * 0.1);
          ctx.strokeText(sd.mon, nx, by + box * 0.45 + fs * 0.9);
          ctx.fillStyle = "#ffe9a8";
          ctx.fillText(sd.mon, nx, by + box * 0.45 + fs * 0.9);
        }
        ctx.restore();
      }
      // VS slams in
      if (t > 0.3) {
        const k = clamp((t - 0.3) / 0.22, 0, 1);
        const sc = 2.6 - 1.6 * ease(k);
        const fs = H * 0.2;
        ctx.save();
        ctx.globalAlpha = Math.min(1, k * 2) * (1 - out);
        ctx.translate(W / 2, H * 0.47);
        ctx.scale(sc, sc);
        ctx.font = this.font(fs);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(3, fs * 0.14);
        ctx.strokeStyle = "#140c1c";
        ctx.strokeText("VS", 0, 0);
        ctx.fillStyle = "#ffd54a";
        ctx.fillText("VS", 0, 0);
        ctx.restore();
        if (k >= 1 && !it.shook) { it.shook = true; this.r.vfx.shake = Math.max(this.r.vfx.shake, 0.18); }
      }
      if (t > 0.7) {
        const fs = H * 0.075;
        ctx.globalAlpha = Math.min(1, (t - 0.7) * 3) * (1 - out);
        ctx.font = this.font(fs);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(2, fs * 0.16);
        ctx.strokeStyle = "#140c1c";
        const q = this.T("whoWins");
        ctx.strokeText(q, W / 2, H * 0.9);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(q, W / 2, H * 0.9);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    if (t > 2.0 && !it.fight) {
      it.fight = true;
      if (!this.talk(1, "intro", { force: true })) this.talk(0, "intro", { force: true });
      this.say(this.T("fight"), "#ffd54a", { size: 1.6, life: 1.0, y: 0.45 });
    }
  }

  /** The winner's band across the screen. */
  drawBanner(ctx, W, H) {
    const e = this.end;
    const k = ease((e.t - 1.0) / 0.3);
    const bh = H * 0.15;
    const y = H * 0.36;
    ctx.save();
    ctx.translate(-(1 - k) * W, 0);
    ctx.fillStyle = e.color;
    ctx.fillRect(0, y, W, bh);
    ctx.fillStyle = e.dark;
    ctx.fillRect(0, y + bh, W, bh * 0.08);
    ctx.fillRect(0, y - bh * 0.08, W, bh * 0.08);
    const text = e.w === 0 || e.w === 1 ? this.T("wins", { name: e.name }) : this.T("tie");
    let fs = bh * 0.62;
    ctx.font = this.font(fs);
    while (fs > 12 && ctx.measureText(text).width > W * 0.9) { fs -= 2; ctx.font = this.font(fs); }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(3, fs * 0.16);
    ctx.strokeStyle = "#140c1c";
    ctx.strokeText(text, W / 2, y + bh / 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, W / 2, y + bh / 2);
    ctx.restore();
  }
}

// words when the screen gives none (the friends' page and tests): Spanish
const FALLBACK = {
  go: ({ name }) => `¡Adelante, ${name}!`,
  back: ({ name }) => `¡${name}, vuelve!`,
  fainted: ({ name }) => `¡${name} se ha debilitado!`,
  last: ({ name }) => `¡Último Pokémon de ${name}!`,
  combo: ({ n }) => `¡Combo de ${n} golpes!`,
  clash: () => "¡Choque!",
  ko: () => "¡K.O.!",
  time: () => "¡Tiempo!",
  fight: () => "¡A luchar!",
  whoWins: () => "¿Quién ganará?",
  wins: ({ name }) => `¡Gana ${name}!`,
  tie: () => "¡Empate!",
};

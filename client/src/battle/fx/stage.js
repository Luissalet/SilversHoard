// The effect layer of the turn-based battle screen: two canvases laid over the arena (marks on the ground under the Pokémon, everything
// else over them) on which the real-time mode's effect painter (rt/vfx.js) plays each move from the user's sprite to its target's.
// It reads where the sprites are from the DOM (elements marked data-fx-pos="p1a"-style: side + slot), turns the protocol cues the
// battle player hands it into plans (plan.js), runs them on its own clock and answers how long the line must wait so the effect
// finishes before the damage shows. Loaded lazily; nothing here changes the battle.
import { Vfx } from "../rt/vfx.js";
import { fitTiming, planHit, planMove } from "./plan.js";
import { readFxStyle } from "./setting.js";

const H = 0.6;   // the painter flies projectiles this many meters over the ground
const WEATHER = { raindance: "raindance", primordialsea: "primordialsea", sunnyday: "sunnyday", desolateland: "desolateland", sandstorm: "sandstorm", hail: "hail",
  snow: "snow", snowscape: "snow" };
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export class FxStage {
  /** host: the arena element the sprites live in; under/over: the two canvases laid in it. */
  constructor({ host, under, over }) {
    this.host = host;
    this.under = under;
    this.over = over;
    this.ctxU = under.getContext("2d");
    this.ctxO = over.getContext("2d");
    this.S = 60;                                   // CSS pixels per meter
    this.r = { canvas: over, scale: 60, px: (x) => x * this.r.scale, py: (y) => y * this.r.scale };
    this.vfx = new Vfx(this.r);
    this.view = { projectiles: [], sides: [], weather: { id: "" } };
    this.battle = { sides: [] };
    this.clock = 0;
    this.ts = 1;
    this.queue = [];
    this.flights = [];
    this.field = { weather: "", mons: [] };
    this.raf = 0;
    this.last = 0;
    this.dead = false;
    // Showdown's own move animations (ps/): loaded on demand when the "animation style" setting asks for them
    this.ps = null;
    this.psLoading = null;
    if (readFxStyle() === "showdown") this.loadPs();
    this.frame = this.frame.bind(this);
    this.measure();
    this.watch = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { this.measure(); this.placeMons(); }) : null;
    this.watch?.observe(host);
  }

  // ------------------------------------------------------------ geometry
  measure() {
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || this.host.clientWidth || 1)), h = Math.max(1, Math.round(rect.height || this.host.clientHeight || 1));
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    this.S = Math.max(34, Math.min(72, w / 11));
    this.r.scale = this.S * dpr;
    if (this.w !== w || this.h !== h || this.dpr !== dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      for (const c of [this.under, this.over]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    }
    this.vfx.weatherArea = { w: w / this.S, h: h / this.S };
  }

  /** Where the Pokémon at `side` + `slot` stands, in meters on the stage: x across, y at its feet (flying effects ride H meters above). */
  anchor(side, slot) {
    const el = this.host.querySelector(`[data-fx-pos="${side}${slot}"]`);
    if (!el) return null;
    const img = el.querySelector("img") || el;
    const r = img.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const h = this.host.getBoundingClientRect();
    const cy = r.top - h.top + r.height / 2;
    const feet = r.bottom - h.top;
    return { x: (r.left - h.left + r.width / 2) / this.S, y: Math.min(cy + H * this.S, feet) / this.S };
  }

  actives() {
    const out = [];
    for (const el of this.host.querySelectorAll("[data-fx-pos]")) {
      const id = el.getAttribute("data-fx-pos");
      const a = el.classList.contains("is-fainted") ? null : this.anchor(id.slice(0, 2), Number(id.slice(2)));
      if (a) out.push({ side: id.slice(0, 2), slot: Number(id.slice(2)), ...a });
    }
    return out;
  }

  loadPs() {
    if (this.psLoading || typeof window === "undefined") return this.psLoading;
    this.psLoading = import("./ps/runner.js").then((m) => { if (!this.dead) this.ps = new m.PsRunner(this.host); }).catch(() => { /* our own effects carry on */ });
    return this.psLoading;
  }

  /** The Showdown runner when the setting asks for Showdown's animations and it is loaded (it starts loading on the first ask). */
  psActive() {
    if (readFxStyle() !== "showdown") return null;
    if (!this.ps) this.loadPs();
    return this.ps;
  }

  /**
   * A move with Showdown's animation: played by the runner at its own pace (its natural length at normal speed, shorter when the
   * replay runs faster). Returns the ms the line must last, or -1 to fall back to our own effect.
   */
  cuePs(anim, { speedMs }) {
    const ps = this.psActive();
    if (!ps || !ps.has(anim.move)) return -1;
    if (speedMs < 260) { ps.finish(); return 0; }
    const all = this.actives();
    const posOf = (t) => all.find((a) => a.side === t.side && a.slot === t.slot) || null;
    const spread = (anim.spread || []).map(posOf).filter(Boolean);
    const named = anim.target ? posOf(anim.target) : null;
    const foes = all.filter((a) => a.side !== anim.side);
    const target = named || spread[0] || foes[0] || null;
    const ms = ps.playMove({ move: anim.move, user: { side: anim.side, slot: anim.slot }, target, miss: !!anim.miss });
    if (!ms) return -1;
    this.begin();
    const want = Math.max(250, Math.min(2800, ms * (Math.max(260, speedMs) / 900)));
    this.ts = ms / want;
    anim.ps = true;           // the arena skips its own hop: Showdown's animation moves the sprite
    this.wake();
    return want + 60;
  }

  // ------------------------------------------------------------ cues
  /**
   * One protocol cue from the battle player ({type: "move"|"hit"|"heal"|"status"|"boost"|"unboost"|"faint"|..., side, slot, ...}).
   * Plays it and returns how many ms the line must last. May add `lunge` ({dx, dy} in px) to a move cue for the sprite's own animation.
   */
  cue(anim, { budgetMs = 900, speedMs = 900 } = {}) {
    if (this.dead || !anim) return 0;
    const type = anim.type;
    if (type === "move") {
      if (anim.move && !anim.still) {
        const w = this.cuePs(anim, { speedMs });
        if (w >= 0) return w;
      }
      return this.cueMove(anim, { budgetMs, speedMs });
    }
    const at = this.anchor(anim.side, anim.slot);
    if (!at) return 0;
    this.ts = Math.max(1, Math.min(3, 900 / Math.max(120, speedMs)));
    const ps = this.psActive();
    if (ps) {
      // with Showdown's animations: its status animations, and no bursts of ours on top of its moves
      if (type === "status" && ps.hasStatus(anim.status) && speedMs >= 260 && !ps.busy()) {
        if (ps.playStatus({ status: anim.status, side: anim.side, slot: anim.slot })) this.wake();
        return 0;
      }
      if (type === "hit" && !(anim.delta > 0) && ps.has(anim.move)) return 0;
    }
    const me = { x: at.x, y: at.y, fx: 1, fy: 0 };
    let steps = null;
    if (type === "hit" && anim.delta > 0) steps = [{ at: 0, ev: { k: "heal", s: 0 } }];
    else if (type === "hit") steps = planHit({ move: anim.move, source: anim.source, crit: anim.crit, eff: anim.eff }).steps;
    else if (type === "heal") steps = [{ at: 0, ev: { k: "heal", s: 0 } }];
    else if (type === "status") steps = [{ at: 0, ev: { k: "status", s: 0, status: anim.status } }];
    else if (type === "boost" || type === "unboost") steps = [{ at: 0, ev: { k: "boost", s: 0, stage: type === "boost" ? 1 : -1, same: false } }];
    else if (type === "faint") steps = [{ at: 0, ev: { k: "faint", s: 0 } }];
    if (!steps || !steps.length) return 0;
    for (const s of steps) this.queue.push({ ...s, at: this.clock + s.at, pos: me, sides: [me] });
    this.queue.sort((a, b) => a.at - b.at);
    this.wake();
    return 0;
  }

  cueMove(anim, { budgetMs, speedMs }) {
    if (anim.still || !anim.move) return 0;
    const user = this.anchor(anim.side, anim.slot);
    if (!user) return 0;
    const all = this.actives();
    const posOf = (t) => all.find((a) => a.side === t.side && a.slot === t.slot) || null;
    const spread = (anim.spread || []).map(posOf).filter(Boolean);
    const named = anim.target ? posOf(anim.target) : null;
    const foes = all.filter((a) => a.side !== anim.side);
    let targets = spread.length ? spread : named ? [named] : foes.slice(0, 1);
    // a move aimed at the user itself (Swords Dance, Recover) has no one to fly to
    targets = targets.filter((t) => !(t.side === anim.side && t.slot === anim.slot));
    const plan = planMove({ move: anim.move, user, targets, foes, others: all.filter((a) => !(a.side === anim.side && a.slot === anim.slot)), miss: !!anim.miss });
    const fit = fitTiming(plan.dur, { budgetMs, speedMs });
    if ((plan.shape === "strike" || plan.shape === "dash") && targets[0]) {
      // the user lunges at its target: the sprite's own animation reads this
      const k = plan.shape === "dash" ? 0.6 : 0.4, cap = plan.shape === "dash" ? 110 : 70;
      let dx = (targets[0].x - user.x) * this.S * k, dy = (targets[0].y - user.y) * this.S * k;
      const len = Math.hypot(dx, dy);
      if (len > cap) { dx = (dx / len) * cap; dy = (dy / len) * cap; }
      anim.lunge = { dx, dy };
    }
    if (fit.skip) return 0;
    this.begin();
    this.ts = fit.ts;
    this.battle.sides = plan.sides;
    for (const s of plan.steps) this.queue.push({ ...s, at: this.clock + s.at });
    for (const f of plan.flights) this.flights.push({ ...f, t0: this.clock + f.t0 });
    this.queue.sort((a, b) => a.at - b.at);
    this.wake();
    return fit.ms + 60;
  }

  /** A new cue replaces whatever is still travelling: no pile-up (particles already in the air fade out by themselves). */
  begin() {
    this.queue.length = 0;
    this.flights.length = 0;
    this.vfx.rays.clear();
    this.view.projectiles = [];
  }

  /** The field as the state shows it: the weather and the status of the Pokémon out ([{side, slot, status}]). */
  sync({ weather = "", mons = [] } = {}) {
    if (this.dead) return;
    this.field = { weather: WEATHER[key(weather)] || "", mons };
    this.view.weather = { id: this.field.weather };
    this.placeMons();
    if (this.field.weather || this.view.sides.length) this.wake();
  }

  placeMons() {
    this.view.sides = this.field.mons.filter((m) => m.status).map((m) => {
      const a = this.anchor(m.side, m.slot);
      return a ? { x: a.x, y: a.y, active: 0, need: false, mons: [{ status: m.status, fainted: false }] } : null;
    }).filter(Boolean);
  }

  /** Drop every effect at once (a jump in the replay, the end of the battle). */
  clear() {
    this.ps?.finish();
    this.begin();
    this.vfx.parts = [];
    this.vfx.fx = [];
    this.vfx.shake = 0;
    this.paint(true);
    this.resetShake();
  }

  // ------------------------------------------------------------ the clock
  wake() {
    if (this.dead || this.raf || typeof requestAnimationFrame === "undefined") return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  busy() {
    const v = this.vfx;
    return !!this.ps?.busy() || this.queue.length > 0 || this.flights.length > 0 || v.parts.length > 0 || v.fx.length > 0 || v.rays.size > 0 || !!this.view.weather.id || this.view.sides.length > 0;
  }

  frame(now) {
    this.raf = 0;
    if (this.dead) return;
    const real = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    this.advance(real * (this.queue.length || this.flights.length || this.vfx.fx.length || this.ps?.busy() ? this.ts : 1));
    this.paint(false);
    if (this.busy()) this.raf = requestAnimationFrame(this.frame);
    else { this.paint(true); this.resetShake(); }
  }

  /** Moves the effect clock on by `dt` seconds: runs the steps that are due, flies the projectiles, lets the painter update. */
  advance(dt) {
    this.clock += dt;
    while (this.queue.length && this.queue[0].at <= this.clock) this.run(this.queue.shift());
    const live = [];
    for (const f of this.flights) {
      if (this.clock < f.t0) continue;
      const p = Math.min(1, (this.clock - f.t0) / f.dur);
      const dx = f.to.x - f.from.x, dy = f.to.y - f.from.y;
      live.push({ id: f.id, move: f.move, type: f.type, shape: f.shape, r: f.r, x: f.from.x + dx * p, y: f.from.y + dy * p, vx: dx / f.dur, vy: dy / f.dur });
    }
    this.view.projectiles = live;
    this.vfx.update(dt, this.view);
    this.ps?.advance(dt * 1000);
  }

  run(step) {
    if (step.ev) {
      const e = step.ev;
      this.vfx.onEvent(e, { sides: step.sides || this.battle.sides });
      if (e.k === "impact" || e.k === "fizzle") this.flights = this.flights.filter((f) => f.id !== e.id);
    }
    if (step.burst) {
      const p = (step.sides && step.sides[0]) || step.pos;
      if (p) this.vfx.burst(step.burst.type, p.x, p.y, { power: step.burst.power });
    }
    if (step.flash) this.vfx.fx.push({ kind: "flash", t: 0, life: step.flash.life, color: step.flash.color });
  }

  paint(blank) {
    const { ctxU, ctxO, under, over } = this;
    for (const [ctx, c] of [[ctxU, under], [ctxO, over]]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
    }
    if (blank) return;
    this.vfx.drawUnder(ctxU);
    this.vfx.drawOver(ctxO, this.view, this.battle);
    this.ps?.draw(ctxU, ctxO, { w: this.w, h: this.h, dpr: this.dpr });
    // screen shake moves the whole arena a few pixels (and Showdown's Earthquake and kin shake it up and down)
    const k = Math.min(1, this.vfx.shake * 3) * 7;
    const q = this.ps ? this.ps.quake() : 0;
    if (k > 0.3 || Math.abs(q) > 0.3) {
      const jx = k > 0.3 ? (Math.random() - 0.5) * 2 * k : 0, jy = k > 0.3 ? (Math.random() - 0.5) * 2 * k * 0.6 : 0;
      this.host.style.transform = `translate(${jx.toFixed(1)}px, ${(jy + q).toFixed(1)}px)`;
    } else this.resetShake();
  }

  resetShake() {
    if (this.host.style.transform) this.host.style.transform = "";
  }

  destroy() {
    this.dead = true;
    if (this.raf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.watch?.disconnect();
    this.ps?.finish();
    this.paint(true);
    this.resetShake();
  }
}
